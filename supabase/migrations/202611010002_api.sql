begin;
create function app_private.assert_owner(p_teacher uuid,p_class uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
 perform 1 from public.classes c where c.id=p_class and c.teacher_id=p_teacher and c.active
  and app_private.teacher_active(p_teacher) for update;
 if not found then raise exception 'Access denied' using errcode='42501'; end if;
end $$;
create function app_private.session_student(p_hash text) returns public.students
language plpgsql security definer set search_path = '' as $$
declare result public.students;
begin
 select s.* into result from app_private.student_sessions x
 join public.students s on s.id=x.student_id join public.classes c on c.id=s.class_id
 join public.access_credentials a on a.student_id=s.id and a.version=x.credential_version
 where x.token_hash=p_hash and x.revoked_at is null and x.expires_at>now()
  and x.credential_version=s.credential_version and a.expires_at>now() and c.active;
 if not found then raise exception 'Session invalid' using errcode='28000'; end if;
 return result;
end $$;

-- Persistent atomic limiter shared across all serverless instances. Called in its own
-- transaction BEFORE authentication, so failed logins never roll back their counters.
create function public.manito_rate_limit(p_bucket text,p_limit integer,p_seconds integer) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
 if p_limit<1 or p_seconds<1 then raise exception 'Invalid limit'; end if;
 insert into app_private.rate_limits(bucket,started_at,attempts) values(p_bucket,now(),1)
 on conflict(bucket) do update set
  attempts=case when app_private.rate_limits.started_at<=now()-make_interval(secs=>p_seconds) then 1 else app_private.rate_limits.attempts+1 end,
  started_at=case when app_private.rate_limits.started_at<=now()-make_interval(secs=>p_seconds) then now() else app_private.rate_limits.started_at end
 returning attempts into v_count;
 return v_count<=p_limit;
end $$;

create function public.manito_student_login(p_code_hash text,p_session_hash text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_student uuid; v_version integer; v_expiry timestamptz;
begin
 -- Row lock coordinates authentication with code reissue; old version cannot survive.
 select a.student_id,a.version,a.expires_at into v_student,v_version,v_expiry
 from public.access_credentials a join public.students s on s.id=a.student_id
 join public.classes c on c.id=s.class_id
 where a.code_hash=p_code_hash and a.expires_at>now() and c.active and a.version=s.credential_version
 for update of a;
 if not found then return false; end if;
 insert into app_private.student_sessions(token_hash,student_id,credential_version,expires_at)
 values(p_session_hash,v_student,v_version,least(v_expiry,now()+interval '12 hours'));
 return true;
end $$;
create function public.manito_student_logout(p_session_hash text) returns void
language sql security definer set search_path = '' as $$
 update app_private.student_sessions set revoked_at=now() where token_hash=p_session_hash
$$;

create function public.manito_student_snapshot(p_session_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.students; c public.classes; result jsonb; has_pledge boolean; friend_name text;
begin
 s:=app_private.session_student(p_session_hash);
 select * into c from public.classes where id=s.class_id;
 select exists(select 1 from public.pledges where student_id=s.id) into has_pledge;
 result:=jsonb_build_object('className',c.name,'student',jsonb_build_object('id',s.id,'name',s.name),
  'pledged',has_pledge,'revealed',c.status='revealed','mate',null,
  'days',coalesce((select jsonb_agg(jsonb_build_object('day',d.day,'date',d.scheduled_date,
   'title',m.title,'description',case when d.scheduled_date<=(now() at time zone 'Asia/Seoul')::date then m.description else '' end,
   'open',d.scheduled_date<=(now() at time zone 'Asia/Seoul')::date) order by d.day)
   from public.activity_days d join public.missions m using(class_id,day) where d.class_id=s.class_id),'[]'::jsonb),
  'logs',coalesce((select jsonb_agg(jsonb_build_object('day',l.day,'done',l.done,'text',l.body,'mood',l.mood) order by l.day)
   from public.mission_logs l where l.student_id=s.id),'[]'::jsonb));
 if has_pledge and c.status in ('locked','revealed') then
  select r.name into friend_name from public.assignments a join public.students r on r.id=a.receiver_id
   where a.class_id=s.class_id and a.giver_id=s.id;
  result:=jsonb_set(result,'{mate}',jsonb_build_object('name',friend_name));
 end if;
 -- No reverse ID, name, relationship, or even property exists before manual reveal.
 if c.status='revealed' then
  select g.name into friend_name from public.assignments a join public.students g on g.id=a.giver_id
   where a.class_id=s.class_id and a.receiver_id=s.id;
  result:=result||jsonb_build_object('caredBy',jsonb_build_object('name',friend_name));
 end if;
 return result;
end $$;
create function public.manito_student_pledge(p_session_hash text) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.students;
begin
 s:=app_private.session_student(p_session_hash);
 insert into public.pledges(student_id,class_id) values(s.id,s.class_id) on conflict(student_id) do nothing;
end $$;
create function public.manito_student_log(p_session_hash text,p_day smallint,p_done boolean,p_body text,p_mood text) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.students;
begin
 s:=app_private.session_student(p_session_hash);
 if not exists(select 1 from public.pledges where student_id=s.id)
  or not exists(select 1 from public.activity_days d join public.classes c on c.id=d.class_id
   where d.class_id=s.class_id and d.day=p_day and c.status in ('locked','revealed')
   and d.scheduled_date<=(now() at time zone 'Asia/Seoul')::date) then
  raise exception 'Mission unavailable' using errcode='42501'; end if;
 insert into public.mission_logs(class_id,student_id,day,done,body,mood)
 values(s.class_id,s.id,p_day,p_done,p_body,p_mood)
 on conflict(student_id,day) do update set done=excluded.done,body=excluded.body,mood=excluded.mood,updated_at=now();
end $$;

create function public.manito_teacher_roster(p_teacher uuid,p_class uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
 perform app_private.assert_owner(p_teacher,p_class);
 return coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by id) from public.students where class_id=p_class),'[]'::jsonb);
end $$;
create function public.manito_issue_code(p_teacher uuid,p_student uuid,p_code_hash text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_class uuid; v_version integer;
begin
 select class_id into v_class from public.students where id=p_student;
 perform app_private.assert_owner(p_teacher,v_class);
 update public.students set credential_version=credential_version+1 where id=p_student returning credential_version into v_version;
 insert into public.access_credentials(student_id,code_hash,version,expires_at)
 values(p_student,p_code_hash,v_version,now()+interval '90 days')
 on conflict(student_id) do update set code_hash=excluded.code_hash,version=excluded.version,expires_at=excluded.expires_at,created_at=now();
 update app_private.student_sessions set revoked_at=now() where student_id=p_student and revoked_at is null;
end $$;

create function public.manito_prepare_assignments(p_teacher uuid,p_class uuid,p_order uuid[],p_confirmation_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_version integer; n integer; pairs jsonb;
begin
 perform app_private.assert_owner(p_teacher,p_class);
 select roster_version into v_version from public.classes where id=p_class and status='setup';
 if not found then raise exception 'Assignments locked' using errcode='42501'; end if;
 n:=cardinality(p_order);
 if n is null or n<3 or array_ndims(p_order)<>1 or array_position(p_order,null) is not null
  or (select count(distinct v) from unnest(p_order) v)<>n
  or (select count(*) from public.students where class_id=p_class)<>n
  or exists(select 1 from unnest(p_order) v where not exists(select 1 from public.students s where s.id=v and s.class_id=p_class)) then
  raise exception 'Invalid roster' using errcode='23514'; end if;
 delete from app_private.confirmations where class_id=p_class and purpose='assignment';
 insert into app_private.confirmations(token_hash,teacher_id,class_id,purpose,roster_version,student_order,expires_at)
 values(p_confirmation_hash,p_teacher,p_class,'assignment',v_version,p_order,now()+interval '5 minutes');
 select jsonb_agg(jsonb_build_object('giver',g.name,'receiver',r.name) order by i) into pairs
 from generate_series(1,n) i join public.students g on g.id=p_order[i] join public.students r on r.id=p_order[(i%n)+1];
 return pairs;
end $$;
create function public.manito_confirm_assignments(p_teacher uuid,p_class uuid,p_confirmation_hash text) returns void
language plpgsql security definer set search_path = '' as $$
declare draft app_private.confirmations; n integer;
begin
 perform app_private.assert_owner(p_teacher,p_class);
 select * into draft from app_private.confirmations where token_hash=p_confirmation_hash and teacher_id=p_teacher
  and class_id=p_class and purpose='assignment' and expires_at>now() for update;
 if not found or not exists(select 1 from public.classes where id=p_class and status='setup' and roster_version=draft.roster_version) then
  raise exception 'Confirmation invalid' using errcode='42501'; end if;
 n:=cardinality(draft.student_order);
 delete from public.assignments where class_id=p_class;
 insert into public.assignments(class_id,giver_id,receiver_id)
 select p_class,draft.student_order[i],draft.student_order[(i%n)+1] from generate_series(1,n) i;
 update public.classes set status='locked',locked_at=now() where id=p_class;
 delete from app_private.confirmations where class_id=p_class;
end $$;
create function public.manito_prepare_reveal(p_teacher uuid,p_class uuid,p_confirmation_hash text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_version integer;
begin
 perform app_private.assert_owner(p_teacher,p_class);
 select roster_version into v_version from public.classes where id=p_class and status='locked';
 if not found then raise exception 'Reveal unavailable' using errcode='42501'; end if;
 delete from app_private.confirmations where class_id=p_class and purpose='reveal';
 insert into app_private.confirmations(token_hash,teacher_id,class_id,purpose,roster_version,expires_at)
 values(p_confirmation_hash,p_teacher,p_class,'reveal',v_version,now()+interval '5 minutes');
end $$;
create function public.manito_confirm_reveal(p_teacher uuid,p_class uuid,p_confirmation_hash text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_hash text;
begin
 perform app_private.assert_owner(p_teacher,p_class);
 delete from app_private.confirmations where token_hash=p_confirmation_hash and teacher_id=p_teacher
  and class_id=p_class and purpose='reveal' and expires_at>now() returning token_hash into v_hash;
 if v_hash is null then raise exception 'Confirmation invalid' using errcode='42501'; end if;
 update public.classes set status='revealed',revealed_at=now() where id=p_class and status='locked';
 if not found then raise exception 'Reveal unavailable' using errcode='42501'; end if;
end $$;

-- Explicit opt-in allowlist of RPCs. Every RPC, even login and limiter, is server-only.
do $$ declare f record; begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname like 'manito\_%' escape '\' loop
  execute format('revoke all on function %s from public, anon, authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
revoke all on all functions in schema app_private from public, anon, authenticated;
grant execute on function app_private.owns_class(uuid) to authenticated;
commit;
