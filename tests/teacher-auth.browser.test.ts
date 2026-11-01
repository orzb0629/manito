import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {existsSync} from 'node:fs';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import {chromium} from 'playwright';

test('teacher Auth: reload, bootstrap gate, automatic refresh, logout and invalidation remain separate from student auth',{timeout:120000},async t=>{
 const origin='https://127.0.0.1:5191',supabaseUrl='https://teacher-fixture.supabase.co';
 const userId='11111111-1111-4111-8111-111111111111',classId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 const storageKey='manito.teacher.auth.teacher-fixture.supabase.co';
 const user={id:userId,aud:'authenticated',role:'authenticated',email:'teacher@example.invalid',app_metadata:{},user_metadata:{},created_at:new Date().toISOString()};
 const validTokens=new Set<string>();let sequence=0,refreshCalls=0,classesCalls=0,classesBlocked:Promise<void>|null=null,networkFailure=false,serverRevoked=false,refreshRevoked=false;
 const actions:string[]=[];
 function session(){sequence++;const now=Math.floor(Date.now()/1000);const token=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:userId,aud:'authenticated',role:'authenticated',iat:now,exp:now+3600,fixture:sequence})).toString('base64url')+'.fixture-signature';validTokens.add(token);return{access_token:token,refresh_token:`fixture-refresh-${sequence}`,token_type:'bearer',expires_in:3600,user};}
 const server=await createServer({configFile:false,envDir:false,plugins:[react(),tailwindcss(),basicSsl({name:'teacher-auth-fixture',certDir:'.npm-cache/teacher-auth-certs'})],define:{'import.meta.env.VITE_SUPABASE_URL':JSON.stringify(supabaseUrl),'import.meta.env.VITE_SUPABASE_ANON_KEY':JSON.stringify('sb_publishable_teacher_fixture_12345678')},server:{host:'127.0.0.1',port:5191,strictPort:true},logLevel:'error'});
 t.after(()=>server.close());await server.listen();
 const executable=process.env.BROWSER_EXECUTABLE||['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/chromium','/usr/bin/google-chrome'].find(existsSync);
 const browser=await chromium.launch({...(executable?{executablePath:executable}:{}),headless:true});t.after(()=>browser.close());
 const context=await browser.newContext({ignoreHTTPSErrors:true});const page=await context.newPage();page.setDefaultTimeout(10000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.clock.install();
 await context.route(supabaseUrl+'/**',async route=>{
  const request=route.request(),url=new URL(request.url());const headers={'Content-Type':'application/json','Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS'};
  if(request.method()==='OPTIONS'){await route.fulfill({status:204,headers});return;}
  if(url.pathname.endsWith('/logout')){await route.fulfill({status:204,headers});return;}
  if(url.pathname.endsWith('/token')){
   const refresh=url.searchParams.get('grant_type')==='refresh_token';if(refresh)refreshCalls++;
   if(refresh&&refreshRevoked){await route.fulfill({status:400,headers,body:JSON.stringify({code:'refresh_token_not_found',message:'Fixture refresh revoked'})});return;}
   await route.fulfill({status:200,headers,body:JSON.stringify(session())});return;
  }
  await route.fulfill({status:200,headers,body:JSON.stringify({user})});
 });
 await context.route('**/api/backend',async route=>{
  const request=route.request(),body=request.postDataJSON();actions.push(body.action);
  const reply=(status:number,value:unknown)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});
  if(body.action==='student.snapshot'){await reply(401,{error:'unauthorized'});return;}
  if(body.action==='teacher.classes'){classesCalls++;if(classesBlocked)await classesBlocked;if(networkFailure){await reply(503,{error:'backend_unavailable'});return;}}
  const bearer=request.headers().authorization?.replace(/^Bearer /,'');
  if(!bearer||!validTokens.has(bearer)||serverRevoked){await reply(401,{error:'unauthorized'});return;}
  if(body.action==='teacher.classes'){await reply(200,[{id:classId,name:'인증 테스트 학급',status:'setup'}]);return;}
  if(body.action==='teacher.snapshot'){await reply(200,{id:classId,name:'인증 테스트 학급',status:'setup',rosterVersion:0,settingsVersion:0,students:[],days:[]});return;}
  await reply(400,{error:'invalid_action'});
 });
 const hasStoredSession=()=>page.evaluate(key=>localStorage.getItem(key)!==null,storageKey);
 async function login(){await page.locator('footer').getByRole('button',{name:'선생님 공간'}).click();await page.getByLabel('이메일',{exact:true}).fill('teacher@example.invalid');await page.getByLabel('비밀번호',{exact:true}).fill('fixture-not-real');await page.getByRole('button',{name:'교사 로그인',exact:true}).click();await page.getByRole('heading',{name:'우리 반 설정'}).waitFor();}
 try{
  await page.goto(origin);await page.getByRole('heading',{name:'나의 아지트'}).waitFor();await login();assert.equal(await hasStoredSession(),true);
  let unblock=()=>{};classesBlocked=new Promise<void>(resolve=>{unblock=resolve;});const before=classesCalls;
  await page.reload();await page.getByRole('status').filter({hasText:'교사 로그인 상태를 확인'}).waitFor();assert.equal(await page.getByRole('heading',{name:'선생님 로그인',exact:true}).count(),0);assert.equal(await page.getByRole('heading',{name:'우리 반 설정'}).count(),0);
  classesBlocked=null;unblock();await page.getByRole('heading',{name:'우리 반 설정'}).waitFor();assert.ok(classesCalls>before);
  // SDK auto-refresh timer, with virtual browser time. Never return stored token values.
  await page.evaluate(key=>{const value=JSON.parse(localStorage.getItem(key)!);value.expires_at=Math.floor(Date.now()/1000)+1;localStorage.setItem(key,JSON.stringify(value));},storageKey);
  const refreshed=page.waitForResponse(r=>r.url().includes('grant_type=refresh_token')&&r.status()===200);
  await page.clock.fastForward(31000);await refreshed;assert.ok(refreshCalls>0);assert.equal(await hasStoredSession(),true);
  await page.reload();await page.getByRole('heading',{name:'우리 반 설정'}).waitFor();
  networkFailure=true;await page.reload();await page.getByRole('alert').filter({hasText:'교사 로그인 상태를 확인하지 못했어요'}).waitFor();assert.equal(await hasStoredSession(),true);assert.equal(await page.getByRole('heading',{name:'선생님 로그인',exact:true}).count(),0);
  networkFailure=false;await page.getByRole('button',{name:'다시 확인',exact:true}).click();await page.getByRole('heading',{name:'우리 반 설정'}).waitFor();
  await page.getByRole('button',{name:'교사 로그아웃'}).click();await page.getByRole('heading',{name:'나의 아지트'}).waitFor();assert.equal(await hasStoredSession(),false);await page.reload();await page.getByRole('heading',{name:'나의 아지트'}).waitFor();assert.equal(await page.getByRole('heading',{name:'우리 반 설정'}).count(),0);
  await login();serverRevoked=true;await page.reload();await page.getByRole('alert').filter({hasText:'교사 로그인이 만료되었거나'}).waitFor();assert.equal(await page.getByRole('heading',{name:'우리 반 설정'}).count(),0);assert.equal(await hasStoredSession(),false);
  serverRevoked=false;await login();refreshRevoked=true;
  await page.evaluate(key=>{const value=JSON.parse(localStorage.getItem(key)!);value.expires_at=Math.floor(Date.now()/1000)-3600;localStorage.setItem(key,JSON.stringify(value));},storageKey);
  await page.reload();await page.getByRole('heading',{name:'나의 아지트'}).waitFor();assert.equal(await page.getByRole('heading',{name:'우리 반 설정'}).count(),0);assert.equal(await hasStoredSession(),false);
  await page.locator('footer').getByRole('button',{name:'선생님 공간'}).click();await page.getByRole('heading',{name:'선생님 로그인',exact:true}).waitFor();
  assert.ok(!actions.some(action=>action==='student.login'||/Assignments|Reveal/.test(action)));assert.deepEqual(errors,[]);
 }finally{classesBlocked=null;await context.close();}
});
