import { randomUUID } from 'node:crypto';
import type { BackendDependencies } from './supabase.ts';
import type { ServerConfig } from './config.ts';
import { ApiError, assertSameOrigin, confirmation, hashSecret, newCode, newToken, normalizeCode, randomCycle, readSession, sessionCookie, uuid } from './security.ts';
import type { StudentSnapshot,TeacherSnapshot } from '../src/backend/types.ts';
import {checkAssignmentState} from './assignment-state.ts';

const fields: Record<string, string[]> = {
 'student.login': ['code'], 'student.logout': [], 'student.snapshot': [], 'student.pledge': [],
 'student.log': ['day','done','text','mood'],
 'teacher.issueCode': ['studentId'], 'teacher.prepareAssignments': ['classId','rosterVersion','settingsVersion'],
 'teacher.confirmAssignments': ['classId','confirmation','rosterVersion','settingsVersion'], 'teacher.prepareReveal': ['classId'],
 'teacher.confirmReveal': ['classId','confirmation'],
 'teacher.classes': [], 'teacher.snapshot': ['classId'],
 'teacher.addStudents': ['classId','names','version'],
 'teacher.renameStudent': ['classId','studentId','name','version'],
 'teacher.removeStudent': ['classId','studentId','version'],
 'teacher.saveSettings': ['classId','name','days','version'],
 'teacher.logs': ['classId','studentId'],
 'teacher.prepareReset': ['classId','deleteStudents','deleteSchedule'],
 'teacher.confirmReset': ['classId','confirmation','className'],
};
const headers = { 'Cache-Control': 'no-store, private', 'Pragma': 'no-cache', 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Vary': 'Origin, Cookie, Authorization' };
function json(value: unknown, status = 200, cookie?: string) {
 return new Response(JSON.stringify(value), { status, headers: { ...headers, ...(cookie ? { 'Set-Cookie': cookie } : {}) } });
}
export async function handleRequest(request: Request, config: ServerConfig, deps: BackendDependencies, clientIp: string): Promise<Response> {
 try {
  if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers: { ...headers, Allow: 'POST' } });
  assertSameOrigin(request, config.origin);
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new ApiError(415,'json_required');
  const raw = await request.text();
  if (Buffer.byteLength(raw, 'utf8') > 8192) throw new ApiError(413,'body_too_large');
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw); } catch { throw new ApiError(400,'invalid_input'); }
  if (!body || Array.isArray(body) || typeof body !== 'object' || typeof body.action !== 'string' || !Object.hasOwn(fields,body.action)) throw new ApiError(400,'invalid_action');
  const action = body.action;
  if (Object.keys(body).some(k => k !== 'action' && !fields[action].includes(k))) throw new ApiError(400,'unexpected_field');
  const hash = (purpose: 'code'|'session'|'confirmation'|'rate', value: string) => hashSecret(config.pepper,purpose,value);
  async function rate(bucket: string, limit: number, seconds = 600) {
   const allowed = await deps.rpc<boolean>('manito_rate_limit', { p_bucket: hash('rate',bucket), p_limit: limit, p_seconds: seconds });
   if (!allowed) throw new ApiError(429,'rate_limited');
  }
  if (action === 'student.login') {
   if (!clientIp) throw new ApiError(503,'client_address_unavailable');
   await rate(`login-ip:${clientIp}`,60);
   await rate(`login-ip-day:${clientIp}`,600,86400);
   await rate('login-global',600);
   const code = normalizeCode(body.code);
   if (!code) throw new ApiError(401,'invalid_credentials');
   const codeHash = hash('code',code);
   await rate(`login-code:${codeHash}`,5);
   const token = newToken();
   const ok = await deps.rpc<boolean>('manito_student_login',{ p_code_hash: codeHash, p_session_hash: hash('session',token) });
   if (!ok) throw new ApiError(401,'invalid_credentials');
   return json({ ok: true },200,sessionCookie(token));
  }
  if (action.startsWith('student.')) {
   const sessionHash = hash('session',readSession(request));
   await rate(`student:${sessionHash}`,120,60);
   if (action === 'student.logout') {
    await deps.rpc('manito_student_logout',{ p_session_hash: sessionHash });
    return json({ ok: true },200,sessionCookie('',0));
   }
   if (action === 'student.snapshot') return json(await deps.rpc<StudentSnapshot>('manito_student_snapshot',{ p_session_hash: sessionHash }));
   if (action === 'student.pledge') await deps.rpc('manito_student_pledge',{ p_session_hash: sessionHash });
   if (action === 'student.log') {
    if (!Number.isInteger(body.day) || Number(body.day)<1 || Number(body.day)>5 || typeof body.done !== 'boolean' || typeof body.text !== 'string'
     || [...body.text].length>1500 || !['설레요','뿌듯해요','따뜻해요','조금 어려워요'].includes(String(body.mood))) throw new ApiError(400,'invalid_input');
    await deps.rpc('manito_student_log',{ p_session_hash: sessionHash, p_day: body.day, p_done: body.done, p_body: body.text.trim(), p_mood: body.mood });
   }
   return json({ ok: true });
  }
  const bearer = request.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/)?.[1];
  if (!bearer) throw new ApiError(401,'unauthorized');
  const teacherId = await deps.verifyTeacher(bearer);
  await rate(`teacher:${teacherId}`,60,60);
  if (action === 'teacher.classes') return json(await deps.rpc('manito_teacher_classes',{p_teacher:teacherId}));
  if (action === 'teacher.issueCode') {
   const studentId = uuid(body.studentId);
   // The unique DB index is the concurrency boundary, not a client-side existence check.
   // 004 also rejects the same student's current code so reissue always changes it.
   for(let attempt=0;attempt<5;attempt++) {
    const code=newCode();
    try {
     await deps.rpc('manito_issue_short_code',{p_teacher:teacherId,p_student:studentId,p_code_hash:hash('code',code)});
     return json({code}); // One-time teacher response only. Never log raw codes.
    }catch(e){if(!(e instanceof ApiError)||e.code!=='code_collision')throw e;}
   }
   throw new ApiError(503,'code_generation_unavailable');
  }
  const classId = uuid(body.classId);
  const scope={p_teacher:teacherId,p_class:classId};
  if(action==='teacher.prepareReset') {
   if(typeof body.deleteStudents!=='boolean'||typeof body.deleteSchedule!=='boolean')throw new ApiError(400,'invalid_input');
   const token=newToken();
   await deps.rpc('manito_prepare_reset',{...scope,p_delete_students:body.deleteStudents,p_delete_schedule:body.deleteSchedule,p_confirmation_hash:hash('confirmation',token)});
   return json({confirmation:token,expiresIn:300});
  }
  if(action==='teacher.confirmReset') {
   if(typeof body.className!=='string'||[...body.className].length<1||[...body.className].length>60)throw new ApiError(400,'invalid_input');
   await deps.rpc('manito_confirm_reset',{...scope,p_confirmation_hash:hash('confirmation',confirmation(body.confirmation)),p_class_name:body.className});
   return json({ok:true});
  }
  if(action==='teacher.snapshot') return json(await deps.rpc('manito_teacher_snapshot',scope));
  if(action==='teacher.logs') return json(await deps.rpc('manito_teacher_logs',{...scope,p_student:uuid(body.studentId)}));
  if(['teacher.addStudents','teacher.renameStudent','teacher.removeStudent','teacher.saveSettings'].includes(action)) {
   if(!Number.isInteger(body.version)||Number(body.version)<0) throw new ApiError(400,'invalid_input');
   const args={...scope,p_version:body.version};
   if(action==='teacher.addStudents') {
    if(!Array.isArray(body.names)||body.names.length<1||body.names.length>80||body.names.some(n=>typeof n!=='string'||[...n.trim()].length<1||[...n.trim()].length>60))throw new ApiError(400,'invalid_input');
    await deps.rpc('manito_add_students',{...args,p_names:body.names});
   }else if(action==='teacher.removeStudent')await deps.rpc('manito_remove_student',{...args,p_student:uuid(body.studentId)});
   else {
    if(typeof body.name!=='string'||[...body.name.trim()].length<1||[...body.name.trim()].length>60)throw new ApiError(400,'invalid_input');
    if(action==='teacher.renameStudent')await deps.rpc('manito_rename_student',{...args,p_student:uuid(body.studentId),p_name:body.name});
    else {
     if(!Array.isArray(body.days)||body.days.length!==5)throw new ApiError(400,'invalid_input');
     let previous='';
     for(const [i,d] of body.days.entries()) {
      if(!d||typeof d!=='object'||Array.isArray(d)||Object.keys(d).some(k=>!['day','date','title','description'].includes(k))||d.day!==i+1||typeof d.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(d.date)||!Number.isFinite(Date.parse(d.date+'T00:00:00Z'))||new Date(d.date+'T00:00:00Z').toISOString().slice(0,10)!==d.date||d.date<=previous||typeof d.title!=='string'||[...d.title.trim()].length<1||[...d.title.trim()].length>60||typeof d.description!=='string'||[...d.description.trim()].length<1||[...d.description.trim()].length>400)throw new ApiError(400,'invalid_input');
      previous=d.date;
     }
     await deps.rpc('manito_save_settings',{...args,p_name:body.name,p_days:body.days});
    }
   }
   return json({ok:true});
  }
  if (action === 'teacher.prepareAssignments') {
   const state=await deps.rpc<TeacherSnapshot>('manito_teacher_snapshot',scope);
   checkAssignmentState(state,{rosterVersion:body.rosterVersion,settingsVersion:body.settingsVersion});
   const order=randomCycle(state.students).map(s=>s.id);const token=newToken();
   const pairs=await deps.rpc('manito_prepare_assignments',{...scope,p_order:order,p_confirmation_hash:hash('confirmation',token)});
   // RPCs are separate transactions: do not publish a preview if state changed
   // between the snapshot and draft creation. The DB still binds its own roster version.
   const latest=await deps.rpc<TeacherSnapshot>('manito_teacher_snapshot',scope);
   checkAssignmentState(latest,state);
   return json({draftId:randomUUID(),pairs,confirmation:token,rosterVersion:latest.rosterVersion,settingsVersion:latest.settingsVersion,state:latest});
  }
  if (action === 'teacher.prepareReveal') {
   const token = newToken();
   await deps.rpc('manito_prepare_reveal',{ p_teacher: teacherId, p_class: classId, p_confirmation_hash: hash('confirmation',token) });
   return json({ confirmation: token, expiresIn: 300 });
  }
  const token = confirmation(body.confirmation);
  if(action==='teacher.confirmAssignments') {
   const state=await deps.rpc<TeacherSnapshot>('manito_teacher_snapshot',scope);
   checkAssignmentState(state,{rosterVersion:body.rosterVersion,settingsVersion:body.settingsVersion});
  }
  await deps.rpc(action === 'teacher.confirmReveal' ? 'manito_confirm_reveal' : 'manito_confirm_assignments',{
   p_teacher: teacherId, p_class: classId, p_confirmation_hash: hash('confirmation',token),
  });
  return json({ ok: true });
 } catch (error) {
  const safe = error instanceof ApiError ? error : new ApiError(503,'backend_unavailable');
  return json({ error: safe.code },safe.status);
 }
}
