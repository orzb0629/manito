begin;

revoke create on schema public from public, anon, authenticated;

create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

-- Provisioned by the project administrator, never by sign-up or user_metadata.
create table app_private.teacher_accounts (
 user_id uuid primary key references auth.users(id) on delete cascade,
 active boolean not null default true,
 created_at timestamptz not null default now()
);
create table public.classes (
 id uuid primary key default gen_random_uuid(),
 teacher_id uuid not null references auth.users(id) on delete restrict,
 name text not null check (char_length(name) between 1 and 60),
 status text not null default 'setup' check (status in ('setup','locked','revealed')),
 roster_version integer not null default 0,
 locked_at timestamptz,
 revealed_at timestamptz,
 active boolean not null default true,
 created_at timestamptz not null default now(),
 check ((status = 'setup' and locked_at is null and revealed_at is null)
  or (status = 'locked' and locked_at is not null and revealed_at is null)
  or (status = 'revealed' and locked_at is not null and revealed_at is not null))
);
create index classes_teacher_idx on public.classes(teacher_id);

create table public.activity_days (
 class_id uuid not null references public.classes(id) on delete cascade,
 day smallint not null check (day between 1 and 5),
 scheduled_date date not null,
 primary key (class_id, day),
 unique (class_id, scheduled_date) deferrable initially deferred
);
create table public.students (
 id uuid primary key default gen_random_uuid(),
 class_id uuid not null references public.classes(id) on delete cascade,
 name text not null check (char_length(name) between 1 and 60),
 credential_version integer not null default 0 check (credential_version >= 0),
 created_at timestamptz not null default now(),
 unique (class_id, id)
);
create index students_class_idx on public.students(class_id);

create table public.assignments (
 class_id uuid not null references public.classes(id) on delete cascade,
 giver_id uuid not null,
 receiver_id uuid not null,
 primary key (class_id, giver_id),
 unique (class_id, receiver_id),
 check (giver_id <> receiver_id),
 foreign key (class_id, giver_id) references public.students(class_id,id) on delete cascade,
 foreign key (class_id, receiver_id) references public.students(class_id,id) on delete cascade
);
create table public.missions (
 class_id uuid not null,
 day smallint not null,
 title text not null check (char_length(title) between 1 and 60),
 description text not null check (char_length(description) between 1 and 400),
 primary key (class_id, day),
 foreign key (class_id,day) references public.activity_days(class_id,day) on delete cascade
);
create table public.mission_logs (
 class_id uuid not null,
 student_id uuid not null,
 day smallint not null,
 done boolean not null default false,
 body text not null default '' check (char_length(body) <= 1500),
 mood text not null check (mood in ('설레요','뿌듯해요','따뜻해요','조금 어려워요')),
 updated_at timestamptz not null default now(),
 primary key (student_id, day),
 foreign key (class_id, student_id) references public.students(class_id,id) on delete cascade,
 foreign key (class_id, day) references public.missions(class_id,day) on delete cascade
);
create index mission_logs_class_idx on public.mission_logs(class_id,day);
create table public.pledges (
 student_id uuid primary key,
 class_id uuid not null,
 pledged_at timestamptz not null default now(),
 foreign key (class_id,student_id) references public.students(class_id,id) on delete cascade
);
create index pledges_class_idx on public.pledges(class_id);
create table public.access_credentials (
 student_id uuid primary key references public.students(id) on delete cascade,
 code_hash text not null unique check (code_hash ~ '^[a-f0-9]{64}$'),
 version integer not null check (version > 0),
 expires_at timestamptz not null,
 created_at timestamptz not null default now()
);
create table app_private.student_sessions (
 token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
 student_id uuid not null references public.students(id) on delete cascade,
 credential_version integer not null,
 expires_at timestamptz not null,
 revoked_at timestamptz,
 created_at timestamptz not null default now()
);
create index student_sessions_student_idx on app_private.student_sessions(student_id);
create index student_sessions_expiry_idx on app_private.student_sessions(expires_at);
create table app_private.rate_limits (
 bucket text primary key check (bucket ~ '^[a-f0-9]{64}$'),
 started_at timestamptz not null,
 attempts integer not null check (attempts > 0)
);
create index rate_limits_time_idx on app_private.rate_limits(started_at);
create table app_private.confirmations (
 token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
 teacher_id uuid not null references auth.users(id) on delete cascade,
 class_id uuid not null references public.classes(id) on delete cascade,
 purpose text not null check (purpose in ('assignment','reveal')),
 roster_version integer not null,
 student_order uuid[],
 expires_at timestamptz not null,
 created_at timestamptz not null default now()
);
create index confirmations_class_idx on app_private.confirmations(class_id,purpose);
create index confirmations_expiry_idx on app_private.confirmations(expires_at);

create function app_private.teacher_active(p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
 select exists(select 1 from app_private.teacher_accounts t where t.user_id=p_id and t.active)
$$;
create function app_private.owns_class(p_class uuid) returns boolean
language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.classes c where c.id=p_class and c.teacher_id=(select auth.uid())
  and app_private.teacher_active((select auth.uid())))
$$;
revoke all on function app_private.teacher_active(uuid) from public, anon, authenticated;
revoke all on function app_private.owns_class(uuid) from public, anon, authenticated;
grant usage on schema app_private to authenticated;
grant execute on function app_private.owns_class(uuid) to authenticated;

-- The database enforces ordered, distinct dates, including multi-row edits at COMMIT.
create function app_private.check_days() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_class uuid := coalesce(new.class_id,old.class_id);
begin
 perform 1 from public.classes where id=v_class for update;
 if exists(select 1 from public.activity_days a join public.activity_days b on a.class_id=b.class_id
  where a.class_id=v_class and a.day<b.day and a.scheduled_date>=b.scheduled_date) then
  raise exception 'Activity dates must be strictly increasing' using errcode='23514';
 end if;
 if exists(select 1 from public.classes where id=v_class and status<>'setup')
  and (select count(*) from public.activity_days where class_id=v_class)<>5 then
  raise exception 'Five activity dates required' using errcode='23514';
 end if;
 return null;
end $$;
create constraint trigger ordered_activity_days after insert or update or delete on public.activity_days
 deferrable initially deferred for each row execute function app_private.check_days();

-- All roster writers serialize on the class row; assignment confirmations use the same lock.
create function app_private.guard_roster() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_class uuid := coalesce(new.class_id,old.class_id); v_status text;
begin
 if tg_op='UPDATE' and (new.id<>old.id or new.class_id<>old.class_id) then
  raise exception 'Student identity cannot change' using errcode='23514';
 end if;
 select status into v_status from public.classes where id=v_class for update;
 if v_status<>'setup' and (tg_op<>'UPDATE' or new.name is distinct from old.name) then
  raise exception 'Roster is locked' using errcode='23514';
 end if;
 if tg_op<>'UPDATE' or new.name is distinct from old.name then
  update public.classes set roster_version=roster_version+1 where id=v_class;
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
create trigger guard_student_roster before insert or update or delete on public.students
 for each row execute function app_private.guard_roster();

create function app_private.guard_assignments() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_class uuid := coalesce(new.class_id,old.class_id); v_status text;
begin
 if tg_op='UPDATE' and new.class_id<>old.class_id then
  raise exception 'Assignment class cannot change' using errcode='23514'; end if;
 select status into v_status from public.classes where id=v_class for update;
 if v_status<>'setup' then raise exception 'Assignments are locked' using errcode='23514'; end if;
 if tg_op='DELETE' then return old; end if; return new;
end $$;
create trigger immutable_assignments before insert or update or delete on public.assignments
 for each row execute function app_private.guard_assignments();

create function app_private.assert_cycle(p_class uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare n integer; start_id uuid; current_id uuid; next_id uuid; visited uuid[] := '{}';
begin
 select count(*) into n from public.students where class_id=p_class;
 if n<3 or (select count(*) from public.assignments where class_id=p_class)<>n then
  raise exception 'A full cycle of at least three students is required' using errcode='23514'; end if;
 select id into start_id from public.students where class_id=p_class order by id limit 1;
 current_id:=start_id;
 for i in 1..n loop
  if current_id=any(visited) then raise exception 'Disjoint cycle rejected' using errcode='23514'; end if;
  visited:=array_append(visited,current_id);
  select receiver_id into next_id from public.assignments where class_id=p_class and giver_id=current_id;
  if next_id is null then raise exception 'Incomplete cycle' using errcode='23514'; end if;
  current_id:=next_id;
 end loop;
 if current_id<>start_id then raise exception 'Invalid cycle' using errcode='23514'; end if;
end $$;
create function app_private.guard_class_transition() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 if new.teacher_id<>old.teacher_id or (old.status='revealed' and new.status<>'revealed')
  or (old.status='locked' and new.status='setup') then
  raise exception 'Class transition denied' using errcode='23514'; end if;
 if new.status<>'setup' then
  if (select count(*) from public.activity_days where class_id=new.id)<>5
   or (select count(*) from public.missions where class_id=new.id)<>5 then
   raise exception 'Five dates and missions required' using errcode='23514'; end if;
  perform app_private.assert_cycle(new.id);
 end if;
 return new;
end $$;
create trigger class_transition before update on public.classes for each row
 execute function app_private.guard_class_transition();

-- No student has an Auth JWT: students cannot use the Data API at all.
-- Approved teachers get read-only RLS views of ONLY their own class data.
do $$ declare t text; begin
 foreach t in array array['classes','activity_days','students','assignments','missions','mission_logs','pledges','access_credentials'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('alter table public.%I force row level security',t);
  execute format('revoke all on public.%I from public, anon, authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
 foreach t in array array['teacher_accounts','student_sessions','rate_limits','confirmations'] loop
  execute format('alter table app_private.%I enable row level security',t);
  execute format('alter table app_private.%I force row level security',t);
  execute format('revoke all on app_private.%I from public, anon, authenticated',t);
 end loop;
 foreach t in array array['activity_days','students','assignments','missions','mission_logs','pledges'] loop
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy teacher_read on public.%I for select to authenticated using (app_private.owns_class(class_id))',t);
 end loop;
end $$;
grant select on public.classes to authenticated;
create policy teacher_read on public.classes for select to authenticated using (app_private.owns_class(id));

-- Private helpers are never callable through Data API, including default PUBLIC EXECUTE.
revoke all on all functions in schema app_private from public, anon, authenticated;
grant execute on function app_private.owns_class(uuid) to authenticated;
alter default privileges in schema app_private revoke execute on functions from public;
-- Dedicated project: future migrations must opt into every client privilege as well.
alter default privileges in schema public revoke all on tables from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
commit;
