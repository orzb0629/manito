-- Run as postgres in Supabase SQL Editor AFTER both migrations. Read-only checks.
do $$
declare n integer; v_bad boolean;
begin
 select count(*),bool_or(not c.relrowsecurity or not c.relforcerowsecurity) into n,v_bad
 from pg_class c join pg_namespace ns on ns.oid=c.relnamespace
 where (ns.nspname='public' and c.relname=any(array['classes','activity_days','students','assignments','missions','mission_logs','pledges','access_credentials']))
  or (ns.nspname='app_private' and c.relname=any(array['teacher_accounts','student_sessions','rate_limits','confirmations']));
 if n<>12 or v_bad then raise exception 'Missing tables or RLS protection'; end if;
 if exists(select 1 from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
  where ns.nspname='public' and p.proname like 'manito\_%' escape '\'
  and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute'))) then
  raise exception 'A server RPC is callable from client'; end if;
 if has_table_privilege('anon','public.students','select') or has_table_privilege('anon','public.assignments','select')
  or has_table_privilege('anon','public.mission_logs','select') or has_table_privilege('authenticated','public.access_credentials','select')
  or has_table_privilege('authenticated','public.classes','update') then
  raise exception 'Unexpected direct table privilege'; end if;
 if exists(select 1 from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace join pg_roles r on r.oid=p.proowner
  where ns.nspname in ('public','app_private') and p.prosecdef and (ns.nspname='app_private' or p.proname like 'manito\_%' escape '\')
  and not (r.rolsuper or r.rolbypassrls)) then raise exception 'Function owner must bypass RLS for server enforcement'; end if;
end $$;
