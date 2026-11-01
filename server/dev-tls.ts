import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { X509Certificate, createPrivateKey, createPublicKey } from 'node:crypto';

export function localTlsPaths(env:Record<string,string|undefined>,root:string) {
 const cert=env.DEV_TLS_CERT_FILE?.trim(),key=env.DEV_TLS_KEY_FILE?.trim();
 if(Boolean(cert)!==Boolean(key))throw new Error('Set both DEV_TLS_CERT_FILE and DEV_TLS_KEY_FILE, or leave both empty to use .certs/localhost*.pem.');
 return {cert:resolve(root,cert||'.certs/localhost.pem'),key:resolve(root,key||'.certs/localhost-key.pem')};
}
export function loadLocalTls(env:Record<string,string|undefined>,root:string) {
 const paths=localTlsPaths(env,root);
 if(!existsSync(paths.cert)||!existsSync(paths.key))throw new Error('Trusted local TLS files are missing. Follow docs/LOCAL_HTTPS_WINDOWS.md: install mkcert, run mkcert -install, then generate .certs/localhost.pem and .certs/localhost-key.pem. No self-signed fallback is enabled.');
 try {
  const cert=readFileSync(paths.cert),key=readFileSync(paths.key),x509=new X509Certificate(cert);
  if(x509.ca||x509.issuer===x509.subject)throw new Error();
  if(Date.parse(x509.validFrom)>Date.now()||Date.parse(x509.validTo)<=Date.now())throw new Error();
  const publicPart=createPublicKey(createPrivateKey(key)).export({type:'spki',format:'der'});
  if(!x509.publicKey.export({type:'spki',format:'der'}).equals(publicPart))throw new Error();
  // OS/browser trust still requires mkcert -install. Never install a CA implicitly.
  return {cert,key};
 } catch {throw new Error('Local TLS certificate/key is invalid, expired, self-signed, or mismatched. Regenerate the leaf certificate with mkcert; do not use rootCA.pem as the server certificate. See docs/LOCAL_HTTPS_WINDOWS.md.');}
}
