import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolveClientConfig } from '../src/backend/config.ts';
import { readServerConfig } from '../server/config.ts';
import { handleRequest } from '../server/handler.ts';
import { ApiError, hashSecret, newCode, newToken, randomCycle, readSession, sessionCookie, COOKIE_NAME } from '../server/security.ts';
import type { BackendDependencies } from '../server/supabase.ts';

const config = { url: 'https://example.supabase.co', publicKey: 'sb_publishable_public_key_example', secretKey: 'sb_secret_server_only_example', pepper: 'x'.repeat(48), origin: 'https://class.example.com' };
const jwt = (role: string) => `e30.${Buffer.from(JSON.stringify({role})).toString('base64url')}.signature`;
test('공개 설정: 둘 다 없으면 데모, 일부 누락·secret·service_role은 실패 폐쇄', () => {
 assert.deepEqual(resolveClientConfig({}),{mode:'demo'});
 for(const env of [{VITE_SUPABASE_URL:config.url},{VITE_SUPABASE_ANON_KEY:config.publicKey},{VITE_SUPABASE_URL:config.url,VITE_SUPABASE_ANON_KEY:config.secretKey},{VITE_SUPABASE_URL:config.url,VITE_SUPABASE_ANON_KEY:jwt('service_role')},{VITE_SUPABASE_URL:'http://example.com',VITE_SUPABASE_ANON_KEY:config.publicKey}]) assert.equal(resolveClientConfig(env).mode,'invalid');
 assert.equal(resolveClientConfig({VITE_SUPABASE_URL:config.url,VITE_SUPABASE_ANON_KEY:config.publicKey}).mode,'supabase');
 assert.equal(resolveClientConfig({VITE_SUPABASE_URL:config.url,VITE_SUPABASE_ANON_KEY:jwt('anon')}).mode,'supabase');
 assert.throws(()=>readServerConfig({}));
 assert.throws(()=>readServerConfig({ SUPABASE_URL:config.url,SUPABASE_ANON_KEY:config.publicKey,SUPABASE_SECRET_KEY:config.secretKey,AUTH_PEPPER:config.pepper,APP_ORIGIN:'https://evil.example/path' }));
});
test('REST endpoint URL is rejected with actionable guidance without echoing configured values',()=>{
 const url='https://private-fixture.supabase.co/rest/v1/';const key='sb_publishable_fixture_public_123456789';
 const result=resolveClientConfig({VITE_SUPABASE_URL:url,VITE_SUPABASE_ANON_KEY:key});assert.equal(result.mode,'invalid');
 if(result.mode==='invalid'){assert.match(result.message,/경로를 제외한 프로젝트 기본 주소/);assert.ok(!result.message.includes(url));assert.ok(!result.message.includes(key));}
 assert.equal(resolveClientConfig({VITE_SUPABASE_URL:new URL(url).origin,VITE_SUPABASE_ANON_KEY:key}).mode,'supabase');
});
test('운영 배정은 최소 3명, 상호쌍 없이 전체가 하나의 순환',()=>{
 assert.throws(()=>randomCycle([1,2]));
 for(let n=3;n<=40;n++)for(let t=0;t<20;t++){
  const input=Array.from({length:n},(_,i)=>i);const order=randomCycle(input);assert.deepEqual(input,Array.from({length:n},(_,i)=>i));
  assert.equal(new Set(order).size,n);
  const next=new Map(order.map((id,i)=>[id,order[(i+1)%n]]));
  let current=order[0];const visited=new Set();for(let i=0;i<n;i++){visited.add(current);const receiver=next.get(current)!;assert.notEqual(receiver,current);assert.notEqual(next.get(receiver),current);current=receiver;}
  assert.equal(current,order[0]);assert.equal(visited.size,n);
 }
});
test('개인 코드와 토큰은 서버 난수이며 용도별 해시가 분리된다',()=>{
 const codes=new Set(Array.from({length:500},()=>newCode()));assert.equal(codes.size,500);
 codes.forEach(code=>assert.match(code,/^[A-HJ-NP-Z2-9]{8}$/));
 assert.match(newToken(),/^[A-Za-z0-9_-]{43}$/);
 assert.notEqual(hashSecret(config.pepper,'code','same'),hashSecret(config.pepper,'session','same'));
 const cookie=sessionCookie(newToken());for(const flag of ['HttpOnly','Secure','SameSite=Strict','Path=/','Max-Age=43200']) assert.ok(cookie.includes(flag));assert.ok(cookie.startsWith('__Host-'));
 assert.ok(!cookie.includes('Domain='));
});
function request(body: unknown, options: {origin?: string; cookie?: string; auth?: string; method?: string} = {}) {
 return new Request(`${config.origin}/api/backend`,{method:options.method||'POST',headers:{'Content-Type':'application/json',Origin:options.origin??config.origin,...(options.cookie?{Cookie:options.cookie}:{}),...(options.auth?{Authorization:options.auth}:{})},...(options.method==='GET'?{}:{body:JSON.stringify(body)})});
}
function fake() {
 const calls: {name:string;args:Record<string,unknown>}[]=[];
 const deps:BackendDependencies={async rpc<T>(name:string,args:Record<string,unknown>){calls.push({name,args});return true as T;},async verifyTeacher(){return '11111111-1111-4111-8111-111111111111';}};
 return {calls,deps};
}
test('API는 CSRF·학생 ID/역할 위조·쿠키 누락·데모 코드를 거부한다',async()=>{
 const {deps,calls}=fake();
 assert.equal((await handleRequest(request({action:'student.login',code:newCode()},{origin:'https://evil.example'}),config,deps,'127.0.0.1')).status,403);
 assert.equal(calls.length,0);
 assert.equal((await handleRequest(request({action:'student.snapshot',studentId:'victim'}),config,deps,'ip')).status,400);
 assert.equal((await handleRequest(request({action:'student.snapshot',role:'teacher'}),config,deps,'ip')).status,400);
 assert.equal((await handleRequest(request({action:'student.snapshot'}),config,deps,'ip')).status,401);
 assert.equal((await handleRequest(request({action:'student.login',code:'DEMO01'}),config,deps,'ip')).status,401);
 assert.ok(!calls.some(c=>c.name==='manito_student_login'));
 assert.equal((await handleRequest(request({action:'teacher.prepareReveal',classId:'22222222-2222-4222-8222-222222222222'}),config,deps,'ip')).status,401);
});
test('원본 코드·세션 토큰은 DB RPC 또는 JSON 응답에 남지 않는다',async()=>{
 const {deps,calls}=fake();const code=newCode();
 const response=await handleRequest(request({action:'student.login',code}),config,deps,'127.0.0.1');
 assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true});
 const cookie=response.headers.get('set-cookie')!;const rawToken=cookie.split(';')[0].split('=')[1];
 assert.ok(!JSON.stringify(calls).includes(code));assert.ok(!JSON.stringify(calls).includes(rawToken));
 assert.equal(calls.find(c=>c.name==='manito_student_login')!.args.p_session_hash,hashSecret(config.pepper,'session',rawToken));
 assert.equal(calls.filter(c=>c.name==='manito_rate_limit').length,4);
});
test('출처 누락·중복 쿠키·조작된 교사 토큰은 거부한다',async()=>{
 const {deps,calls}=fake();
 const noOrigin=request({action:'student.login',code:newCode()});noOrigin.headers.delete('Origin');
 assert.equal((await handleRequest(noOrigin,config,deps,'ip')).status,403);assert.equal(calls.length,0);
 const token=newToken();assert.throws(()=>readSession(request({action:'student.snapshot'},{cookie:`${COOKIE_NAME}=${token}; ${COOKIE_NAME}=${token}`})));
 deps.verifyTeacher=async()=>{throw new ApiError(401,'unauthorized');};
 assert.equal((await handleRequest(request({action:'teacher.prepareReveal',classId:'22222222-2222-4222-8222-222222222222'},{auth:'Bearer forged-token'}),config,deps,'ip')).status,401);
 assert.equal(calls.length,0);
});
test('요청 제한 장애·인증 실패는 우회되지 않고 내부 오류 정보는 노출하지 않는다',async()=>{
 const {deps,calls}=fake();deps.rpc=async<T>()=>false as T;
 const response=await handleRequest(request({action:'student.login',code:newCode()}),config,deps,'ip');assert.equal(response.status,429);assert.equal(calls.length,0);
 deps.rpc=async()=>{throw new Error('private student name and secret key');};
 const failed=await handleRequest(request({action:'student.login',code:newCode()}),config,deps,'ip');assert.equal(failed.status,503);assert.ok(!(await failed.text()).includes('private student'));
});
test('교사 신원은 검증된 Auth 응답을 사용하고 공개 확인은 별도 서버 RPC이다',async()=>{
 const {deps,calls}=fake();const classId='22222222-2222-4222-8222-222222222222';
 let tokenSeen='';deps.verifyTeacher=async token=>{tokenSeen=token;return '11111111-1111-4111-8111-111111111111';};
 const response=await handleRequest(request({action:'teacher.prepareReveal',classId},{auth:'Bearer verified-token'}),config,deps,'ip');
 assert.equal(response.status,200);assert.equal(tokenSeen,'verified-token');
 assert.ok(calls.some(c=>c.name==='manito_prepare_reveal'));assert.ok(!calls.some(c=>c.name==='manito_confirm_reveal'));
 const body=await response.json();assert.equal(body.expiresIn,300);assert.match(body.confirmation,/^[A-Za-z0-9_-]{43}$/);
 const confirmed=await handleRequest(request({action:'teacher.confirmReveal',classId,confirmation:body.confirmation},{auth:'Bearer verified-token'}),config,deps,'ip');
 assert.equal(confirmed.status,200);assert.equal(calls.at(-1)!.args.p_teacher,'11111111-1111-4111-8111-111111111111');
 assert.notEqual(calls.at(-1)!.args.p_confirmation_hash,body.confirmation);
});
test('클라이언트 경계는 데모를 분리하고 교사 전용 저장 키로 세션을 유지한다',()=>{
 const boundary=readFileSync('src/backend/RuntimeBoundary.tsx','utf8');assert.match(boundary,/config.mode === 'demo'/);assert.match(boundary,/lazy\(\(\) => import\('\.\.\/App'\)\)/);
 const client=readFileSync('src/backend/client.ts','utf8');assert.match(client,/persistSession: true/);assert.match(client,/storageKey:teacherAuthStorageKey/);assert.match(client,/autoRefreshToken: true/);
 for(const path of ['src/backend/client.ts','src/backend/repository.ts','src/backend/config.ts'])assert.ok(!readFileSync(path,'utf8').includes("from '../../server"));
});
