import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolveClientConfig } from './src/backend/config';
import { loadLocalTls } from './server/dev-tls';
import { createNodeHandler } from './api/backend';
export default defineConfig(({ mode, command }) => {
 const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
 // Fail BEFORE Vite could substitute an accidentally supplied server key into a bundle.
 const exposed = Object.entries(env).filter(([name]) => name.startsWith('VITE_'));
 if (exposed.some(([name,value]) => /SECRET|SERVICE_ROLE|PEPPER/i.test(name) || /sb_secret_/.test(value || '')
  || (value?.split('.').length === 3 && (() => { try { return JSON.parse(Buffer.from(value.split('.')[1],'base64url').toString()).role === 'service_role'; } catch { return false; } })()))) {
  throw new Error('Server secrets must never use a VITE_ environment variable. Remove it and rotate any exposed key.');
 }
 // Incomplete public config renders a safe configuration screen rather than the demo.
 const config=resolveClientConfig(env);
 const https=command==='serve'&&(config.mode!=='demo'||mode==='https');
 return {
  plugins: [react(),tailwindcss(),{
   name:'manito-local-api',
   configureServer(server) {
    const handler=createNodeHandler(env);
    server.middlewares.use((req,res,next)=>{
     if(req.url?.split('?')[0]!=='/api/backend')return next();
     void handler(req,res);
    });
   },
  }],
  server:{port:5173,strictPort:true,...(https?{https:loadLocalTls(env,process.cwd())}:{}),fs:{deny:['.env','.env.*','**/.git/**','**/.certs/**','**/*.{pem,key,pfx,p12,crt}']}},
 };
});
