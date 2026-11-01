begin;
do $$ begin
 if current_user<>'postgres' or not exists(select 1 from pg_roles where rolname=current_user and (rolsuper or rolbypassrls)) then
  raise exception 'Apply migration 004 as postgres with BYPASSRLS' using errcode='42501'; end if;
end $$;

-- Original HMAC hashes, credential versions, sessions and the global unique index
-- remain intact. No plaintext codes, automatic reissue, or data deletion here.
create function public.manito_issue_short_code(p_teacher uuid,p_student uuid,p_code_hash text) returns void
language plpgsql security definer set search_path='' as $$
declare v_class uuid; v_constraint text;
begin
 select class_id into v_class from public.students where id=p_student;
 perform app_private.assert_owner(p_teacher,v_class);
 if p_code_hash is null or p_code_hash!~'^[a-f0-9]{64}$' then
  raise exception 'Invalid credential hash' using errcode='23514'; end if;
 -- Includes the target student's current credential: a reissue cannot reuse it.
 if exists(select 1 from public.access_credentials where code_hash=p_code_hash) then
  raise exception 'Credential collision' using errcode='MC001'; end if;
 -- Reuse 002's atomic version increment, hash replacement and session revocation.
 perform public.manito_issue_code(p_teacher,p_student,p_code_hash);
exception when unique_violation then
 get stacked diagnostics v_constraint=constraint_name;
 if v_constraint='access_credentials_code_hash_key' then
  -- Another class may win the same candidate concurrently. The exception rolls
  -- back this attempt, including any version changes; server retries with CSPRNG.
  raise exception 'Credential collision' using errcode='MC001';
 end if;
 raise;
end $$;
alter function public.manito_issue_short_code(uuid,uuid,text) owner to postgres;
revoke all on function public.manito_issue_short_code(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.manito_issue_short_code(uuid,uuid,text) to service_role;
commit;
