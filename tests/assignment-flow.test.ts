import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { handleRequest } from '../server/handler.ts';
import { databaseError, type BackendDependencies } from '../server/supabase.ts';
import { assignmentReadiness } from '../src/backend/assignment-readiness.ts';
import type { AssignmentPreview, TeacherSnapshot } from '../src/backend/types.ts';
test('missing missions reproduce the old conflict, new API blocks safely and retains DB state',async()=>{
 const db=new PGlite();try{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
  for(const file of ['202611010001_schema.sql','202611010002_api.sql','202611010003_teacher_management.sql','202611010004_short_access_codes.sql'])await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));
  const teacher='11111111-1111-4111-8111-111111111111',classId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',ids=[1,2,3].map(n=>`00000000-0000-4000-8000-00000000000${n}`);
  await db.query('insert into auth.users values($1)',[teacher]);await db.query('insert into app_private.teacher_accounts(user_id) values($1)',[teacher]);await db.query('insert into public.classes(id,teacher_id,name) values($1,$2,$3)',[classId,teacher,'가상 재현 학급']);for(const [i,id] of ids.entries())await db.query('insert into public.students(id,class_id,name) values($1,$2,$3)',[id,classId,`가상학생${i+1}`]);
  const originalHash='1'.repeat(64);
  const preview=(await db.query<{pairs:unknown[]}>('select public.manito_prepare_assignments($1,$2,$3::uuid[],$4) as pairs',[teacher,classId,ids,originalHash])).rows[0].pairs;assert.equal(preview.length,3);
  await assert.rejects(db.query('select public.manito_confirm_assignments($1,$2,$3)',[teacher,classId,originalHash]),(e:{code?:string;message?:string})=>e.code==='23514'&&e.message==='Five dates and missions required');
  const calls:string[]=[];
  const deps:BackendDependencies={verifyTeacher:async()=>teacher,async rpc<T>(name:string,args:Record<string,unknown>){calls.push(name);assert.match(name,/^manito_[a-z_]+$/);const entries=Object.entries(args);try{return (await db.query<{v:T}>(`select public.${name}(${entries.map(([k],i)=>`${k} => $${i+1}`).join(',')}) as v`,entries.map(([,v])=>v))).rows[0].v;}catch(e){throw databaseError(name,e as {code?:string;message?:string});}}};
  const config={url:'https://fixture.supabase.co',publicKey:'sb_publishable_fixture_public_123456',secretKey:'sb_secret_fixture_private_123456',pepper:'fixture-only-'.repeat(5),origin:'https://fixture.example.invalid'};
  async function send(action:string,input:Record<string,unknown>={}){return handleRequest(new Request(config.origin+'/api/backend',{method:'POST',headers:{Origin:config.origin,'Content-Type':'application/json',Authorization:'Bearer fixture-only'},body:JSON.stringify({action,classId,...input})}),config,deps,'127.0.0.1');}
  const confirmationsBefore=(await db.query('select * from app_private.confirmations')).rows;
  const notReady=await send('teacher.prepareAssignments',{rosterVersion:3,settingsVersion:0});assert.equal(notReady.status,422);assert.deepEqual(await notReady.json(),{error:'assignment_not_ready'});assert.ok(!calls.includes('manito_prepare_assignments'));assert.ok(!calls.includes('manito_confirm_assignments'));
  assert.deepEqual((await db.query('select * from app_private.confirmations')).rows,confirmationsBefore);assert.equal((await db.query('select * from public.assignments')).rows.length,0);assert.equal((await db.query<{status:string}>('select status from public.classes')).rows[0].status,'setup');
  const days=Array.from({length:5},(_,i)=>({day:i+1,date:`2000-01-${String(1+i*3).padStart(2,'0')}`,title:`미션${i+1}`,description:'가상 미션'}));await db.query('select public.manito_save_settings($1,$2,$3,$4::jsonb,0)',[teacher,classId,'가상 재현 학급',JSON.stringify(days)]);
  calls.length=0;const stale=await send('teacher.prepareAssignments',{rosterVersion:3,settingsVersion:0});assert.equal(stale.status,409);assert.deepEqual(await stale.json(),{error:'assignment_changed'});assert.ok(!calls.includes('manito_prepare_assignments'));
  const prepared=await send('teacher.prepareAssignments',{rosterVersion:3,settingsVersion:1});assert.equal(prepared.status,200);const first=await prepared.json() as AssignmentPreview;assert.equal(first.rosterVersion,3);assert.equal(first.settingsVersion,1);assert.equal(first.state.status,'setup');assert.equal(assignmentReadiness(first.state),'ready');assert.equal(first.pairs.length,3);
  // A new preview replaces the old token without changing roster/settings versions.
  const second=await (await send('teacher.prepareAssignments',{rosterVersion:3,settingsVersion:1})).json() as AssignmentPreview;
  const expired=await send('teacher.confirmAssignments',{confirmation:first.confirmation,rosterVersion:3,settingsVersion:1});assert.equal(expired.status,409);assert.deepEqual(await expired.json(),{error:'assignment_preview_expired'});assert.equal((await db.query('select * from public.assignments')).rows.length,0);
  // A mission edit invalidates the client preview context; DB roster checks remain intact.
  await db.query('select public.manito_save_settings($1,$2,$3,$4::jsonb,1)',[teacher,classId,'가상 재현 학급',JSON.stringify(days)]);
  calls.length=0;const settingsChanged=await send('teacher.confirmAssignments',{confirmation:second.confirmation,rosterVersion:3,settingsVersion:1});assert.equal(settingsChanged.status,409);assert.ok(!calls.includes('manito_confirm_assignments'));
  const third=await (await send('teacher.prepareAssignments',{rosterVersion:3,settingsVersion:2})).json() as AssignmentPreview;
  await db.query('select public.manito_rename_student($1,$2,$3,$4,3)',[teacher,classId,ids[0],'가상 수정']);calls.length=0;
  const rosterChanged=await send('teacher.confirmAssignments',{confirmation:third.confirmation,rosterVersion:3,settingsVersion:2});assert.equal(rosterChanged.status,409);assert.ok(!calls.includes('manito_confirm_assignments'));
  const last=await (await send('teacher.prepareAssignments',{rosterVersion:4,settingsVersion:2})).json() as AssignmentPreview;assert.equal(last.state.rosterVersion,4);
  const confirmed=await send('teacher.confirmAssignments',{confirmation:last.confirmation,rosterVersion:4,settingsVersion:2});assert.equal(confirmed.status,200);
  const state=(await db.query<{state:TeacherSnapshot}>('select public.manito_teacher_snapshot($1,$2) as state',[teacher,classId])).rows[0].state;assert.equal(state.status,'locked');assert.equal(state.students.length,3);assert.equal(state.days.length,5);assert.equal((await db.query('select * from public.assignments')).rows.length,3);
  assert.equal((await send('teacher.prepareAssignments',{rosterVersion:4,settingsVersion:2})).status,409);
 }finally{await db.close();}
});
test('known assignment errors are specific but permission checks and private DB details stay protected',()=>{
 assert.equal(databaseError('manito_confirm_assignments',{code:'23514',message:'Five dates and missions required'}).code,'assignment_not_ready');
 assert.equal(databaseError('manito_confirm_assignments',{code:'42501',message:'Confirmation invalid'}).code,'assignment_preview_expired');
 assert.equal(databaseError('manito_confirm_assignments',{code:'42501',message:'Access denied'}).status,403);
 assert.equal(databaseError('unrelated_rpc',{code:'42501',message:'Confirmation invalid'}).status,403);
 assert.equal(databaseError('manito_confirm_assignments',{code:'23514',message:'private details'}).message,'conflict');
});
test('state changes during preview creation never return an obsolete preview or confirmation token',async()=>{
 const config={url:'https://fixture.supabase.co',publicKey:'sb_publishable_fixture_public_123456',secretKey:'sb_secret_fixture_private_123456',pepper:'fixture-only-'.repeat(5),origin:'https://fixture.example.invalid'};
 const state:TeacherSnapshot={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',name:'가상 학급',status:'setup',rosterVersion:3,settingsVersion:1,students:[1,2,3].map(n=>({id:`00000000-0000-4000-8000-00000000000${n}`,name:`가상${n}`,hasCode:false,pledged:false,completedDays:[]})),days:Array.from({length:5},(_,i)=>({day:i+1,date:`2000-01-0${i+1}`,title:'가상 미션',description:'가상 설명'}))};
 for(const changed of ['rosterVersion','settingsVersion'] as const){
  let reads=0;const calls:string[]=[];
  const deps:BackendDependencies={verifyTeacher:async()=> '11111111-1111-4111-8111-111111111111',async rpc<T>(name:string){calls.push(name);if(name==='manito_rate_limit')return true as T;if(name==='manito_teacher_snapshot'){reads++;return (reads===1?state:{...state,[changed]:state[changed]+1}) as T;}if(name==='manito_prepare_assignments')return [] as T;throw new Error('Unexpected RPC');}};
  const response=await handleRequest(new Request(config.origin+'/api/backend',{method:'POST',headers:{Origin:config.origin,'Content-Type':'application/json',Authorization:'Bearer fixture'},body:JSON.stringify({action:'teacher.prepareAssignments',classId:state.id,rosterVersion:3,settingsVersion:1})}),config,deps,'127.0.0.1');
  assert.equal(response.status,409);assert.deepEqual(await response.json(),{error:'assignment_changed'});assert.equal(reads,2);assert.ok(!calls.includes('manito_confirm_assignments'));
 }
});
