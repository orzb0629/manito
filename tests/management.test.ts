import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { handleRequest } from '../server/handler.ts';
import type { BackendDependencies } from '../server/supabase.ts';

test('Phase 2 teacher RPC: ownership, atomic settings, roster versions, lock and progress',async()=>{
 const db=new PGlite();try{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
  for(const file of ['202611010001_schema.sql','202611010002_api.sql','202611010003_teacher_management.sql'])await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));
  const teacher='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',unapproved='33333333-3333-4333-8333-333333333333',classId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  await db.query('insert into auth.users values($1),($2),($3)',[teacher,other,unapproved]);await db.query('insert into app_private.teacher_accounts(user_id) values($1),($2)',[teacher,other]);await db.query('insert into public.classes(id,teacher_id,name) values($1,$2,$3)',[classId,teacher,'관리 테스트']);
  async function rpc<T=any>(sql:string,args:unknown[]=[]){return (await db.query<{v:T}>('select '+sql+' as v',args)).rows[0].v;}
  assert.deepEqual(await rpc('public.manito_teacher_classes($1)',[other]),[]);await assert.rejects(rpc('public.manito_teacher_classes($1)',[unapproved]));
  assert.equal((await rpc('public.manito_teacher_classes($1)',[teacher]))[0].id,classId);
  await assert.rejects(rpc('public.manito_add_students($1,$2,$3::text[],0)',[other,classId,['가명A']]));
  await rpc('public.manito_add_students($1,$2,$3::text[],0)',[teacher,classId,['가명A','가명B','가명C']]);
  let snapshot=await rpc('public.manito_teacher_snapshot($1,$2)',[teacher,classId]);assert.equal(snapshot.students.length,3);
  const version=snapshot.rosterVersion;const a=snapshot.students[0].id;
  await assert.rejects(rpc('public.manito_add_students($1,$2,$3::text[],0)',[teacher,classId,['충돌']]));
  await rpc('public.manito_rename_student($1,$2,$3,$4,$5)',[teacher,classId,a,'수정된가명',version]);
  await assert.rejects(rpc('public.manito_remove_student($1,$2,$3,$4)',[teacher,classId,a,version]));
  const days=Array.from({length:5},(_,i)=>({day:i+1,date:`2000-02-${String(1+i*3).padStart(2,'0')}`,title:`미션${i+1}`,description:'설명'}));
  await rpc('public.manito_save_settings($1,$2,$3,$4::jsonb,0)',[teacher,classId,'저장한학급',JSON.stringify(days)]);
  await assert.rejects(rpc('public.manito_save_settings($1,$2,$3,$4::jsonb,0)',[teacher,classId,'충돌',JSON.stringify(days)]));
  const invalid=structuredClone(days);invalid[4].date=days[0].date;
  await assert.rejects(rpc('public.manito_save_settings($1,$2,$3,$4::jsonb,1)',[teacher,classId,'롤백되어야함',JSON.stringify(invalid)]));
  snapshot=await rpc('public.manito_teacher_snapshot($1,$2)',[teacher,classId]);assert.equal(snapshot.name,'저장한학급');assert.equal(snapshot.settingsVersion,1);assert.equal(snapshot.days.length,5);assert.equal(snapshot.days[4].date,days[4].date);
  assert.ok(!JSON.stringify(snapshot).includes('code_hash'));assert.ok(!Object.hasOwn(snapshot,'assignments'));
  const order=snapshot.students.map((s:{id:string})=>s.id);const h='1'.repeat(64);
  await rpc('public.manito_prepare_assignments($1,$2,$3::uuid[],$4)',[teacher,classId,order,h]);await rpc('public.manito_confirm_assignments($1,$2,$3)',[teacher,classId,h]);
  await assert.rejects(rpc('public.manito_rename_student($1,$2,$3,$4,$5)',[teacher,classId,a,'잠금위조',snapshot.rosterVersion]));
  await assert.rejects(rpc('public.manito_add_students($1,$2,$3::text[],$4)',[teacher,classId,['잠금위조'],snapshot.rosterVersion]));
  await rpc('public.manito_save_settings($1,$2,$3,$4::jsonb,1)',[teacher,classId,'잠금후일정수정',JSON.stringify(days)]);
  await rpc('public.manito_issue_code($1,$2,$3)',[teacher,a,'2'.repeat(64)]);await rpc('public.manito_student_login($1,$2)',['2'.repeat(64),'3'.repeat(64)]);await rpc('public.manito_student_pledge($1)',['3'.repeat(64)]);await rpc('public.manito_student_log($1,1::smallint,true,$2,$3)',['3'.repeat(64),'개인 비밀 일지','뿌듯해요']);
  snapshot=await rpc('public.manito_teacher_snapshot($1,$2)',[teacher,classId]);assert.deepEqual(snapshot.students.find((s:{id:string})=>s.id===a).completedDays,[1]);assert.ok(!JSON.stringify(snapshot).includes('개인 비밀 일지'));
  assert.equal((await rpc('public.manito_teacher_logs($1,$2,$3)',[teacher,classId,a]))[0].text,'개인 비밀 일지');await assert.rejects(rpc('public.manito_teacher_logs($1,$2,$3)',[other,classId,a]));
  await db.exec(readFileSync('supabase/tests/verify_access.sql','utf8'));
 }finally{await db.close();}
});
test('Phase 2 HTTP input boundary rejects date tricks, stale-role fields and oversized roster',async()=>{
 const config={url:'https://test.supabase.co',publicKey:'sb_publishable_test_value_12345678',secretKey:'sb_secret_test_value_123456789',pepper:'x'.repeat(48),origin:'https://localhost:5173'};
 const calls:{name:string;args:Record<string,unknown>}[]=[];const deps:BackendDependencies={verifyTeacher:async()=> '11111111-1111-4111-8111-111111111111',async rpc<T>(name:string,args:Record<string,unknown>){calls.push({name,args});return true as T;}};
 async function send(body:unknown){return handleRequest(new Request(config.origin+'/api/backend',{method:'POST',headers:{Origin:config.origin,'Content-Type':'application/json',Authorization:'Bearer test'},body:JSON.stringify(body)}),config,deps,'127.0.0.1');}
 const classId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 assert.equal((await send({action:'teacher.classes',teacherId:'forged'})).status,400);
 assert.equal((await send({action:'teacher.addStudents',classId,version:0,names:Array(81).fill('가명')})).status,400);
 const days=Array.from({length:5},(_,i)=>({day:i+1,date:`2026-02-${String(1+i).padStart(2,'0')}`,title:'미션',description:'설명'}));days[4].date='2026-02-30';
 assert.equal((await send({action:'teacher.saveSettings',classId,version:0,name:'학급',days})).status,400);
 assert.ok(!calls.some(c=>c.name==='manito_save_settings'));
});

test('003 review: upgrade preserves live-shaped data and safely replaces overlapping dates',async t=>{
 const db=new PGlite();try{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
   create schema auth;create table auth.users(id uuid primary key);
   create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
  for(const file of ['202611010001_schema.sql','202611010002_api.sql'])await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));
  const migration=readFileSync('supabase/migrations/202611010003_teacher_management.sql','utf8');
  const teacher='11111111-1111-4111-8111-111111111111',classId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',setupClass='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const ids=[1,2,3].map(n=>`00000000-0000-4000-8000-00000000000${n}`),hash=(n:number)=>String(n).repeat(64);
  async function rpc<T=any>(sql:string,args:unknown[]=[]){return (await db.query<{value:T}>('select '+sql+' as value',args)).rows[0].value;}
  await db.query('insert into auth.users values($1)',[teacher]);await db.query('insert into app_private.teacher_accounts(user_id) values($1)',[teacher]);
  await db.query('insert into public.classes(id,teacher_id,name) values($1,$2,$3),($4,$2,$5)',[classId,teacher,'기존 학급',setupClass,'편집 학급']);
  for(let i=0;i<3;i++)await db.query('insert into public.students(id,class_id,name) values($1,$2,$3)',[ids[i],classId,`기존가명${i+1}`]);
  const initial=Array.from({length:5},(_,i)=>({day:i+1,date:`2000-03-${String(1+i*3).padStart(2,'0')}`,title:`기존 미션${i+1}`,description:'기존 설명'}));
  for(const d of initial){await db.query('insert into public.activity_days values($1,$2,$3)',[classId,d.day,d.date]);await db.query('insert into public.missions values($1,$2,$3,$4)',[classId,d.day,d.title,d.description]);}
  await rpc('public.manito_prepare_assignments($1,$2,$3::uuid[],$4)',[teacher,classId,ids,hash(1)]);await rpc('public.manito_confirm_assignments($1,$2,$3)',[teacher,classId,hash(1)]);
  await rpc('public.manito_issue_code($1,$2,$3)',[teacher,ids[0],hash(2)]);await rpc('public.manito_student_login($1,$2)',[hash(2),hash(3)]);await rpc('public.manito_student_pledge($1)',[hash(3)]);await rpc('public.manito_student_log($1,1::smallint,true,$2,$3)',[hash(3),'보존해야 하는 일지','뿌듯해요']);await rpc('public.manito_rate_limit($1,5,600)',[hash(4)]);await rpc('public.manito_prepare_reveal($1,$2,$3)',[teacher,classId,hash(5)]);
  const tables=['public.classes','public.activity_days','public.students','public.assignments','public.missions','public.mission_logs','public.pledges','public.access_credentials','app_private.teacher_accounts','app_private.student_sessions','app_private.rate_limits','app_private.confirmations'];
  async function dataSnapshot(){const result:Record<string,unknown>={};for(const table of tables){const value=table==='public.classes'?"to_jsonb(t)-'settings_version'":'to_jsonb(t)';result[table]=await rpc(`(select coalesce(jsonb_agg(${value} order by ${value}::text),'[]'::jsonb) from ${table} t)`);}return result;}
  const before=await dataSnapshot();
  const oldFunctions=(await db.query('select oid,proowner,proacl,pg_get_functiondef(oid) as definition from pg_proc where pronamespace in (\'public\'::regnamespace,\'app_private\'::regnamespace) order by oid')).rows;
  await t.test('unexpected migration owner is rejected before schema changes',async()=>{
   await db.exec('set role service_role');
   await assert.rejects(db.exec(migration),(e:{code?:string})=>e.code==='42501');
   await db.exec('rollback;reset role');
   assert.equal(await rpc("(select count(*) from information_schema.columns where table_schema='public' and table_name='classes' and column_name='settings_version')"),0);
  });
  await db.exec(migration);
  await t.test('003 application preserves every existing row and 001/002 function definition/ACL',async()=>{
   assert.deepEqual(await dataSnapshot(),before);
   assert.deepEqual((await db.query('select settings_version from public.classes')).rows,[{settings_version:0},{settings_version:0}]);
   const oldOids=oldFunctions.map((r:any)=>r.oid);
   assert.deepEqual((await db.query('select oid,proowner,proacl,pg_get_functiondef(oid) as definition from pg_proc where oid=any($1::oid[]) order by oid',[oldOids])).rows,oldFunctions);
  });
  const signatures=[
   'public.manito_teacher_classes(uuid)','public.manito_teacher_snapshot(uuid,uuid)',
   'app_private.assert_editable_roster(uuid,uuid,integer)','public.manito_add_students(uuid,uuid,text[],integer)',
   'public.manito_rename_student(uuid,uuid,uuid,text,integer)','public.manito_remove_student(uuid,uuid,uuid,integer)',
   'public.manito_save_settings(uuid,uuid,text,jsonb,integer)','public.manito_teacher_logs(uuid,uuid,uuid)',
  ];
  await t.test('all eight definers have pinned owner/search_path and actual client EXECUTE denial',async()=>{
   for(const signature of signatures){
    const row=(await db.query<{prosecdef:boolean;proconfig:string[];owner:string;anon:boolean;authenticated:boolean;service:boolean}>(`select p.prosecdef,p.proconfig,r.rolname as owner,has_function_privilege('anon',p.oid,'EXECUTE') as anon,has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated,has_function_privilege('service_role',p.oid,'EXECUTE') as service from pg_proc p join pg_roles r on r.oid=p.proowner where p.oid=$1::regprocedure`,[signature])).rows[0];
    assert.ok(row.prosecdef);assert.equal(row.owner,'postgres');assert.ok(row.proconfig.some(v=>/^search_path=(?:"")?$/.test(v)));assert.equal(row.anon,false);assert.equal(row.authenticated,false);assert.equal(row.service,!signature.startsWith('app_private.'));
   }
   const attempts=[
    ['public.manito_teacher_classes($1)',[teacher]],['public.manito_teacher_snapshot($1,$2)',[teacher,classId]],
    ['app_private.assert_editable_roster($1,$2,0)',[teacher,setupClass]],['public.manito_add_students($1,$2,$3::text[],0)',[teacher,setupClass,['위조']]],
    ['public.manito_rename_student($1,$2,$3,$4,0)',[teacher,classId,ids[0],'위조']],['public.manito_remove_student($1,$2,$3,0)',[teacher,classId,ids[0]]],
    ['public.manito_save_settings($1,$2,$3,$4::jsonb,0)',[teacher,classId,'위조',JSON.stringify(initial)]],['public.manito_teacher_logs($1,$2,$3)',[teacher,classId,ids[0]]],
   ] as const;
   for(const role of ['anon','authenticated']){await db.exec('set role '+role);try{for(const [sql,args] of attempts)await assert.rejects(rpc(sql,[...args]),(e:{code?:string})=>e.code==='42501');}finally{await db.exec('reset role');}}
   assert.deepEqual(await dataSnapshot(),before);
  });
  async function save(days:typeof initial,version:number){return rpc('public.manito_save_settings($1,$2,$3,$4::jsonb,$5)',[teacher,classId,'기존 학급',JSON.stringify(days),version]);}
  await t.test('overlapping future/earlier date shifts survive IMMEDIATE caller constraints at COMMIT',async()=>{
   const forward=initial.map(d=>({...d,date:new Date(Date.parse(d.date+'T00:00:00Z')+3*86400000).toISOString().slice(0,10)}));
   // New DAY 1 equals old DAY 2: an intermediate duplicate/order violation is expected.
   await db.exec('begin;set constraints all immediate');
   try{await save(forward,0);await db.exec('commit');}catch(e){await db.exec('rollback');throw e;}
   assert.deepEqual((await rpc('public.manito_teacher_snapshot($1,$2)',[teacher,classId])).days,forward);
   await db.exec('begin;set constraints all immediate');
   try{await save(initial,1);await db.exec('commit');}catch(e){await db.exec('rollback');throw e;}
   assert.deepEqual((await rpc('public.manito_teacher_snapshot($1,$2)',[teacher,classId])).days,initial);
   for(const table of ['public.mission_logs','public.assignments','public.students','public.pledges','public.access_credentials','app_private.student_sessions'])assert.deepEqual((await dataSnapshot())[table],before[table]);
  });
  await t.test('bad final dates, JSON types and stale settings reject without partial writes',async()=>{
   const stable=await dataSnapshot();const cases=[initial.map((d,i)=>i===4?{...d,date:initial[0].date}:d),initial.map((d,i)=>i===4?{...d,date:'2000-02-30'}:d),initial.map((d,i)=>i===4?{...d,title:123}:d)];
   for(const days of cases)await assert.rejects(rpc('public.manito_save_settings($1,$2,$3,$4::jsonb,2)',[teacher,classId,'덮어쓰기 금지',JSON.stringify(days)]));
   for(const days of [null,{},[],initial.slice(0,4)])await assert.rejects(rpc('public.manito_save_settings($1,$2,$3,$4::jsonb,2)',[teacher,classId,'덮어쓰기 금지',JSON.stringify(days)]),(e:{code?:string})=>e.code==='23514');
   await assert.rejects(save(initial,0));assert.deepEqual(await dataSnapshot(),stable);
  });
  await t.test('competing stale roster/settings requests have one winner; class lock remains shared with 002',async()=>{
   // PGlite queues a single backend: verifies optimistic conflicts, not real multi-session wait timing.
   const edits=await Promise.allSettled([rpc('public.manito_add_students($1,$2,$3::text[],0)',[teacher,setupClass,['성공후보A']]),rpc('public.manito_add_students($1,$2,$3::text[],0)',[teacher,setupClass,['성공후보B']])]);
   assert.equal(edits.filter(r=>r.status==='fulfilled').length,1);assert.equal(edits.filter(r=>r.status==='rejected').length,1);
   assert.equal((await rpc('public.manito_teacher_snapshot($1,$2)',[teacher,setupClass])).students.length,1);
   const settings=await Promise.allSettled([save(initial,2),save(initial,2)]);assert.equal(settings.filter(r=>r.status==='fulfilled').length,1);
   const lock=await rpc<string>("pg_get_functiondef('app_private.assert_owner(uuid,uuid)'::regprocedure)");assert.match(lock,/for update/i);
   const roster=await rpc<string>("pg_get_functiondef('app_private.assert_editable_roster(uuid,uuid,integer)'::regprocedure)");assert.ok(roster.indexOf('assert_owner')<roster.indexOf('roster_version=p_version'));
   await assert.rejects(rpc('public.manito_add_students($1,$2,$3::text[],3)',[teacher,classId,['확정 후 변경 금지']]));
  });
 }finally{await db.close();}
});
