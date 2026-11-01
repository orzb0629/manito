import { useState } from 'react';
import type { teacherRepository } from '../backend/repository';
import Modal from './Modal';

export default function ActivityResetDialog({api,classId,className,onClose,onReset}:{
 api:ReturnType<typeof teacherRepository>;classId:string;className:string;onClose:()=>void;onReset:()=>Promise<void>;
}){
 const [deleteStudents,setDeleteStudents]=useState(false),[deleteSchedule,setDeleteSchedule]=useState(false);
 const [token,setToken]=useState(''),[typed,setTyped]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function submit(){
  if(busy)return;setBusy(true);setError('');
  try{
   if(!token){const result=await api.prepareReset(classId,deleteStudents,deleteSchedule);setToken(result.confirmation);}
   else{await api.confirmReset(classId,token,typed);await onReset();}
  }catch(e){setToken('');setTyped('');setError(e instanceof Error?e.message:'초기화 요청을 확인하지 못했어요. 다시 확인해 주세요.');}
  finally{setBusy(false);}
 }
 return <Modal title={token?'학급 이름을 입력해 주세요':'활동 초기화'} busy={busy} onClose={onClose}>
  <p><strong>{className}</strong> 학급만 초기화합니다. 삭제한 기록은 되돌릴 수 없어요.</p>
  <div className="notice"><span>항상 삭제: 마니또 배정, 미션 완료·비밀 일지, 서약, 공개 상태, 학생 코드와 로그인 세션. 기존에 전달한 코드와 다운로드한 CSV도 사용할 수 없게 됩니다.</span></div>
  {!token?<>
   <label className="reset-option"><input type="checkbox" checked={deleteStudents} disabled={busy} onChange={e=>setDeleteStudents(e.target.checked)}/> 학생 명단도 삭제</label>
   <label className="reset-option"><input type="checkbox" checked={deleteSchedule} disabled={busy} onChange={e=>setDeleteSchedule(e.target.checked)}/> DAY 1~5 날짜와 미션 내용도 삭제</label>
   <p className="muted small">선택하지 않은 명단·일정은 유지됩니다. 학급과 교사 계정은 삭제하지 않아요.</p>
  </>:<>
   <p>학생 명단: <strong>{deleteStudents?'삭제':'유지'}</strong> · 일정과 미션: <strong>{deleteSchedule?'삭제':'유지'}</strong></p>
   <p>초기화 후 새 학생 코드를 발급하고 배정을 다시 확정해야 합니다. 5분 안에 확인해 주세요.</p>
   <label>확인을 위해 학급 이름 입력<input autoComplete="off" maxLength={60} value={typed} disabled={busy} onChange={e=>setTyped(e.target.value)}/></label>
  </>}
  {error&&<p className="error" role="alert">{error}</p>}
  <div className="modal-actions"><button className="btn" disabled={busy} onClick={onClose}>취소</button><button className="btn primary" disabled={busy||!!token&&typed!==className} onClick={()=>void submit()}>{busy?'처리 중…':token?'확인하고 활동 초기화':'삭제 대상 확인하고 다음'}</button></div>
 </Modal>;
}
