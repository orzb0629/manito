import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';

test('Vercel Node ESM artifact: compile complete server graph, cold start without TS loader, preserve auth boundary',()=>{
 // Artifacts contain synthetic settings only and stay outside static dist/.
 mkdirSync('.npm-cache',{recursive:true});
 const output=mkdtempSync(resolve('.npm-cache','vercel-runtime-test-'));
 const configPath=ts.findConfigFile(resolve('api'),ts.sys.fileExists)!;
 assert.equal(resolve(configPath),resolve('api/tsconfig.json'));
 const config=ts.readConfigFile(configPath,ts.sys.readFile);
 const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,resolve('api'));
 assert.equal(parsed.options.module,ts.ModuleKind.NodeNext);
 assert.equal(parsed.options.rewriteRelativeImportExtensions,true);
 const source=readFileSync('api/backend.ts','utf8');
 // Reproduce the old artifact: .ts imports survive ordinary transpilation.
 const old=ts.transpileModule(source,{fileName:'api/backend.ts',compilerOptions:{...parsed.options,rewriteRelativeImportExtensions:false}}).outputText;
 assert.match(old,/server\/handler\.ts/);
 const program=ts.createProgram([resolve('api/backend.ts')],{
  ...parsed.options,noEmit:false,rootDir:process.cwd(),outDir:output,incremental:false,
 });
 const diagnostics=ts.getPreEmitDiagnostics(program);
 assert.equal(diagnostics.length,0,ts.formatDiagnosticsWithColorAndContext(diagnostics,{getCanonicalFileName:f=>f,getCurrentDirectory:()=>process.cwd(),getNewLine:()=>"\n"}));
 assert.equal(program.emit().emitSkipped,false);
 writeFileSync(join(output,'package.json'),JSON.stringify({type:'module'}));
 const entry=readFileSync(join(output,'api/backend.js'),'utf8');
 assert.match(entry,/server\/handler\.js/);
 function check(dir:string){for(const item of readdirSync(dir,{withFileTypes:true})){const f=join(dir,item.name);if(item.isDirectory())check(f);else if(f.endsWith('.js'))assert.doesNotMatch(readFileSync(f,'utf8'),/(?:from\s*|import\s*\()\s*['"]\.{1,2}\/[^'"]+\.ts['"]/);}}
 check(output);
 // Fresh Node process: JS artifacts only, no ts-node/Vite/type stripping,
 // no real env file, no network request to Supabase and no student data.
 const runner=`
 import assert from 'node:assert/strict';
 import {createServer} from 'node:http';
 import handler,{createNodeHandler} from './api/backend.js';
 const fixture={SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_ANON_KEY:'sb_publishable_fixture_value_123456789',SUPABASE_SECRET_KEY:'sb_secret_fixture_value_123456789',AUTH_PEPPER:'fixture-only-'.repeat(5),APP_ORIGIN:'https://fixture.invalid'};
 const calls=[];
 const deps={verifyTeacher:async value=>{assert.equal(value,'fixture-teacher');return '11111111-1111-4111-8111-111111111111';},rpc:async(name,args)=>{calls.push(name);if(name==='manito_rate_limit')return true;if(name==='manito_teacher_classes')return [];if(name==='manito_student_login')return true;throw Error('unexpected fixture call');}};
 const live=createNodeHandler(fixture,deps);
 const server=createServer((req,res)=>void (req.url==='/unconfigured'?handler:live)(req,res));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const address=server.address();const base='http://127.0.0.1:'+address.port;
 async function request(action,extra={},auth=false,origin=fixture.APP_ORIGIN,path='/api/backend') {return fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,...(auth?{Authorization:'Bearer fixture-teacher'}:{})},body:JSON.stringify({action,...extra})});}
 try {
  assert.equal((await request('teacher.classes',{},false,fixture.APP_ORIGIN,'/unconfigured')).status,503);
  assert.equal((await request('teacher.classes')).status,401);
  assert.equal((await request('teacher.classes',{},true,'https://wrong.invalid')).status,403);
  const teacher=await request('teacher.classes',{},true);assert.equal(teacher.status,200);assert.deepEqual(await teacher.json(),[]);
  const student=await request('student.login',{code:'ABCDEFGH'});assert.equal(student.status,200);const cookie=student.headers.get('set-cookie');assert.match(cookie,/HttpOnly/);assert.match(cookie,/Secure/);assert.match(cookie,/SameSite=Strict/);assert.deepEqual(await student.json(),{ok:true});
  assert.ok(calls.includes('manito_teacher_classes'));assert.ok(calls.includes('manito_student_login'));
 } finally {await new Promise(resolve=>server.close(resolve));}
 console.log('Compiled JS cold start and auth/cookie checks passed');
 `;
 writeFileSync(join(output,'verify.mjs'),runner);
 const safeEnv={...process.env};for(const key of Object.keys(safeEnv))if(/SUPABASE|AUTH_PEPPER|APP_ORIGIN|NODE_OPTIONS/.test(key))delete safeEnv[key];
 const result=spawnSync(process.execPath,['--no-experimental-strip-types',join(output,'verify.mjs')],{env:safeEnv,encoding:'utf8',timeout:30000});
 // Child only uses fixtures. Avoid forwarding env or auth response contents.
 assert.equal(result.status,0,`Compiled runtime failed: ${result.stderr}`);
 assert.match(result.stdout,/Compiled JS cold start and auth\/cookie checks passed/);
});
