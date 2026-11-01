import { createClient } from '@supabase/supabase-js';
import { ApiError } from './security.ts';
import type { ServerConfig } from './config.ts';
export interface BackendDependencies {
 rpc<T>(name: string, args: Record<string, unknown>): Promise<T>;
 verifyTeacher(token: string): Promise<string>;
}
export function databaseError(name:string,error:{code?:string;message?:string}):ApiError {
 if(name==='manito_confirm_assignments'&&error.code==='42501'&&error.message==='Confirmation invalid')return new ApiError(409,'assignment_preview_expired');
 if(name==='manito_confirm_assignments'&&error.code==='23514'&&error.message==='Five dates and missions required')return new ApiError(422,'assignment_not_ready');
 if(name==='manito_prepare_assignments'&&error.message==='Assignments locked')return new ApiError(409,'assignment_locked');
 if(name==='manito_prepare_assignments'&&error.code==='23514'&&error.message==='Invalid roster')return new ApiError(409,'assignment_changed');
 if(error.code==='MC001')return new ApiError(409,'code_collision');
 if(error.code==='PGRST202'||error.code==='42883')return new ApiError(503,'backend_migration_required');
 if(error.code==='28000')return new ApiError(401,'unauthorized');
 if(error.code==='42501')return new ApiError(403,'forbidden');
 if(error.code?.startsWith('23'))return new ApiError(409,'conflict');
 return new ApiError(503,'backend_unavailable');
}
export function createDependencies(config: ServerConfig): BackendDependencies {
 const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
 const service = createClient(config.url, config.secretKey, options);
 const auth = createClient(config.url, config.publicKey, options);
 return {
  async rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
   const { data, error } = await service.rpc(name, args);
   if (error) {
    // Classify known conditions; never expose raw Postgres details or identifiers.
    throw databaseError(name,error);
   }
   return data as T;
  },
  async verifyTeacher(token: string) {
   const { data, error } = await auth.auth.getUser(token);
   if (error || !data.user) throw new ApiError(401, 'unauthorized');
   // Identity only, NOT role authorization. Each teacher RPC checks active allowlist + ownership.
   return data.user.id;
  },
 };
}
