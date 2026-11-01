import { ApiError } from './security.ts';
export type ServerConfig = { url: string; publicKey: string; secretKey: string; pepper: string; origin: string };
export function readServerConfig(env: Record<string, string | undefined>): ServerConfig {
 const url=env.SUPABASE_URL||env.VITE_SUPABASE_URL;
 const publicKey=env.SUPABASE_ANON_KEY||env.VITE_SUPABASE_ANON_KEY;
 const { SUPABASE_SECRET_KEY: secretKey, AUTH_PEPPER: pepper, APP_ORIGIN: origin } = env;
 if (!url || !publicKey || !secretKey || !pepper || pepper.length < 32 || !origin) throw new ApiError(503, 'backend_not_configured');
 try {
  const parsed = new URL(url); const app = new URL(origin);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash || app.protocol !== 'https:' || app.origin !== origin) throw new Error();
  if (secretKey.length<24 || publicKey.length<24 || secretKey.startsWith('sb_publishable_') || secretKey === publicKey) throw new Error();
  if (!secretKey.startsWith('sb_secret_')) {
   const payload = JSON.parse(Buffer.from(secretKey.split('.')[1], 'base64url').toString());
   if (payload.role !== 'service_role') throw new Error();
  }
  if (!publicKey.startsWith('sb_publishable_')) {
   const payload = JSON.parse(Buffer.from(publicKey.split('.')[1], 'base64url').toString());
   if (payload.role !== 'anon') throw new Error();
  }
 } catch { throw new ApiError(503, 'backend_not_configured'); }
 return { url, publicKey, secretKey, pepper, origin };
}
