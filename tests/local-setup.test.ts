import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
test('local setup preserves existing public/server values and never prints generated secrets',()=>{
 const path=mkdtempSync(join(tmpdir(),'manito-env-test-'));
 try{
  writeFileSync(join(path,'.env.local'),'VITE_SUPABASE_URL=https://fixture.supabase.co\nVITE_SUPABASE_ANON_KEY=sb_publishable_fixture\n');
  const command=resolve('scripts/setup-local.mjs');const first=spawnSync(process.execPath,[command],{cwd:path,encoding:'utf8'});assert.equal(first.status,0);
  const created=readFileSync(join(path,'.env.local'),'utf8');const pepper=created.match(/^AUTH_PEPPER=(.+)$/m)?.[1];assert.ok(pepper&&pepper.length>=48);assert.ok(!first.stdout.includes(pepper));assert.match(created,/APP_ORIGIN=https:\/\/localhost:5173/);
  const second=spawnSync(process.execPath,[command],{cwd:path,encoding:'utf8'});assert.equal(second.status,0);assert.equal(readFileSync(join(path,'.env.local'),'utf8'),created);
 }finally{assert.equal(dirname(resolve(path)),resolve(tmpdir()));assert.ok(basename(path).startsWith('manito-env-test-'));rmSync(path,{recursive:true});}
});
