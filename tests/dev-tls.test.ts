import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { localTlsPaths, loadLocalTls } from '../server/dev-tls.ts';
test('local TLS auto-discovers mkcert files and preserves explicit path overrides',()=>{
 const root=resolve('fixture-project');
 assert.deepEqual(localTlsPaths({},root),{cert:join(root,'.certs/localhost.pem'),key:join(root,'.certs/localhost-key.pem')});
 assert.deepEqual(localTlsPaths({DEV_TLS_CERT_FILE:'custom/leaf.pem',DEV_TLS_KEY_FILE:'custom/leaf.key'},root),{cert:join(root,'custom/leaf.pem'),key:join(root,'custom/leaf.key')});
 assert.throws(()=>localTlsPaths({DEV_TLS_CERT_FILE:'only-one.pem'},root),/Set both/);
 assert.throws(()=>loadLocalTls({},join(root,'not-present')),/No self-signed fallback/);
});
test('invalid local TLS material fails with a sanitized error, never prints file contents',()=>{
 const root=mkdtempSync(join(tmpdir(),'manito-tls-test-'));
 try{
  const marker='fixture-invalid-material-that-must-not-appear-in-errors';writeFileSync(join(root,'cert.pem'),marker);writeFileSync(join(root,'key.pem'),marker);
  assert.throws(()=>loadLocalTls({DEV_TLS_CERT_FILE:'cert.pem',DEV_TLS_KEY_FILE:'key.pem'},root),e=>e instanceof Error&&e.message.includes('invalid')&&!e.message.includes(marker));
 }finally{assert.equal(dirname(resolve(root)),resolve(tmpdir()));assert.ok(basename(root).startsWith('manito-tls-test-'));rmSync(root,{recursive:true});}
});
