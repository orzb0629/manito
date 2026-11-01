import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { handleRequest } from '../server/handler.ts';
import { ApiError, hashSecret, newCode, normalizeCode } from '../server/security.ts';
import { isNewAccessCode, issuedCodeCsv } from '../src/backend/code-format.ts';
import type { BackendDependencies } from '../server/supabase.ts';
const config={url:'https://fixture.supabase.co',publicKey:'sb_publishable_fixture_public_123456',secretKey:'sb_secret_fixture_private_123456',pepper:'fixture-only-'.repeat(5),origin:'https://fixture.example.invalid'};
const teacher='11111111-1111-4111-8111-111111111111',student='22222222-2222-4222-8222-222222222222';
const req=(action:string,input:Record<string,unknown>={})=>new Request(config.origin+'/api/backend',{method:'POST',headers:{Origin:config.origin,'Content-Type':'application/json',Authorization:'Bearer fixture-only'},body:JSON.stringify({action,...input})});
test('8-character format, legacy normalization and CSV use the same unambiguous alphabet',()=>{
 for(let i=0;i<1000;i++){const code=newCode();assert.ok(isNewAccessCode(code));assert.ok(!/[O0I1]/.test(code));}
 assert.equal(normalizeCode('abcd-ef23'),'ABCDEF23');assert.equal(normalizeCode('A'.repeat(20)),'A'.repeat(20));
 for(const value of ['DEMO01','A'.repeat(7),'A'.repeat(9),'A'.repeat(19),'A'.repeat(21),'ABCDO123','ABCD0123','ABCDI234','ABCD1234','ABCD\nEF23',null])assert.equal(normalizeCode(value),null);
 const csv=issuedCodeCsv([{name:'가명',code:'ABCDEF23'}]);assert.ok(csv.includes('"ABCDEF23"'));assert.ok(issuedCodeCsv([{name:'=formula',code:'ABCDEF23'}]).includes("'=formula"));
 assert.throws(()=>issuedCodeCsv([{name:'가명',code:'A'.repeat(20)}]));
});
test('server retries only credential collisions, with a strict retry bound and no raw-code DB args',async()=>{
 let attempts=0;const hashes:string[]=[];
 const deps:BackendDependencies={verifyTeacher:async()=>teacher,async rpc<T>(name:string,args:Record<string,unknown>){if(name==='manito_rate_limit')return true as T;assert.equal(name,'manito_issue_short_code');attempts++;hashes.push(String(args.p_code_hash));if(attempts<3)throw new ApiError(409,'code_collision');return null as T;}};
 const success=await handleRequest(req('teacher.issueCode',{studentId:student}),config,deps,'127.0.0.1');assert.equal(success.status,200);const body=await success.json();assert.ok(isNewAccessCode(body.code));assert.equal(attempts,3);assert.equal(hashes.at(-1),hashSecret(config.pepper,'code',body.code));assert.ok(hashes.every(h=>/^[a-f0-9]{64}$/.test(h)));assert.ok(success.headers.get('cache-control')?.includes('no-store'));
 attempts=0;deps.rpc=async<T>(name:string)=>{if(name==='manito_rate_limit')return true as T;attempts++;throw new ApiError(409,'code_collision');};
 const exhausted=await handleRequest(req('teacher.issueCode',{studentId:student}),config,deps,'127.0.0.1');assert.equal(exhausted.status,503);assert.equal(attempts,5);assert.deepEqual(await exhausted.json(),{error:'code_generation_unavailable'});
 attempts=0;deps.rpc=async<T>(name:string)=>{if(name==='manito_rate_limit')return true as T;attempts++;throw new ApiError(403,'forbidden');};
 assert.equal((await handleRequest(req('teacher.issueCode',{studentId:student}),config,deps,'127.0.0.1')).status,403);assert.equal(attempts,1);
});
test('normalization cannot bypass code limits; distributed login attempts meet the global limit',async()=>{
 const counters=new Map<string,number>();let authCalls=0;
 const deps:BackendDependencies={verifyTeacher:async()=>teacher,async rpc<T>(name:string,args:Record<string,unknown>){if(name==='manito_rate_limit'){const bucket=String(args.p_bucket),n=(counters.get(bucket)||0)+1;counters.set(bucket,n);return (n<=Number(args.p_limit)) as T;}assert.equal(name,'manito_student_login');authCalls++;return false as T;}};
 for(let i=0;i<5;i++)assert.equal((await handleRequest(req('student.login',{code:i%2?'abcd-ef23':'ABCDEF23'}),config,deps,`127.0.0.${i+1}`)).status,401);
 assert.equal((await handleRequest(req('student.login',{code:'abcd ef23'}),config,deps,'127.0.0.99')).status,429);assert.equal(authCalls,5);
 counters.clear();authCalls=0;
 for(let i=0;i<600;i++)assert.equal((await handleRequest(req('student.login',{code:newCode()}),config,deps,`fixture-ip-${i}`)).status,401);
 assert.equal((await handleRequest(req('student.login',{code:newCode()}),config,deps,'different-fixture-ip')).status,429);assert.equal(authCalls,600);
 // The daily IP counter is separate from the short window, not a process-local limiter.
 assert.ok(counters.has(hashSecret(config.pepper,'rate','login-ip-day:fixture-ip-0')));
});
test('004: old hashes/sessions survive upgrade; collisions roll back; reissue retires 20-character codes',async()=>{
 const db=new PGlite();try{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
  for(const file of ['202611010001_schema.sql','202611010002_api.sql','202611010003_teacher_management.sql'])await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));
  const classId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',otherClass='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',otherStudent='33333333-3333-4333-8333-333333333333';
  await db.query('insert into auth.users values($1)',[teacher]);await db.query('insert into app_private.teacher_accounts(user_id) values($1)',[teacher]);await db.query('insert into public.classes(id,teacher_id,name) values($1,$2,$3),($4,$2,$5)',[classId,teacher,'가명학급A',otherClass,'가명학급B']);await db.query('insert into public.students(id,class_id,name) values($1,$2,$3),($4,$5,$6)',[student,classId,'가명A',otherStudent,otherClass,'가명B']);
  const legacy='A'.repeat(20),legacyHash=hashSecret(config.pepper,'code',legacy),oldSession='9'.repeat(64);
  await db.query('select public.manito_issue_code($1,$2,$3)',[teacher,student,legacyHash]);await db.query('select public.manito_student_login($1,$2)',[legacyHash,oldSession]);
  const credentialsBefore=await db.query('select * from public.access_credentials'),sessionsBefore=await db.query('select * from app_private.student_sessions');
  await db.exec(readFileSync('supabase/migrations/202611010004_short_access_codes.sql','utf8'));
  assert.deepEqual((await db.query('select * from public.access_credentials')).rows,credentialsBefore.rows);assert.deepEqual((await db.query('select * from app_private.student_sessions')).rows,sessionsBefore.rows);
  for(const role of ['anon','authenticated']){await db.exec('set role '+role);try{await assert.rejects(db.query('select public.manito_issue_short_code($1,$2,$3)',[teacher,student,legacyHash]),(e:{code?:string})=>e.code==='42501');}finally{await db.exec('reset role');}}
  // Reject a duplicate for another student AND the same student's current code.
  for(const id of [student,otherStudent])await assert.rejects(db.query('select public.manito_issue_short_code($1,$2,$3)',[teacher,id,legacyHash]),(e:{code?:string})=>e.code==='MC001');
  assert.deepEqual((await db.query('select * from public.access_credentials')).rows,credentialsBefore.rows);assert.deepEqual((await db.query('select * from app_private.student_sessions')).rows,sessionsBefore.rows);
  // Inject a late collision after the precheck: exercises the actual UNIQUE-index
  // exception path without pretending PGlite can run two PostgreSQL sessions.
  await db.exec(`create function app_private.fixture_late_collision() returns trigger language plpgsql set search_path='' as $$ begin
   if new.student_id='${student}'::uuid and new.code_hash=repeat('7',64) then
    insert into public.access_credentials(student_id,code_hash,version,expires_at) values('${otherStudent}'::uuid,new.code_hash,1,now()+interval '1 day');
   end if;return new;end $$;
   create trigger fixture_late_collision before insert on public.access_credentials for each row execute function app_private.fixture_late_collision();`);
  await assert.rejects(db.query('select public.manito_issue_short_code($1,$2,$3)',[teacher,student,'7'.repeat(64)]),(e:{code?:string})=>e.code==='MC001');
  assert.deepEqual((await db.query('select * from public.access_credentials')).rows,credentialsBefore.rows);assert.deepEqual((await db.query('select * from app_private.student_sessions')).rows,sessionsBefore.rows);
  await db.exec('drop trigger fixture_late_collision on public.access_credentials;drop function app_private.fixture_late_collision();');
  const deps:BackendDependencies={verifyTeacher:async()=>teacher,async rpc<T>(name:string,args:Record<string,unknown>){assert.match(name,/^manito_[a-z_]+$/);const entries=Object.entries(args);try{return (await db.query<{v:T}>(`select public.${name}(${entries.map(([k],i)=>`${k} => $${i+1}`).join(',')}) as v`,entries.map(([,v])=>v))).rows[0].v;}catch(e){const code=(e as {code?:string}).code;throw new ApiError(code==='MC001'?409:code==='28000'?401:503,code==='MC001'?'code_collision':'unauthorized');}}};
  const loginOld=await handleRequest(req('student.login',{code:legacy}),config,deps,'127.0.0.1');assert.equal(loginOld.status,200);assert.ok(loginOld.headers.get('set-cookie')?.includes('HttpOnly'));
  const issued=await handleRequest(req('teacher.issueCode',{studentId:student}),config,deps,'127.0.0.1');assert.equal(issued.status,200);const {code}=await issued.json();assert.ok(isNewAccessCode(code));
  assert.equal((await handleRequest(req('student.login',{code:legacy}),config,deps,'127.0.0.1')).status,401);
  await assert.rejects(db.query('select public.manito_student_snapshot($1)',[oldSession]));
  const loginNew=await handleRequest(req('student.login',{code:code.toLowerCase()}),config,deps,'127.0.0.1');assert.equal(loginNew.status,200);assert.deepEqual(await loginNew.json(),{ok:true});
  const saved=(await db.query<{code_hash:string;version:number}>('select code_hash,version from public.access_credentials where student_id=$1',[student])).rows[0];assert.equal(saved.code_hash,hashSecret(config.pepper,'code',code));assert.equal(saved.version,2);
  // Competing requests across classes still cannot allocate one hash to two students.
  const candidateHash='8'.repeat(64);const results=await Promise.allSettled([db.query('select public.manito_issue_short_code($1,$2,$3)',[teacher,student,candidateHash]),db.query('select public.manito_issue_short_code($1,$2,$3)',[teacher,otherStudent,candidateHash])]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
  assert.equal((await db.query('select student_id from public.access_credentials where code_hash=$1',[candidateHash])).rows.length,1);
  await db.exec(readFileSync('supabase/tests/verify_access.sql','utf8'));
 }finally{await db.close();}
});
