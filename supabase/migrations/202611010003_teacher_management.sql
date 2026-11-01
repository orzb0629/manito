begin;
-- Apply through SQL Editor as postgres, the same trusted owner as 001/002.
-- Fail before any DDL rather than install definer functions under an unexpected role.
do $$ begin
 if current_user<>'postgres' or not exists(select 1 from pg_roles where rolname=current_user and (rolsuper or rolbypassrls)) then
  raise exception 'Apply migration 003 as postgres with BYPASSRLS' using errcode='42501'; end if;
end $$;
alter table public.classes add column settings_version integer not null default 0;

create function public.manito_teacher_classes(p_teacher uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if not app_private.teacher_active(p_teacher) then raise exception 'Access denied' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'status',status) order by created_at)
  from public.classes where teacher_id=p_teacher and active),'[]'::jsonb);
end $$;

create function public.manito_teacher_snapshot(p_teacher uuid,p_class uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.classes;
begin
 perform app_private.assert_owner(p_teacher,p_class);
 select * into c from public.classes where id=p_class;
 return jsonb_build_object('id',c.id,'name',c.name,'status',c.status,'rosterVersion',c.roster_version,'settingsVersion',c.settings_version,
  'students',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'hasCode',exists(select 1 from public.access_credentials a where a.student_id=s.id and a.expires_at>now()),
   'pledged',exists(select 1 from public.pledges p where p.student_id=s.id),
   'completedDays',coalesce((select jsonb_agg(l.day order by l.day) from public.mission_logs l where l.student_id=s.id and l.done),'[]'::jsonb)) order by s.created_at,s.id)
   from public.students s where s.class_id=p_class),'[]'::jsonb),
  'days',coalesce((select jsonb_agg(jsonb_build_object('day',d.day,'date',d.scheduled_date,'title',m.title,'description',m.description) order by d.day)
   from public.activity_days d left join public.missions m using(class_id,day) where d.class_id=p_class),'[]'::jsonb));
end $$;

create function app_private.assert_editable_roster(p_teacher uuid,p_class uuid,p_version integer) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform app_private.assert_owner(p_teacher,p_class);
 if not exists(select 1 from public.classes where id=p_class and status='setup' and roster_version=p_version) then
  raise exception 'Roster locked or stale' using errcode='23514'; end if;
end $$;
create function public.manito_add_students(p_teacher uuid,p_class uuid,p_names text[],p_version integer) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform app_private.assert_editable_roster(p_teacher,p_class,p_version);
 if cardinality(p_names) is null or cardinality(p_names)<1 or cardinality(p_names)>80
  or array_ndims(p_names)<>1 or exists(select 1 from unnest(p_names) n where n is null or char_length(btrim(n)) not between 1 and 60)
  or (select count(*) from public.students where class_id=p_class)+cardinality(p_names)>80 then
  raise exception 'Invalid roster' using errcode='23514'; end if;
 insert into public.students(class_id,name) select p_class,btrim(n) from unnest(p_names) n;
end $$;
create function public.manito_rename_student(p_teacher uuid,p_class uuid,p_student uuid,p_name text,p_version integer) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform app_private.assert_editable_roster(p_teacher,p_class,p_version);
 if p_name is null or char_length(btrim(p_name)) not between 1 and 60 then raise exception 'Invalid name' using errcode='23514'; end if;
 update public.students set name=btrim(p_name) where id=p_student and class_id=p_class;
 if not found then raise exception 'Access denied' using errcode='42501'; end if;
end $$;
create function public.manito_remove_student(p_teacher uuid,p_class uuid,p_student uuid,p_version integer) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform app_private.assert_editable_roster(p_teacher,p_class,p_version);
 delete from public.students where id=p_student and class_id=p_class;
 if not found then raise exception 'Access denied' using errcode='42501'; end if;
end $$;
create function public.manito_save_settings(p_teacher uuid,p_class uuid,p_name text,p_days jsonb,p_version integer) returns void
language plpgsql security definer set search_path='' as $$
declare item jsonb; i integer:=0; previous_date date; current_date_value date;
begin
 perform app_private.assert_owner(p_teacher,p_class);
 if not exists(select 1 from public.classes where id=p_class and settings_version=p_version) then
  raise exception 'Settings stale' using errcode='23514'; end if;
 if p_name is null or char_length(btrim(p_name)) not between 1 and 60 or p_days is null or jsonb_typeof(p_days)<>'array' then
  raise exception 'Invalid settings' using errcode='23514'; end if;
 if jsonb_array_length(p_days)<>5 then
  raise exception 'Invalid settings' using errcode='23514'; end if;
 -- Validate the complete payload before touching rows, even for privileged RPC callers.
 for item in select value from jsonb_array_elements(p_days) loop
  i:=i+1;
  if jsonb_typeof(item)<>'object' or jsonb_typeof(item->'day') is distinct from 'number'
   or item->'day' is distinct from to_jsonb(i) or jsonb_typeof(item->'date') is distinct from 'string'
   or (item->>'date')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
   or jsonb_typeof(item->'title') is distinct from 'string' or jsonb_typeof(item->'description') is distinct from 'string' then
   raise exception 'Invalid day settings' using errcode='23514'; end if;
  current_date_value:=(item->>'date')::date;
  if current_date_value is null
   or (previous_date is not null and current_date_value<=previous_date)
   or item->>'title' is null or char_length(btrim(item->>'title')) not between 1 and 60
   or item->>'description' is null or char_length(btrim(item->>'description')) not between 1 and 400 then
   raise exception 'Invalid day settings' using errcode='23514'; end if;
  previous_date:=current_date_value;
 end loop;
 -- 001 makes both constraints DEFERRABLE. Keep them deferred across the WHOLE
 -- replacement, including callers that previously selected IMMEDIATE timing.
 -- No SET CONSTRAINTS ALL: unrelated application constraints are unaffected.
 set constraints public.activity_days_class_id_scheduled_date_key, public.ordered_activity_days deferred;
 i:=0;
 for item in select value from jsonb_array_elements(p_days) loop
  i:=i+1;current_date_value:=(item->>'date')::date;
  insert into public.activity_days(class_id,day,scheduled_date) values(p_class,i,current_date_value)
   on conflict(class_id,day) do update set scheduled_date=excluded.scheduled_date;
  insert into public.missions(class_id,day,title,description) values(p_class,i,btrim(item->>'title'),btrim(item->>'description'))
   on conflict(class_id,day) do update set title=excluded.title,description=excluded.description;
 end loop;
 update public.classes set name=btrim(p_name),settings_version=settings_version+1 where id=p_class;
end $$;

-- Owner-checked journal reads are explicit, never included in progress summaries.
create function public.manito_teacher_logs(p_teacher uuid,p_class uuid,p_student uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform app_private.assert_owner(p_teacher,p_class);
 if not exists(select 1 from public.students where id=p_student and class_id=p_class) then
  raise exception 'Access denied' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('day',day,'done',done,'text',body,'mood',mood) order by day)
  from public.mission_logs where student_id=p_student and class_id=p_class),'[]'::jsonb);
end $$;

-- Scope ownership/ACL changes to the eight functions introduced HERE. Do not
-- change existing 001/002 functions or other overloads that happen to share a prefix.
do $$ declare signature regprocedure; begin
 foreach signature in array array[
  'public.manito_teacher_classes(uuid)'::regprocedure,
  'public.manito_teacher_snapshot(uuid,uuid)'::regprocedure,
  'app_private.assert_editable_roster(uuid,uuid,integer)'::regprocedure,
  'public.manito_add_students(uuid,uuid,text[],integer)'::regprocedure,
  'public.manito_rename_student(uuid,uuid,uuid,text,integer)'::regprocedure,
  'public.manito_remove_student(uuid,uuid,uuid,integer)'::regprocedure,
  'public.manito_save_settings(uuid,uuid,text,jsonb,integer)'::regprocedure,
  'public.manito_teacher_logs(uuid,uuid,uuid)'::regprocedure
 ] loop
  execute format('alter function %s owner to postgres',signature);
  execute format('revoke all on function %s from public,anon,authenticated,service_role',signature);
  if signature<>'app_private.assert_editable_roster(uuid,uuid,integer)'::regprocedure then
   execute format('grant execute on function %s to service_role',signature);
  end if;
 end loop;
end $$;
commit;
