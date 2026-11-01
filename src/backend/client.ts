import { createClient } from '@supabase/supabase-js';
import type { ClientConfig } from './config';
import type { Database } from './database.types';

// Teacher Auth only. Student authentication NEVER uses this client or localStorage.
export const teacherAuthStorageKey=(url:string)=>`manito.teacher.auth.${new URL(url).host}`;
export function createPublicClient(config: ClientConfig) {
 if (config.mode !== 'supabase') return null;
 return createClient<Database>(config.url, config.key, {
  auth: { persistSession: true, storageKey:teacherAuthStorageKey(config.url), autoRefreshToken: true, detectSessionInUrl: false },
 });
}
