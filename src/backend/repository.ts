import type { AssignmentPreview, AssignmentVersions, DaySettings, MissionLog, RevealConfirmation, StudentRepository, StudentSnapshot, TeacherClass, TeacherSnapshot } from './types';
import {isNewAccessCode} from './code-format';

export class ApiClientError extends Error {
 status:number;code:string;
 constructor(status:number,code:string) {
  const messages:Record<string,string>={backend_not_configured:'서버 환경변수가 준비되지 않았어요. SUPABASE_SECRET_KEY, AUTH_PEPPER, APP_ORIGIN 설정을 확인해 주세요.',rate_limited:'요청이 많아요. 잠시 후 다시 시도해 주세요.',invalid_credentials:'접속 코드를 다시 확인해 주세요.',unauthorized:'로그인이 만료되었어요. 다시 입장해 주세요.',forbidden:'접근 권한이 없거나 아직 열리지 않은 미션이에요.',origin_denied:'현재 HTTPS 주소와 서버 APP_ORIGIN 설정이 일치하지 않아요.',conflict:'변경 사항이 충돌했어요. 새로고침 후 다시 시도해 주세요.',invalid_input:'날짜 순서와 입력 내용을 확인해 주세요.',minimum_three_students:'학생을 최소 3명 등록해 주세요.'};
  Object.assign(messages,{assignment_not_ready:'먼저 DAY 1~5 날짜와 미션 내용을 모두 입력하고 설정 저장을 눌러 주세요.',assignment_changed:'명단 또는 미션 설정이 변경되었어요. 최신 정보를 확인하고 미리보기를 다시 생성해 주세요.',assignment_preview_expired:'미리보기가 만료되었거나 다른 창에서 교체되었어요. 미리보기를 다시 생성해 주세요.',assignment_locked:'이미 배정이 확정되었거나 학급 상태가 변경되었어요. 최신 상태를 확인해 주세요.'});
  super(code==='backend_migration_required'?'Supabase에 추가 SQL 마이그레이션을 적용한 뒤 다시 시도해 주세요.':messages[code]||'요청을 처리하지 못했어요. 서버 연결과 권한을 확인해 주세요.');this.status=status;this.code=code;
 }
}

// All student authentication stays in a same-origin HttpOnly cookie. No token return or persistence.
export async function callApi<T>(action: string, input: Record<string, unknown> = {}, teacherToken?: string): Promise<T> {
 const response = await fetch('/api/backend', {
  method: 'POST', credentials: 'same-origin', cache: 'no-store',
  headers: { 'Content-Type': 'application/json', ...(teacherToken ? { Authorization: `Bearer ${teacherToken}` } : {}) },
  body: JSON.stringify({ action, ...input }),
 });
 if (!response.ok) {let code='request_failed';try{const b=await response.json();if(typeof b.error==='string')code=b.error;}catch{/* generic */}throw new ApiClientError(response.status,code);}
 return response.json() as Promise<T>;
}
export const studentRepository: StudentRepository = {
 login: code => callApi('student.login', { code }),
 logout: () => callApi('student.logout'),
 snapshot: () => callApi<StudentSnapshot>('student.snapshot'),
 pledge: () => callApi('student.pledge'),
 saveLog: (input: MissionLog) => callApi('student.log', { ...input }),
};
export function teacherRepository(getAccessToken: () => Promise<string>) {
 const call = async <T>(action: string, input: Record<string, unknown>) => callApi<T>(action, input, await getAccessToken());
 return {
  classes:()=>call<TeacherClass[]>('teacher.classes',{}),
  snapshot:(classId:string)=>call<TeacherSnapshot>('teacher.snapshot',{classId}),
  prepareReset:(classId:string,deleteStudents:boolean,deleteSchedule:boolean)=>call<RevealConfirmation>('teacher.prepareReset',{classId,deleteStudents,deleteSchedule}),
  confirmReset:(classId:string,confirmation:string,className:string)=>call<{ok:true}>('teacher.confirmReset',{classId,confirmation,className}),
  addStudents:(classId:string,names:string[],version:number)=>call<{ok:true}>('teacher.addStudents',{classId,names,version}),
  renameStudent:(classId:string,studentId:string,name:string,version:number)=>call<{ok:true}>('teacher.renameStudent',{classId,studentId,name,version}),
  removeStudent:(classId:string,studentId:string,version:number)=>call<{ok:true}>('teacher.removeStudent',{classId,studentId,version}),
  saveSettings:(classId:string,name:string,days:DaySettings[],version:number)=>call<{ok:true}>('teacher.saveSettings',{classId,name,days,version}),
  logs:(classId:string,studentId:string)=>call<MissionLog[]>('teacher.logs',{classId,studentId}),
  issueCode: async(studentId:string)=>{const result=await call<{code:string}>('teacher.issueCode',{studentId});if(!isNewAccessCode(result.code))throw new Error('8자리 코드 발급을 지원하는 서버 버전인지 확인해 주세요.');return result;},
  prepareAssignments: (classId: string, versions:AssignmentVersions) => call<AssignmentPreview>('teacher.prepareAssignments', { classId,rosterVersion:versions.rosterVersion,settingsVersion:versions.settingsVersion }),
  confirmAssignments: (classId: string, confirmation: string, versions:AssignmentVersions) => call<{ ok: true }>('teacher.confirmAssignments', { classId, confirmation,rosterVersion:versions.rosterVersion,settingsVersion:versions.settingsVersion }),
  prepareReveal: (classId: string) => call<RevealConfirmation>('teacher.prepareReveal', { classId }),
  confirmReveal: (classId: string, confirmation: string) => call<{ ok: true }>('teacher.confirmReveal', { classId, confirmation }),
 };
}
