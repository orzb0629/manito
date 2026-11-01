import type { IncomingMessage, ServerResponse } from 'node:http';
import { isIP } from 'node:net';
import { handleRequest } from '../server/handler.ts';
import { readServerConfig } from '../server/config.ts';
import { createDependencies } from '../server/supabase.ts';
import type { BackendDependencies } from '../server/supabase.ts';

// Vercel Node Function: same origin as Vite static assets. Never expose this service key in Vite.
export function createNodeHandler(env: Record<string,string|undefined>, dependencies?: BackendDependencies) {
 return async function handler(req: IncomingMessage & { body?: unknown }, res: ServerResponse) {
 try {
  const config = readServerConfig(env);
  const headers = new Headers();
  // Vite TLS may use HTTP/2; pseudo headers are not valid Web Headers entries.
  for (const [name, value] of Object.entries(req.headers)) if (value&&!name.startsWith(':')) headers.set(name, Array.isArray(value) ? value.join(',') : value);
  let raw = '';
  if (req.body !== undefined) raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  else {
   const chunks: Buffer[]=[]; let size=0;
   for await (const chunk of req) {
    const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);size+=bytes.length;
    if (size>8192) { res.writeHead(413,{'Cache-Control':'no-store'});res.end();return; }
    chunks.push(bytes);
   }
   raw=Buffer.concat(chunks).toString('utf8');
  }
  // Vercel overwrites x-vercel-forwarded-for. Never use client-supplied X-Forwarded-For.
  const ip = env.VERCEL === '1' ? headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() : req.socket.remoteAddress;
  const request = new Request(`${config.origin}/api/backend`, { method: req.method, headers, ...(req.method==='GET'||req.method==='HEAD'?{}:{body:raw}) });
  const response = await handleRequest(request,config,dependencies || createDependencies(config),ip && isIP(ip) ? ip : '');
  res.statusCode = response.status;
  response.headers.forEach((value, name) => res.setHeader(name,value));
  res.end(await response.text());
 } catch {
  res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(JSON.stringify({ error: 'backend_not_configured' }));
 }
 };
}
export default createNodeHandler(process.env);
