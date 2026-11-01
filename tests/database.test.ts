import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

// Real PostgreSQL/WASM, not a mocked RLS evaluator. No external project or student data used.
test('SQL migrations: RLS, code/session lifecycle, permissions, cycle lock, ordered days and reveal',async t=>{
 const db=new PGlite();
 try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
   create schema auth; create table auth.users(id uuid primary key);
   create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
  for(const file of ['202611010001_schema.sql','202611010002_api.sql','202611010003_teacher_management.sql'])await db.exec(readFileSync(`supabase/migrations/${file}`,'utf8'));
  await db.exec(readFileSync('supabase/tests/verify_access.sql','utf8'));
  const teacher='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',unapproved='33333333-3333-4333-8333-333333333333';
  const classId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',otherClass='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const students=Array.from({length:4},(_,i)=>`00000000-0000-4000-8000-00000000000${i+1}`);
  const h=(n:number)=>n.toString(16).padStart(64,'0');
  await db.query('insert into auth.users values ($1),($2),($3)',[teacher,other,unapproved]);
  await db.query('insert into app_private.teacher_accounts(user_id) values ($1),($2)',[teacher,other]);
  await db.query('insert into public.classes(id,teacher_id,name) values ($1,$2,$3),($4,$5,$6)',[classId,teacher,'테스트 학급 A',otherClass,other,'테스트 학급 B']);
  for(let i=0;i<4;i++)await db.query('insert into public.students(id,class_id,name) values($1,$2,$3)',[students[i],classId,`학생${i+1}`]);
  // Nonconsecutive, unrestricted weekdays, strictly ordered.
  for(let day=1;day<=5;day++){
   await db.query('insert into public.activity_days values($1,$2,$3)',[classId,day,`2000-01-${String(day*3).padStart(2,'0')}`]);
   await db.query('insert into public.missions values($1,$2,$3,$4)',[classId,day,`미션${day}`,'테스트 미션 설명']);
  }
  async function rpc<T=unknown>(sql:string,args:unknown[]=[]) {return (await db.query<{v:T}>(`select ${sql} as v`,args)).rows[0]?.v;}
  async function asRole(role:string,id:string,run:()=>Promise<void>){
   await db.exec(`set role ${role}`);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);
   try{await run();}finally{await db.exec('reset role');}
  }
  await t.test('all twelve tables enforce RLS; anon cannot select tables or call any server RPC',async()=>{
   const tables=(await db.query<{relname:string;relrowsecurity:boolean;relforcerowsecurity:boolean}>("select relname,relrowsecurity,relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','app_private') and relkind='r'")).rows;
   assert.equal(tables.length,12);assert.ok(tables.every(r=>r.relrowsecurity&&r.relforcerowsecurity));
   const grants=(await db.query<{allowed:boolean}>("select has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE') as allowed from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'manito_%'")).rows;
   assert.ok(grants.length>=10);assert.ok(grants.every(r=>!r.allowed));
   await asRole('anon','',async()=>{
    for(const table of ['students','assignments','mission_logs','access_credentials'])await assert.rejects(db.query(`select * from public.${table}`));
    await assert.rejects(rpc('public.manito_student_snapshot($1)',[h(99)]));
    await assert.rejects(db.exec('create table public.untrusted_table(id integer)'));
   });
  });
  await t.test('teacher read scope, no self-promotion, no direct writes or credential access',async()=>{
   for(const id of [teacher,other,unapproved])await asRole('authenticated',id,async()=>{
    const rows=(await db.query<{id:string}>('select id from public.classes')).rows;
    assert.deepEqual(rows.map(r=>r.id),id===teacher?[classId]:id===other?[otherClass]:[]);
    assert.equal((await db.query('select * from public.students')).rows.length,id===teacher?4:0);
    await assert.rejects(db.query('select * from public.access_credentials'));
    await assert.rejects(db.query('insert into app_private.teacher_accounts(user_id) values($1)',[id]));
    await assert.rejects(db.query("update public.classes set name='forged'"));
   });
   await assert.rejects(rpc('public.manito_teacher_roster($1,$2)',[other,classId]));
   await assert.rejects(rpc('public.manito_teacher_roster($1,$2)',[unapproved,classId]));
  });
  await t.test('unordered/duplicate dates rejected, valid multi-row schedule edits allowed',async()=>{
   await assert.rejects(db.query("update public.activity_days set scheduled_date='2000-01-15' where class_id=$1 and day=1",[classId]));
   await db.query("update public.activity_days set scheduled_date=scheduled_date+1 where class_id=$1",[classId]);
  });
  await t.test('database rejects mutual pairs / disjoint cycles and stale roster confirmations',async()=>{
   // A structurally complete permutation of two mutual pairs still must not lock.
   for(const [giver,receiver] of [[0,1],[1,0],[2,3],[3,2]])await db.query('insert into public.assignments values($1,$2,$3)',[classId,students[giver],students[receiver]]);
   await assert.rejects(db.query("update public.classes set status='locked',locked_at=now() where id=$1",[classId]));
   await db.query('delete from public.assignments where class_id=$1',[classId]);
   await rpc('public.manito_prepare_assignments($1,$2,$3::uuid[],$4)',[teacher,classId,students,h(9)]);
   await db.query("update public.students set name='학생이름변경' where id=$1",[students[0]]);
   await assert.rejects(rpc('public.manito_confirm_assignments($1,$2,$3)',[teacher,classId,h(9)]));
   await db.query("update public.students set name='학생1' where id=$1",[students[0]]);
  });
  await t.test('minimum three, exact roster, preview then confirmation and immutable full cycle',async()=>{
   await assert.rejects(rpc('public.manito_prepare_assignments($1,$2,$3::uuid[],$4)',[teacher,classId,students.slice(0,2),h(10)]));
   await assert.rejects(rpc('public.manito_prepare_assignments($1,$2,$3::uuid[],$4)',[teacher,classId,[students[0],students[0],students[2],students[3]],h(10)]));
   await rpc('public.manito_prepare_assignments($1,$2,$3::uuid[],$4)',[teacher,classId,students,h(10)]);
   assert.equal((await db.query('select * from public.assignments')).rows.length,0);
   await assert.rejects(rpc('public.manito_confirm_assignments($1,$2,$3)',[other,classId,h(10)]));
   await rpc('public.manito_confirm_assignments($1,$2,$3)',[teacher,classId,h(10)]);
   assert.equal((await db.query('select * from public.assignments')).rows.length,4);
   await assert.rejects(rpc('public.manito_confirm_assignments($1,$2,$3)',[teacher,classId,h(10)]));
   await assert.rejects(rpc('public.manito_prepare_assignments($1,$2,$3::uuid[],$4)',[teacher,classId,students,h(11)]));
   await assert.rejects(db.query('delete from public.assignments where class_id=$1',[classId]));
   await assert.rejects(db.query('delete from public.students where id=$1',[students[0]]));
  });
  await t.test('hashed code login, only self logs, pledge and date checks, no reverse info after DAY 5',async()=>{
   for(let i=0;i<2;i++){
    await rpc('public.manito_issue_code($1,$2,$3)',[teacher,students[i],h(100+i)]);
    assert.equal(await rpc('public.manito_student_login($1,$2)',[h(100+i),h(200+i)]),true);
   }
   assert.equal(await rpc('public.manito_student_login($1,$2)',[h(999),h(290)]),false);
   await assert.rejects(rpc('public.manito_student_log($1,1::smallint,true,$2,$3)',[h(200),'아직 서약 안 함','뿌듯해요']));
   for(let i=0;i<2;i++)await rpc('public.manito_student_pledge($1)',[h(200+i)]);
   await rpc('public.manito_student_log($1,1::smallint,true,$2,$3)',[h(200),'나만의 비밀','뿌듯해요']);
   type Snapshot={student:{id:string};mate:{name:string};logs:{text:string}[];revealed:boolean;caredBy?:unknown};
   const own=await rpc<Snapshot>('public.manito_student_snapshot($1)',[h(200)]);
   assert.equal(own.student.id,students[0]);assert.equal(own.mate.name,'학생2');assert.equal(own.logs[0].text,'나만의 비밀');
   assert.equal(own.revealed,false);assert.ok(!Object.hasOwn(own,'caredBy'));
   const second=await rpc<Snapshot>('public.manito_student_snapshot($1)',[h(201)]);assert.equal(second.logs.length,0);assert.ok(!JSON.stringify(second).includes('나만의 비밀'));
   await asRole('authenticated',teacher,async()=>assert.equal((await db.query('select * from public.mission_logs')).rows.length,1));
   await asRole('authenticated',other,async()=>assert.equal((await db.query('select * from public.mission_logs')).rows.length,0));
   await db.query("update public.activity_days set scheduled_date='2099-01-01' where class_id=$1 and day=5",[classId]);
   await assert.rejects(rpc('public.manito_student_log($1,5::smallint,true,$2,$3)',[h(200),'미래 미션 위조','뿌듯해요']));
  });
  await t.test('persistent rate limiter counts denied attempts and isolates buckets',async()=>{
   assert.equal(await rpc('public.manito_rate_limit($1,2,600)',[h(400)]),true);
   assert.equal(await rpc('public.manito_rate_limit($1,2,600)',[h(400)]),true);
   assert.equal(await rpc('public.manito_rate_limit($1,2,600)',[h(400)]),false);
   assert.equal(await rpc('public.manito_rate_limit($1,2,600)',[h(400)]),false);
   assert.equal(await rpc('public.manito_rate_limit($1,2,600)',[h(401)]),true);
  });
  await t.test('reissue rejects old code and all old sessions immediately; logout revokes new session',async()=>{
   await assert.rejects(rpc('public.manito_issue_code($1,$2,$3)',[other,students[0],h(301)]));
   await rpc('public.manito_issue_code($1,$2,$3)',[teacher,students[0],h(301)]);
   assert.equal(await rpc('public.manito_student_login($1,$2)',[h(100),h(302)]),false);
   await assert.rejects(rpc('public.manito_student_snapshot($1)',[h(200)]));
   assert.equal(await rpc('public.manito_student_login($1,$2)',[h(301),h(303)]),true);
   await rpc('public.manito_student_logout($1)',[h(303)]);
   await assert.rejects(rpc('public.manito_student_snapshot($1)',[h(303)]));
  });
  await t.test('expired/revoked sessions and disabled teachers/classes fail closed',async()=>{
   assert.equal(await rpc('public.manito_student_login($1,$2)',[h(301),h(304)]),true);
   await db.query("update app_private.student_sessions set expires_at=now()-interval '1 second' where token_hash=$1",[h(304)]);
   await assert.rejects(rpc('public.manito_student_snapshot($1)',[h(304)]));
   await db.query('update app_private.teacher_accounts set active=false where user_id=$1',[teacher]);
   await assert.rejects(rpc('public.manito_teacher_roster($1,$2)',[teacher,classId]));
   await asRole('authenticated',teacher,async()=>assert.equal((await db.query('select * from public.mission_logs')).rows.length,0));
   await db.query('update app_private.teacher_accounts set active=true where user_id=$1',[teacher]);
   await db.query('update public.classes set active=false where id=$1',[classId]);
   await assert.rejects(rpc('public.manito_student_snapshot($1)',[h(201)]));
   assert.equal(await rpc('public.manito_student_login($1,$2)',[h(101),h(305)]),false);
   await db.query('update public.classes set active=true where id=$1',[classId]);
   await asRole('service_role','',async()=>{assert.ok(await rpc('public.manito_student_snapshot($1)',[h(201)]));});
  });
  await t.test('reveal requires same authorized teacher, expiring single-use challenge, separate confirm',async()=>{
   await assert.rejects(rpc('public.manito_confirm_reveal($1,$2,$3)',[teacher,classId,h(500)]));
   await rpc('public.manito_prepare_reveal($1,$2,$3)',[teacher,classId,h(500)]);
   await assert.rejects(rpc('public.manito_confirm_reveal($1,$2,$3)',[other,classId,h(500)]));
   await db.query("update app_private.confirmations set expires_at=now()-interval '1 second' where token_hash=$1",[h(500)]);
   await assert.rejects(rpc('public.manito_confirm_reveal($1,$2,$3)',[teacher,classId,h(500)]));
   await rpc('public.manito_prepare_reveal($1,$2,$3)',[teacher,classId,h(501)]);
   await rpc('public.manito_confirm_reveal($1,$2,$3)',[teacher,classId,h(501)]);
   await assert.rejects(rpc('public.manito_confirm_reveal($1,$2,$3)',[teacher,classId,h(501)]));
   const result=await rpc<{caredBy:{name:string}}>('public.manito_student_snapshot($1)',[h(201)]);assert.equal(result.caredBy.name,'학생1');
  });
  await t.test('teacher Auth deletion is restricted while class deletion cascades private data',async()=>{
   await assert.rejects(db.query('delete from auth.users where id=$1',[teacher]));
   await db.query('delete from public.classes where id=$1',[classId]);
   for(const table of ['students','assignments','activity_days','missions','mission_logs','pledges','access_credentials'])assert.equal((await db.query(`select * from public.${table}`)).rows.length,0);
   assert.equal((await db.query('select * from app_private.student_sessions')).rows.length,0);
   assert.equal((await db.query('select * from app_private.confirmations')).rows.length,0);
  });
 } finally { await db.close(); }
});
