import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { chromium } from 'playwright';
import { PGlite } from '@electric-sql/pglite';
import { createNodeHandler } from '../api/backend.ts';
import { ApiError } from '../server/security.ts';
import type { BackendDependencies } from '../server/supabase.ts';

test('HTTPS UI → same-origin API → PostgreSQL: teacher and student complete activity', {timeout:120000}, async t=>{
 const db=new PGlite();
 t.after(()=>db.close());
 const origin='https://127.0.0.1:5187',teacher='11111111-1111-4111-8111-111111111111',unapproved='22222222-2222-4222-8222-222222222222',classId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 const jwt=(id:string)=>Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:id,aud:'authenticated',role:'authenticated',exp:Math.floor(Date.now()/1000)+3600,iat:Math.floor(Date.now()/1000)})).toString('base64url')+'.test_signature';
 const token=jwt(teacher);
 const unapprovedToken=jwt(unapproved);
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
 for(const file of ['202611010001_schema.sql','202611010002_api.sql','202611010003_teacher_management.sql','202611010004_short_access_codes.sql','202611010005_activity_reset.sql'])await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));
 await db.query('insert into auth.users values($1),($2)',[teacher,unapproved]);await db.query('insert into app_private.teacher_accounts(user_id) values($1)',[teacher]);await db.query('insert into public.classes(id,teacher_id,name) values($1,$2,$3)',[classId,teacher,'가상 테스트 학급']);
 const deps:BackendDependencies={
  async verifyTeacher(value){if(value===token)return teacher;if(value===unapprovedToken)return unapproved;throw new ApiError(401,'unauthorized');},
  async rpc<T>(name:string,args:Record<string,unknown>){
   if(!/^manito_[a-z_]+$/.test(name))throw new Error('Bad test RPC');
   const entries=Object.entries(args);entries.forEach(([k])=>assert.match(k,/^p_[a-z_]+$/));
   try{return (await db.query<{value:T}>(`select public.${name}(${entries.map(([k],i)=>`${k} => $${i+1}`).join(',')}) as value`,entries.map(([k,v])=>k==='p_days'?JSON.stringify(v):v))).rows[0].value;}
   catch(e){const code=(e as {code?:string}).code;throw new ApiError(code==='28000'?401:code==='42501'?403:code?.startsWith('23')?409:503,'request_failed');}
  },
 };
 const env={SUPABASE_URL:'https://mock.supabase.co',SUPABASE_ANON_KEY:'sb_publishable_fixture_public_12345678',SUPABASE_SECRET_KEY:'sb_secret_fixture_private_12345678',AUTH_PEPPER:'fixture-only-'.repeat(5),APP_ORIGIN:origin};
 const nodeHandler=createNodeHandler(env,deps);
 const server=await createServer({configFile:false,envDir:false,plugins:[react(),tailwindcss(),basicSsl({name:'manito-fixture',certDir:'.npm-cache/test-certs'}),{name:'fixture-only-api',configureServer(server){server.middlewares.use((req,res,next)=>{if(req.url?.split('?')[0]==='/api/backend')void nodeHandler(req,res);else next();});}}],define:{'import.meta.env.VITE_SUPABASE_URL':JSON.stringify(env.SUPABASE_URL),'import.meta.env.VITE_SUPABASE_ANON_KEY':JSON.stringify(env.SUPABASE_ANON_KEY)},server:{host:'127.0.0.1',port:5187,strictPort:true},logLevel:'error'});
 t.after(()=>server.close());await server.listen();
 const executable=process.env.BROWSER_EXECUTABLE||['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/chromium','/usr/bin/google-chrome'].find(existsSync);
 const browser=await chromium.launch({...(executable?{executablePath:executable}:{}),headless:true});
 t.after(()=>browser.close());
 const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:1000},reducedMotion:'reduce'});
 const page=await context.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
 await context.route('https://mock.supabase.co/**',async route=>{
  const req=route.request();const approved=!req.postData()?.includes('unapproved@');const id=approved?teacher:unapproved;
  const response=req.url().includes('/token')?{access_token:approved?token:unapprovedToken,refresh_token:'fixture_refresh',token_type:'bearer',expires_in:3600,user:{id,aud:'authenticated',role:'authenticated',email:approved?'teacher@example.invalid':'unapproved@example.invalid',app_metadata:{},user_metadata:{},created_at:new Date().toISOString()}}:{};
  await route.fulfill({status:200,headers:{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Content-Type':'application/json'},body:JSON.stringify(response)});
 });
 try{
  await page.goto(origin);await page.getByRole('heading',{name:'나의 아지트'}).waitFor();
  assert.equal(await page.getByText('DEMO01',{exact:true}).count(),0);
  await page.locator('footer').getByRole('button',{name:'선생님 공간'}).click();
  await page.getByLabel('이메일',{exact:true}).fill('unapproved@example.invalid');await page.getByLabel('비밀번호',{exact:true}).fill('fixture-not-real');await page.getByRole('button',{name:'교사 로그인',exact:true}).click();
  await page.getByRole('dialog').getByRole('alert').waitFor();assert.equal(await page.getByRole('heading',{name:'우리 반 설정'}).count(),0);
  await page.getByLabel('이메일',{exact:true}).fill('teacher@example.invalid');await page.getByLabel('비밀번호',{exact:true}).fill('fixture-not-real');await page.getByRole('button',{name:'교사 로그인',exact:true}).click();await page.getByRole('heading',{name:'우리 반 설정'}).waitFor();
  await page.getByLabel('학생 명단 추가').fill('가명A\n가명B\n가명C');await page.getByRole('button',{name:'학생 등록',exact:true}).click();await page.getByRole('heading',{name:'학생 3명'}).waitFor();
  await page.getByRole('button',{name:'가명A 이름 수정'}).click();await page.getByLabel('학생 이름',{exact:true}).fill('가명수정');await page.getByRole('button',{name:'이름 저장'}).click();await page.locator('.live-student-row').filter({hasText:'가명수정'}).waitFor();
  assert.equal(await page.getByRole('button',{name:'마니또 배정 미리보기'}).isDisabled(),true);
  for(let i=0;i<5;i++){const editor=page.locator('.mission-edit').nth(i);await editor.getByLabel('날짜',{exact:true}).fill(`2000-01-${String(1+i*3).padStart(2,'0')}`);await editor.getByLabel('미션 제목').fill(`실제 연결 테스트 ${i+1}`);await editor.getByLabel('미션 설명').fill('가상 친구에게 응원해요.');}
  await page.getByRole('button',{name:'설정 저장',exact:true}).click();await page.getByRole('status').filter({hasText:'저장했어요'}).waitFor();
  await page.locator('.live-student-row').filter({hasText:'가명수정'}).getByRole('button',{name:'코드 발급',exact:true}).click();await page.getByRole('button',{name:'확인하고 발급',exact:true}).click();const studentCode=await page.locator('.issued-code').innerText();assert.match(studentCode,/^[A-HJ-NP-Z2-9]{8}$/);await page.getByRole('button',{name:'전달 확인'}).click();
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'발급한 코드 CSV',exact:true}).click();const downloaded=await download;assert.match(downloaded.suggestedFilename(),/CSV|csv/);const csvPath=await downloaded.path();assert.ok(csvPath);const csvRows=readFileSync(csvPath,'utf8').trim().split(/\r?\n/).slice(1);assert.equal(csvRows.length,1);assert.ok(csvRows.every(row=>/,"[A-HJ-NP-Z2-9]{8}"$/.test(row)));
  await page.getByRole('button',{name:'마니또 배정 미리보기'}).click();await page.locator('.assignment-preview').waitFor();assert.equal(await page.locator('.assignment-preview>div').count(),3);
  let rejectedPreview=false;
  await page.route('**/api/backend',async route=>{const body=route.request().postDataJSON();if(body.action==='teacher.confirmAssignments'&&!rejectedPreview){rejectedPreview=true;await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'assignment_preview_expired'})});}else await route.continue();});
  await page.getByRole('button',{name:'확인하고 배정 확정'}).click();await page.getByRole('alert').filter({hasText:'미리보기가 만료'}).waitFor();assert.equal(await page.getByRole('dialog').count(),0);assert.equal(await page.locator('.assignment-preview').count(),0);assert.equal(await page.getByRole('button',{name:'확인하고 배정 확정'}).count(),0);
  await page.unroute('**/api/backend');await page.getByRole('button',{name:'마니또 배정 미리보기'}).click();await page.locator('.assignment-preview').waitFor();assert.equal(await page.getByRole('dialog').getByRole('alert').count(),0);await page.getByRole('button',{name:'확인하고 배정 확정'}).click();
  await page.getByRole('button',{name:'마니또 배정 미리보기'}).waitFor();await page.waitForFunction(()=>document.querySelector<HTMLButtonElement>('.roster-panel>.btn.full')?.disabled===true);
  await page.screenshot({path:'.npm-cache/phase2-teacher.png',fullPage:true});
  // Separate browser context: a student's HTTPS cookie session, not teacher Auth storage.
  const studentContext=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:390,height:844}});const sp=await studentContext.newPage();sp.on('pageerror',e=>errors.push(e.message));
  await sp.goto(origin);await sp.getByRole('button',{name:'코드로 입장',exact:true}).click();await sp.getByLabel('나의 접속 코드').fill(studentCode);await sp.getByRole('button',{name:'입장하기',exact:true}).click();await sp.getByRole('button',{name:'약속해요, 마니또 만나기'}).click();await sp.locator('.mate-name strong').waitFor();assert.notEqual(await sp.locator('.mate-name strong').innerText(),'가명수정');await sp.getByRole('button',{name:'확인했어요',exact:true}).click();
  const cookie=(await studentContext.cookies()).find(c=>c.name==='__Host-manito_session')!;assert.ok(cookie.httpOnly&&cookie.secure);assert.equal(cookie.sameSite,'Strict');assert.ok(!(await sp.evaluate(()=>document.cookie)).includes('manito_session'));
  await sp.locator('.mission-card.available').first().click();await sp.getByLabel('나의 비밀 일지',{exact:true}).fill('서버에만 저장하는 가상 일지');await sp.getByRole('button',{name:'미션 완료',exact:true}).click();await sp.locator('.mission-card.completed').waitFor();
  await sp.reload();await sp.locator('.mission-card.completed').waitFor();assert.deepEqual(await sp.evaluate(()=>Object.keys(localStorage)),[]);
  for(const width of [320,390,768,1440]){await sp.setViewportSize({width,height:900});assert.ok(await sp.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
  await sp.setViewportSize({width:390,height:844});await sp.screenshot({path:'.npm-cache/phase2-student.png',fullPage:true});
  assert.equal(await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('manito.teacher.auth.')).length),1);
  await page.getByRole('button',{name:'새로고침',exact:true}).click();await page.locator('.progress-check').waitFor();assert.equal(await page.locator('.progress-check').count(),1);
  await page.getByRole('button',{name:'우리 반 정체 공개하기'}).click();await page.getByRole('dialog').getByRole('button',{name:'취소',exact:true}).click();
  await sp.getByRole('navigation').getByRole('button',{name:'정체 공개',exact:true}).click();await sp.getByRole('button',{name:'공개 상태 새로고침'}).click();await sp.getByRole('heading',{name:'아직은 비밀이에요'}).waitFor();
  await page.getByRole('button',{name:'우리 반 정체 공개하기'}).click();await page.getByRole('button',{name:'확인하고 정체 공개'}).click();await page.getByRole('button',{name:'공개 완료',exact:true}).waitFor();
  await sp.getByRole('button',{name:'공개 상태 새로고침'}).click();await sp.locator('.reveal-result').waitFor();
  await page.locator('.live-student-row').filter({hasText:'가명수정'}).getByRole('button',{name:'재발급',exact:true}).click();await page.getByRole('button',{name:'확인하고 발급'}).click();const newCode=await page.locator('.issued-code').innerText();assert.notEqual(newCode,studentCode);await page.getByRole('button',{name:'전달 확인'}).click();
  await sp.reload();await sp.getByRole('button',{name:'코드로 입장',exact:true}).waitFor();
  await sp.getByRole('button',{name:'코드로 입장',exact:true}).click();await sp.getByLabel('나의 접속 코드').fill(newCode);await sp.getByRole('button',{name:'입장하기',exact:true}).click();await sp.getByRole('button',{name:'가명수정님, 로그아웃'}).waitFor();await sp.getByRole('button',{name:'가명수정님, 로그아웃'}).click();assert.ok(!(await studentContext.cookies()).some(c=>c.name==='__Host-manito_session'));
  // Only the isolated PGlite fixture is reset; no real Supabase connection.
  await sp.getByRole('button',{name:'코드로 입장',exact:true}).click();await sp.getByLabel('나의 접속 코드').fill(newCode);await sp.getByRole('button',{name:'입장하기',exact:true}).click();await sp.getByRole('button',{name:'가명수정님, 로그아웃'}).waitFor();
  assert.equal(await page.getByRole('button',{name:'가명수정 이름 수정'}).count(),0);
  await page.getByRole('button',{name:'활동 초기화',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'취소',exact:true}).click();
  assert.equal((await db.query<{status:string}>('select status from public.classes where id=$1',[classId])).rows[0].status,'revealed');
  await page.getByRole('button',{name:'활동 초기화',exact:true}).click();await page.getByRole('button',{name:'삭제 대상 확인하고 다음'}).click();
  const resetName=page.getByLabel('확인을 위해 학급 이름 입력');await resetName.fill('다른 학급');assert.equal(await page.getByRole('button',{name:'확인하고 활동 초기화'}).isDisabled(),true);
  await resetName.fill('가상 테스트 학급');await page.getByRole('button',{name:'확인하고 활동 초기화'}).click();await page.getByRole('button',{name:'가명수정 이름 수정'}).waitFor();
  assert.equal(await page.getByRole('heading',{name:'학생 3명'}).count(),1);assert.equal(await page.locator('.progress-check').count(),0);
  assert.equal(await page.getByRole('button',{name:'발급한 코드 CSV',exact:true}).isDisabled(),true);
  await sp.reload();await sp.getByRole('button',{name:'코드로 입장',exact:true}).waitFor();
  await sp.getByRole('button',{name:'코드로 입장',exact:true}).click();await sp.getByLabel('나의 접속 코드').fill(newCode);await sp.getByRole('button',{name:'입장하기',exact:true}).click();await sp.getByRole('dialog').getByRole('alert').waitFor();await sp.getByRole('button',{name:'닫기',exact:true}).click();
  // Existing roster RPCs work again, including cancellation before deletion.
  await page.getByRole('button',{name:'가명B 삭제'}).click();await page.getByRole('dialog').getByRole('button',{name:'취소',exact:true}).click();assert.equal(await page.getByRole('heading',{name:'학생 3명'}).count(),1);
  await page.getByRole('button',{name:'가명B 삭제'}).click();await page.getByRole('button',{name:'확인하고 삭제'}).click();await page.getByRole('heading',{name:'학생 2명'}).waitFor();
  await page.getByLabel('학생 명단 추가').fill('새가명A\n새가명B');await page.getByRole('button',{name:'학생 등록',exact:true}).click();await page.getByRole('heading',{name:'학생 4명'}).waitFor();
  await page.getByRole('button',{name:'활동 초기화',exact:true}).click();await page.getByLabel('학생 명단도 삭제').check();await page.getByLabel('DAY 1~5 날짜와 미션 내용도 삭제').check();await page.getByRole('button',{name:'삭제 대상 확인하고 다음'}).click();await page.getByLabel('확인을 위해 학급 이름 입력').fill('가상 테스트 학급');await page.getByRole('button',{name:'확인하고 활동 초기화'}).click();await page.getByRole('heading',{name:'학생 0명'}).waitFor();assert.equal(await page.locator('.mission-edit input[type="date"]').first().inputValue(),'');
  await page.getByRole('button',{name:'교사 로그아웃'}).click();await page.getByRole('heading',{name:'나의 아지트'}).waitFor();assert.equal(await page.getByRole('heading',{name:'우리 반 설정'}).count(),0);
  assert.deepEqual(await page.evaluate(()=>Object.keys(localStorage)),[]);
  assert.deepEqual(errors,[]);await studentContext.close();
 }catch(error){await page.screenshot({path:'.npm-cache/phase2-failure.png',fullPage:true});throw error;}finally{await context.close();}
});

test('mode boundary: no public config retains demo; partial config never starts demo', {timeout:60000},async()=>{
 const executable=process.env.BROWSER_EXECUTABLE||['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/chromium','/usr/bin/google-chrome'].find(existsSync);
 const browser=await chromium.launch({...(executable?{executablePath:executable}:{}),headless:true});
 try{for(const partial of [false,true]){
  const server=await createServer({configFile:false,envDir:false,plugins:[react(),tailwindcss()],define:{'import.meta.env.VITE_SUPABASE_URL':JSON.stringify(partial?'https://mock.supabase.co':''),'import.meta.env.VITE_SUPABASE_ANON_KEY':JSON.stringify('')},server:{host:'127.0.0.1',port:5188,strictPort:true},logLevel:'error'});
  const context=await browser.newContext();try{
   await server.listen();const page=await context.newPage();await page.goto('http://127.0.0.1:5188');
   if(partial){await page.getByText(/Supabase 공개 환경변수/).waitFor();assert.equal(await page.getByRole('button',{name:'코드로 입장',exact:true}).count(),0);assert.equal(await page.evaluate(()=>localStorage.getItem('manito-v1')),null);}
   else{await page.getByRole('button',{name:'코드로 입장',exact:true}).click();await page.getByLabel('나의 접속 코드').fill('DEMO01');await page.getByRole('button',{name:'입장하기',exact:true}).click();await page.getByRole('button',{name:'약속해요, 마니또 만나기'}).click();assert.equal(await page.locator('.mate-name strong').innerText(),'이서연');assert.ok(await page.evaluate(()=>localStorage.getItem('manito-v1')));}
  }finally{await context.close();await server.close();}
 }}finally{await browser.close();}
});
