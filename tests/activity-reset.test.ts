import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { handleRequest } from '../server/handler.ts';
import { databaseError } from '../server/supabase.ts';
import type { BackendDependencies } from '../server/supabase.ts';

test('005 reset: upgrade, server-only two-step approval, rollback, isolation and reusable activity',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
 for(const f of ['001_schema','002_api','003_teacher_management','004_short_access_codes'])await db.exec(readFileSync(`supabase/migrations/202611010${f}.sql`,'utf8'));
 const teacher='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
 const a='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',b='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 const hash=(n:number)=>n.toString(16).padStart(64,'0');
 async function rpc<T=any>(expression:string,args:unknown[]=[]){return(await db.query<{v:T}>(`select ${expression} as v`,args)).rows[0].v;}
 await db.query('insert into auth.users values($1),($2)',[teacher,other]);await db.query('insert into app_private.teacher_accounts(user_id) values($1),($2)',[teacher,other]);
 const days=Array.from({length:5},(_,i)=>({day:i+1,date:`2000-01-${String(i*3+1).padStart(2,'0')}`,title:'미션',description:'설명'}));
 async function snapshot(id=a){return rpc('public.manito_teacher_snapshot($1,$2)',[teacher,id]);}
 async function seed(id:string){
  await db.query('insert into public.classes(id,teacher_id,name) values($1,$2,$3)',[id,teacher,'테스트 학급']);
  await rpc('public.manito_add_students($1,$2,$3::text[],0)',[teacher,id,['가명A','가명B','가명C']]);
  await rpc('public.manito_save_settings($1,$2,$3,$4::jsonb,0)',[teacher,id,'테스트 학급',JSON.stringify(days)]);
  const s=await snapshot(id);const ids=s.students.map((x:{id:string})=>x.id);
  await rpc('public.manito_prepare_assignments($1,$2,$3::uuid[],$4)',[teacher,id,ids,hash(id===a?1:2)]);
  await rpc('public.manito_confirm_assignments($1,$2,$3)',[teacher,id,hash(id===a?1:2)]);
  return ids;
 }
 const ids=await seed(a);await seed(b);
 await rpc('public.manito_issue_short_code($1,$2,$3)',[teacher,ids[0],hash(3)]);
 await rpc('public.manito_student_login($1,$2)',[hash(3),hash(4)]);
 await rpc('public.manito_student_pledge($1)',[hash(4)]);
 await rpc("public.manito_student_log($1,1::smallint,true,'일지','뿌듯해요')",[hash(4)]);
 await rpc('public.manito_prepare_reveal($1,$2,$3)',[teacher,a,hash(5)]);await rpc('public.manito_confirm_reveal($1,$2,$3)',[teacher,a,hash(5)]);
 const tables=['public.classes','public.students','public.activity_days','public.missions','public.assignments','public.mission_logs','public.pledges','public.access_credentials','app_private.student_sessions','app_private.confirmations'];
 async function contents(){const out=[];for(const table of tables)out.push(await rpc(`(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from ${table} t)`));return out;}
 const before=await contents();const sql=readFileSync('supabase/migrations/202611010005_activity_reset.sql','utf8');
 await db.exec('set role service_role');await assert.rejects(db.exec(sql));await db.exec('rollback;reset role');
 await db.exec(sql);assert.deepEqual(await contents(),before);
 async function prepare(students=false,schedule=false,h=hash(6),actor=teacher,id=a){return rpc('public.manito_prepare_reset($1,$2,$3,$4,$5)',[actor,id,students,schedule,h]);}
 async function confirm(h=hash(6),name='테스트 학급',actor=teacher,id=a){return rpc('public.manito_confirm_reset($1,$2,$3,$4)',[actor,id,h,name]);}
 await t.test('anon/authenticated cannot invoke RPCs or private reset table; definers pinned',async()=>{
  for(const role of ['anon','authenticated']){
   await db.exec(`set role ${role}`);
   await assert.rejects(prepare());await assert.rejects(confirm());await assert.rejects(db.query('select * from app_private.reset_confirmations'));
   await db.exec('reset role');
  }
  const funcs=(await db.query<{safe:boolean}>(`select p.prosecdef and p.proowner='postgres'::regrole and p.proconfig @> array['search_path=""'] as safe from pg_proc p where p.oid in ('public.manito_prepare_reset(uuid,uuid,boolean,boolean,text)'::regprocedure,'public.manito_confirm_reset(uuid,uuid,text,text)'::regprocedure)`)).rows;
  assert.equal(funcs.length,2);assert.ok(funcs.every(f=>f.safe));
  assert.equal(await rpc("has_function_privilege('service_role','public.manito_confirm_reset(uuid,uuid,text,text)','EXECUTE')"),true);
  await db.exec('set role service_role');await assert.rejects(db.query("update public.classes set status='setup',locked_at=null,revealed_at=null where id=$1",[a]));await assert.rejects(db.query('select * from app_private.reset_confirmations'));await db.exec('reset role');
 });
 await t.test('ownership, direct transition, missing/expired/replaced/stale approvals and exact name reject',async()=>{
  await assert.rejects(prepare(false,false,hash(6),other));await assert.rejects(confirm());
  await assert.rejects(db.query("update public.classes set status='setup',locked_at=null,revealed_at=null where id=$1",[a]));
  await prepare();await assert.rejects(confirm(hash(6),'다른 이름'));await assert.rejects(confirm(hash(6),'테스트 학급',other));
  await prepare(false,false,hash(7));await assert.rejects(confirm());
  await db.query("update app_private.reset_confirmations set expires_at=now()-interval '1 second' where class_id=$1",[a]);await assert.rejects(confirm(hash(7)));
  await prepare();await rpc('public.manito_save_settings($1,$2,$3,$4::jsonb,1)',[teacher,a,'테스트 학급',JSON.stringify(days)]);await assert.rejects(confirm());
  assert.equal((await snapshot()).status,'revealed');assert.equal((await snapshot()).students[0].completedDays.length,1);
 });
 const otherBefore=await snapshot(b);
 await t.test('forced failure rolls back reset AND preserves valid session',async()=>{
  await prepare();const saved=await contents();
  await db.exec(`create function app_private.fixture_fail() returns trigger language plpgsql as $$begin raise exception 'fixture rollback';end$$;create trigger fixture_failure before delete on public.pledges for each row execute function app_private.fixture_fail();`);
  await assert.rejects(confirm());assert.deepEqual(await contents(),saved);
  assert.equal((await rpc('public.manito_student_snapshot($1)',[hash(4)])).revealed,true);
  await db.exec('drop trigger fixture_failure on public.pledges;drop function app_private.fixture_fail()');
 });
 await t.test('preserve roster/schedule, invalidate current and reissued credentials and sessions, fresh versions',async()=>{
  await rpc('public.manito_issue_short_code($1,$2,$3)',[teacher,ids[0],hash(8)]);
  assert.equal(await rpc('public.manito_student_login($1,$2)',[hash(3),hash(9)]),false);
  assert.equal(await rpc('public.manito_student_login($1,$2)',[hash(8),hash(10)]),true);
  const old=await snapshot();await prepare();await confirm();await assert.rejects(confirm());
  const fresh=await snapshot();assert.equal(fresh.status,'setup');assert.equal(fresh.students.length,3);assert.deepEqual(fresh.days,old.days);
  assert.ok(fresh.rosterVersion>old.rosterVersion&&fresh.settingsVersion>old.settingsVersion);
  assert.ok(fresh.students.every((s:any)=>!s.hasCode&&!s.pledged&&!s.completedDays.length));
  for(const h of [hash(3),hash(8)])assert.equal(await rpc('public.manito_student_login($1,$2)',[h,hash(11)]),false);
  for(const h of [hash(4),hash(10)])await assert.rejects(rpc('public.manito_student_snapshot($1)',[h]));
  for(const table of ['assignments','mission_logs','pledges'])assert.equal(await rpc(`(select count(*) from public.${table} where class_id=$1)`,[a]),0);
  assert.deepEqual(await snapshot(b),otherBefore);
  await assert.rejects(rpc('public.manito_rename_student($1,$2,$3,$4,$5)',[teacher,a,ids[0],'과거 버전',old.rosterVersion]));
  await rpc('public.manito_rename_student($1,$2,$3,$4,$5)',[teacher,a,ids[0],'수정 이름',fresh.rosterVersion]);
  await rpc('public.manito_issue_short_code($1,$2,$3)',[teacher,ids[0],hash(12)]);assert.equal(await rpc('public.manito_student_login($1,$2)',[hash(12),hash(13)]),true);
  await rpc('public.manito_prepare_assignments($1,$2,$3::uuid[],$4)',[teacher,a,ids,hash(14)]);await rpc('public.manito_confirm_assignments($1,$2,$3)',[teacher,a,hash(14)]);
  const locked=await snapshot();
  await assert.rejects(rpc('public.manito_remove_student($1,$2,$3,$4)',[teacher,a,ids[0],locked.rosterVersion]));
  await assert.rejects(rpc('public.manito_add_students($1,$2,$3::text[],$4)',[teacher,a,['불가'],locked.rosterVersion]));
 });
 await t.test('all retention combinations work, and stale reset cannot erase a newer activity',async()=>{
  for(const [students,schedule] of [[false,true],[true,false],[true,true]]){
   await prepare(students,schedule);await confirm();
   const s=await snapshot();assert.equal(s.status,'setup');assert.equal(s.students.length,students?0:3);assert.equal(s.days.length,schedule?0:5);
   if(students)await rpc('public.manito_add_students($1,$2,$3::text[],$4)',[teacher,a,['새A','새B','새C'],s.rosterVersion]);
   if(schedule)await rpc('public.manito_save_settings($1,$2,$3,$4::jsonb,$5)',[teacher,a,'테스트 학급',JSON.stringify(days),(await snapshot()).settingsVersion]);
   await assert.rejects(confirm());
  }
  const s=await snapshot();await prepare();await rpc('public.manito_rename_student($1,$2,$3,$4,$5)',[teacher,a,s.students[0].id,'명단 변경',s.rosterVersion]);await assert.rejects(confirm());
  await rpc('public.manito_remove_student($1,$2,$3,$4)',[teacher,a,s.students[0].id,(await snapshot()).rosterVersion]);assert.equal((await snapshot()).students.length,2);
  assert.deepEqual(await snapshot(b),otherBefore);
 });
});

test('reset API rejects forged roles/options; hashes challenge and checks verified teacher identity',async()=>{
 const config={url:'https://fixture.supabase.co',publicKey:'fixture',secretKey:'fixture',pepper:'fixture-only-'.repeat(5),origin:'https://localhost:5173'};
 const calls:{name:string;args:Record<string,unknown>}[]=[];
 const teacher='11111111-1111-4111-8111-111111111111',classId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 const deps:BackendDependencies={verifyTeacher:async()=>teacher,async rpc<T>(name:string,args:Record<string,unknown>){calls.push({name,args});return true as T;}};
 async function send(input:Record<string,unknown>,auth=true){return handleRequest(new Request(config.origin+'/api/backend',{method:'POST',headers:{Origin:config.origin,'Content-Type':'application/json',...(auth?{Authorization:'Bearer fixture'}:{})},body:JSON.stringify(input)}),config,deps,'127.0.0.1');}
 const body={action:'teacher.prepareReset',classId,deleteStudents:false,deleteSchedule:false};
 assert.equal((await send(body,false)).status,401);assert.equal((await send({...body,teacherId:teacher})).status,400);assert.equal((await send({...body,deleteStudents:'false'})).status,400);
 const response=await send(body);assert.equal(response.status,200);const {confirmation}=await response.json();
 const prep=calls.find(c=>c.name==='manito_prepare_reset')!;assert.equal(prep.args.p_teacher,teacher);assert.match(String(prep.args.p_confirmation_hash),/^[a-f0-9]{64}$/);assert.notEqual(prep.args.p_confirmation_hash,confirmation);
 assert.equal((await send({action:'teacher.confirmReset',classId,confirmation,className:'학급'})).status,200);
 assert.equal(calls.find(c=>c.name==='manito_confirm_reset')!.args.p_confirmation_hash,prep.args.p_confirmation_hash);
 assert.equal((await send({action:'teacher.confirmReset',classId,confirmation:'bad',className:'학급'})).status,400);
 assert.equal(databaseError('manito_confirm_reset',{code:'42501'}).status,403);
});
