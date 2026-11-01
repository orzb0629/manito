begin;
do $$ begin
 if current_user<>'postgres' or not exists(select 1 from pg_roles where rolname=current_user and (rolsuper or rolbypassrls)) then
  raise exception 'Apply migration 005 as postgres with BYPASSRLS' using errcode='42501'; end if;
end $$;

-- Server-only, short-lived, single-use reset approvals. No plaintext secrets.
create table app_private.reset_confirmations (
 class_id uuid primary key references public.classes(id) on delete cascade,
 teacher_id uuid not null references auth.users(id) on delete cascade,
 token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
 class_name text not null,
 roster_version integer not null,
 settings_version integer not null,
 class_status text not null,
 delete_students boolean not null,
 delete_schedule boolean not null,
 expires_at timestamptz not null,
 executing_tx bigint
);
alter table app_private.reset_confirmations enable row level security;
alter table app_private.reset_confirmations force row level security;
revoke all on app_private.reset_confirmations from public,anon,authenticated,service_role;

-- Student reads/writes already use this helper. Share the class lock with reset
-- so a previously authenticated in-flight journal/pledge cannot reappear later.
create or replace function app_private.session_student(p_hash text) returns public.students
language plpgsql security definer set search_path='' as $$
declare result public.students;
begin
 perform 1 from public.classes c join public.students s on s.class_id=c.id
  join app_private.student_sessions x on x.student_id=s.id where x.token_hash=p_hash for share of c;
 select s.* into result from app_private.student_sessions x
 join public.students s on s.id=x.student_id join public.classes c on c.id=s.class_id
 join public.access_credentials a on a.student_id=s.id and a.version=x.credential_version
 where x.token_hash=p_hash and x.revoked_at is null and x.expires_at>now()
  and x.credential_version=s.credential_version and a.expires_at>now() and c.active;
 if not found then raise exception 'Session invalid' using errcode='28000'; end if;
 return result;
end $$;

-- Preserve 001's guard; only a consumed server reset approval in THIS transaction
-- can reopen a class. A client-set GUC or a service-role direct UPDATE cannot do so.
create or replace function app_private.guard_class_transition() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.teacher_id<>old.teacher_id then
  raise exception 'Class transition denied' using errcode='23514'; end if;
 if (old.status='revealed' and new.status<>'revealed') or (old.status='locked' and new.status='setup') then
  if new.status<>'setup' or not exists(select 1 from app_private.reset_confirmations r
   where r.class_id=old.id and r.teacher_id=old.teacher_id and r.executing_tx=txid_current()
    and r.expires_at>now()) then
   raise exception 'Class transition denied' using errcode='23514'; end if;
 end if;
 if new.status<>'setup' then
  if (select count(*) from public.activity_days where class_id=new.id)<>5
   or (select count(*) from public.missions where class_id=new.id)<>5 then
   raise exception 'Five dates and missions required' using errcode='23514'; end if;
  perform app_private.assert_cycle(new.id);
 end if;
 return new;
end $$;

create function public.manito_prepare_reset(p_teacher uuid,p_class uuid,p_delete_students boolean,p_delete_schedule boolean,p_confirmation_hash text) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform app_private.assert_owner(p_teacher,p_class);
 if p_delete_students is null or p_delete_schedule is null or p_confirmation_hash is null
  or p_confirmation_hash!~'^[a-f0-9]{64}$' then
  raise exception 'Invalid reset request' using errcode='23514'; end if;
 delete from app_private.reset_confirmations where class_id=p_class;
 insert into app_private.reset_confirmations(class_id,teacher_id,token_hash,class_name,roster_version,settings_version,class_status,delete_students,delete_schedule,expires_at)
 select id,p_teacher,p_confirmation_hash,name,roster_version,settings_version,status,p_delete_students,p_delete_schedule,now()+interval '5 minutes'
 from public.classes where id=p_class;
end $$;

create function public.manito_confirm_reset(p_teacher uuid,p_class uuid,p_confirmation_hash text,p_class_name text) returns void
language plpgsql security definer set search_path='' as $$
declare draft app_private.reset_confirmations; c public.classes;
begin
 perform app_private.assert_owner(p_teacher,p_class);
 select * into c from public.classes where id=p_class;
 select * into draft from app_private.reset_confirmations where class_id=p_class and teacher_id=p_teacher
  and token_hash=p_confirmation_hash and expires_at>now() for update;
 if not found or p_class_name is distinct from c.name or draft.class_name<>c.name
  or draft.roster_version<>c.roster_version or draft.settings_version<>c.settings_version or draft.class_status<>c.status then
  raise exception 'Reset confirmation invalid' using errcode='23514'; end if;
 update app_private.reset_confirmations set executing_tx=txid_current() where class_id=p_class;
 -- Reopen under the private transaction-bound guard before guarded row deletes.
 update public.classes set status='setup',locked_at=null,revealed_at=null,
  roster_version=roster_version+1,settings_version=settings_version+1 where id=p_class;
 -- DELETE locks credentials against concurrent login; no old session can authenticate
 -- after commit, even if it was created concurrently using the old credential.
 delete from public.access_credentials where student_id in(select id from public.students where class_id=p_class);
 delete from app_private.student_sessions where student_id in(select id from public.students where class_id=p_class);
 update public.students set credential_version=credential_version+1 where class_id=p_class;
 delete from public.mission_logs where class_id=p_class;
 delete from public.pledges where class_id=p_class;
 delete from public.assignments where class_id=p_class;
 delete from app_private.confirmations where class_id=p_class;
 if draft.delete_students then delete from public.students where class_id=p_class; end if;
 if draft.delete_schedule then delete from public.activity_days where class_id=p_class; end if;
 delete from app_private.reset_confirmations where class_id=p_class;
end $$;

do $$ declare signature regprocedure; begin
 foreach signature in array array[
  'app_private.guard_class_transition()'::regprocedure,
  'app_private.session_student(text)'::regprocedure,
  'public.manito_prepare_reset(uuid,uuid,boolean,boolean,text)'::regprocedure,
  'public.manito_confirm_reset(uuid,uuid,text,text)'::regprocedure
 ] loop
  execute format('alter function %s owner to postgres',signature);
  execute format('revoke all on function %s from public,anon,authenticated,service_role',signature);
  if signature in ('public.manito_prepare_reset(uuid,uuid,boolean,boolean,text)'::regprocedure,
   'public.manito_confirm_reset(uuid,uuid,text,text)'::regprocedure) then
   execute format('grant execute on function %s to service_role',signature);
  end if;
 end loop;
end $$;
commit;
