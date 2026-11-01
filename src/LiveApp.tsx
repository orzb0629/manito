import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowUpRight, BookHeart, CalendarDays, Check, CheckCheck, ChevronRight, Eye, Gift, Heart, House, KeyRound, LockKeyhole, LogOut, Mail, RefreshCw, Settings2, ShieldCheck, Sparkles, Star, Users } from 'lucide-react';
import type { Session } from '@supabase/supabase-js';
import { createPublicClient } from './backend/client';
import { resolveClientConfig } from './backend/config';
import { ApiClientError, studentRepository, teacherRepository } from './backend/repository';
import type { ActivityDay, StudentSnapshot, TeacherClass } from './backend/types';
import Modal from './components/Modal';
import TeacherPanel from './components/TeacherPanel';

const authClient=createPublicClient(resolveClientConfig(import.meta.env))!;
const teacherApi=teacherRepository(async()=>{const {data}=await authClient.auth.getSession();if(!data.session)throw new ApiClientError(401,'unauthorized');return data.session.access_token;});
const icons=[Mail,Heart,Star,Sparkles,Gift];
const menu=[{id:'home',icon:House,label:'나의 아지트'},{id:'missions',icon:Mail,label:'비밀 미션'},{id:'diary',icon:BookHeart,label:'나의 비밀 일지'},{id:'reveal',icon:Gift,label:'정체 공개'}];
const dateLabel=(date:string)=>new Intl.DateTimeFormat('ko-KR',{month:'long',day:'numeric',weekday:'short',timeZone:'Asia/Seoul'}).format(new Date(date+'T12:00:00+09:00'));
type Dialog='login'|'teacher'|'pledge'|'mate'|'journal'|'help'|null;
export default function LiveApp(){
 const [student,setStudent]=useState<StudentSnapshot|null>(null),[session,setSession]=useState<Session|null>(null),[classes,setClasses]=useState<TeacherClass[]|null>(null);
 const [admin,setAdmin]=useState(false),[className,setClassName]=useState('우리 반'),[tab,setTab]=useState('home'),[dialog,setDialog]=useState<Dialog>(null);
 const [code,setCode]=useState(''),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[error,setError]=useState(''),[toast,setToast]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
 const [day,setDay]=useState<ActivityDay|null>(null),[text,setText]=useState(''),[mood,setMood]=useState('설레요');
 const pending=useRef(false),epoch=useRef(0);
 const [teacherChecking,setTeacherChecking]=useState(true),[teacherRestoreError,setTeacherRestoreError]=useState(false);
 const teacherEpoch=useRef(0),teacherActive=useRef(false),teacherSigningOut=useRef(false);
 const approvedTeacherId=useRef<string|null>(null);
 const report=useCallback((reason:unknown)=>{setError(reason instanceof Error?reason.message:'연결을 확인하고 다시 시도해 주세요.');if(reason instanceof ApiClientError&&reason.code==='unauthorized'){epoch.current++;setStudent(null);setDialog(null);}},[]);
 async function run(task:()=>Promise<void>){if(pending.current)return;pending.current=true;setBusy(true);setError('');try{await task();}catch(e){report(e);}finally{pending.current=false;setBusy(false);}}
 const refresh=useCallback(async()=>{const version=epoch.current;const data=await studentRepository.snapshot();if(version===epoch.current)setStudent(data);},[]);
 useEffect(()=>{let alive=true;const version=epoch.current;studentRepository.snapshot().then(data=>{if(alive&&version===epoch.current)setStudent(data);}).catch(e=>{if(alive&&version===epoch.current&&!(e instanceof ApiClientError&&e.status===401))report(e);}).finally(()=>{if(alive)setLoading(false);});return()=>{alive=false;};},[report]);
 const restoreTeacher=useCallback(async()=>{
  const version=++teacherEpoch.current;setTeacherChecking(true);setTeacherRestoreError(false);
  try {
   const result=await authClient.auth.getSession();
   if(version!==teacherEpoch.current)return;
   if(result.error){if(result.error.status&&result.error.status>=400&&result.error.status<500)throw new ApiClientError(401,'unauthorized');throw new Error('teacher_auth_connection');}
   if(!result.data.session){teacherActive.current=false;approvedTeacherId.current=null;setSession(null);setClasses(null);setAdmin(false);return;}
   // Stored session is only a credential candidate; server revalidates identity,
   // teacher approval and ownership before any administrator screen is restored.
   const approved=await teacherApi.classes();
   if(version!==teacherEpoch.current)return;
   teacherActive.current=true;approvedTeacherId.current=result.data.session.user.id;setSession(result.data.session);setClasses(approved);setAdmin(true);setDialog(null);setError('');
  }catch(e){
   if(version!==teacherEpoch.current)return;
   teacherActive.current=false;approvedTeacherId.current=null;setClasses(null);setAdmin(false);
   if(e instanceof ApiClientError&&(e.status===401||e.status===403)){
    setSession(null);await authClient.auth.signOut({scope:'local'});
    setError('교사 로그인이 만료되었거나 접근 권한이 없어요. 선생님 공간에서 다시 로그인해 주세요.');
   }else{setTeacherRestoreError(true);setError('교사 로그인 상태를 확인하지 못했어요. 연결을 확인하고 다시 확인을 눌러 주세요.');}
  }finally{if(version===teacherEpoch.current)setTeacherChecking(false);}
 },[]);
 useEffect(()=>{
  let alive=true;let recheck:ReturnType<typeof setTimeout>|undefined;
  // Keep this listener synchronous. Server verification runs outside the Auth callback.
  const {data}=authClient.auth.onAuthStateChange((event,next)=>{
   if(!alive)return;setSession(next);
   if(next&&approvedTeacherId.current&&next.user.id!==approvedTeacherId.current){
    teacherEpoch.current++;teacherActive.current=false;approvedTeacherId.current=null;setClasses(null);setAdmin(false);setTeacherChecking(true);
    recheck=setTimeout(()=>{if(alive)void restoreTeacher();},0);
   }
   if(!next){const wasTeacher=teacherActive.current;teacherActive.current=false;approvedTeacherId.current=null;setClasses(null);setAdmin(false);
    if(event==='SIGNED_OUT'){teacherEpoch.current++;setTeacherChecking(false);if(wasTeacher){setDialog(null);if(!teacherSigningOut.current)setError('교사 로그인이 만료되었어요. 선생님 공간에서 다시 로그인해 주세요.');}}
   }
  });
  void restoreTeacher();
  return()=>{alive=false;teacherEpoch.current++;clearTimeout(recheck);data.subscription.unsubscribe();};
 },[restoreTeacher]);
 useEffect(()=>{if(!student)return;const check=()=>{if(document.visibilityState==='visible')void refresh().catch(report);};const timer=setInterval(check,30000);window.addEventListener('focus',check);document.addEventListener('visibilitychange',check);return()=>{clearInterval(timer);window.removeEventListener('focus',check);document.removeEventListener('visibilitychange',check);};},[student?.student.id,refresh,report]);
 useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(''),3500);return()=>clearTimeout(timer);},[toast]);
 function open(next:Dialog){setError('');setDialog(next);}
 function mate(){open(!student?'login':!student.pledged?'pledge':'mate');}
 function journal(d:ActivityDay){if(!student)return open('login');if(!student.pledged)return open('pledge');if(!d.open){setToast('아직 열리지 않은 미션이에요.');return;}const log=student.logs.find(l=>l.day===d.day);setDay(d);setText(log?.text||'');setMood(log?.mood||'설레요');open('journal');}
 function teacher(){if(teacherChecking)return;if(session&&classes){setAdmin(true);return;}if(session||teacherRestoreError){void restoreTeacher();return;}open('teacher');}
 async function loginTeacher(){const secret=password;setPassword('');await run(async()=>{teacherEpoch.current++;setTeacherRestoreError(false);const result=await authClient.auth.signInWithPassword({email:email.trim(),password:secret});if(result.error||!result.data.session)throw new Error('교사 이메일과 비밀번호를 확인해 주세요.');try{const approved=await teacherApi.classes();teacherActive.current=true;approvedTeacherId.current=result.data.session.user.id;setClasses(approved);setAdmin(true);setDialog(null);}catch(e){await authClient.auth.signOut({scope:'local'});throw e;}});}
 async function logout(){await run(async()=>{if(admin){teacherSigningOut.current=true;try{const result=await authClient.auth.signOut({scope:'local'});if(result.error)throw new Error('로그아웃에 실패했어요. 다시 시도해 주세요.');teacherEpoch.current++;teacherActive.current=false;setSession(null);setClasses(null);setAdmin(false);setDialog(null);}finally{teacherSigningOut.current=false;}}else{await studentRepository.logout();epoch.current++;setStudent(null);setDialog(null);}setToast('로그아웃했어요.');});}
 if(teacherChecking)return <div className="content"><p className="notice" role="status">교사 로그인 상태를 확인하고 있어요.</p></div>;
 const count=student?.logs.filter(l=>l.done).length||0;
 const days=student?.days||[];
 const title=admin?'선생님 공간':menu.find(m=>m.id===tab)?.label||'나의 아지트';
 return <div className="app">
  <aside className="sidebar"><a className="brand" href="#" onClick={e=>{e.preventDefault();setAdmin(false);setTab('home');}}><span className="brand-icon"><Mail size={23}/><Heart size={10}/></span><span>비밀의 마니또<small>우리 반만의 비밀 미션</small></span></a><div className="class-pill"><Users size={16}/><span>{admin?className:student?.className||'우리 반'}</span><span className="tiny">우리 반</span></div><nav aria-label="학생 메뉴">{menu.map(n=><button key={n.id} className={!admin&&tab===n.id?'nav active':'nav'} aria-current={!admin&&tab===n.id?'page':undefined} onClick={()=>{setAdmin(false);setTab(n.id);setError('');}}><n.icon size={20}/><span>{n.label}</span>{n.id==='missions'&&<span className="nav-badge">5</span>}{n.id==='reveal'&&!student?.revealed&&<LockKeyhole size={14} className="ml-auto"/>}</button>)}</nav><div className="sidebar-bottom"><button className={admin?'nav active':'nav'} onClick={teacher}><Settings2 size={20}/>선생님 공간<ArrowUpRight size={15} className="ml-auto"/></button><button className="help-link" onClick={()=>open('help')}>이용 안내<ArrowUpRight size={14}/></button></div></aside>
  <main><header><div className="breadcrumb"><span className="header-brand">비밀의 마니또</span><ChevronRight size={14}/><span className="current-page">{title}</span></div><div className="header-right"><span className="demo-tag">우리 반 온라인</span>{admin&&session?<button className="user-chip" disabled={busy} onClick={()=>void logout()}><ShieldCheck size={16}/>교사 로그아웃<LogOut size={16}/></button>:student?<button className="user-chip" disabled={busy} onClick={()=>void logout()} aria-label={`${student.student.name}님, 로그아웃`}><span className="avatar">{student.student.name.slice(-2)}</span>{student.student.name}<LogOut size={16}/></button>:<button className="user-chip" onClick={()=>open('login')}><KeyRound size={16}/>코드로 입장</button>}</div></header>
   <div className="content">
    {error&&!dialog&&<div className="notice live-error" role="alert">{error}<button className="text-button" disabled={busy} onClick={()=>void run(async()=>{if(teacherRestoreError)await restoreTeacher();else if(admin)await teacherApi.classes();else await refresh();})}><RefreshCw size={15}/>다시 확인</button></div>}
    {loading&&<p className="notice" role="status">접속 상태를 확인하고 있어요.</p>}
    {admin&&session&&classes?<TeacherPanel api={teacherApi} classes={classes} onClassName={setClassName} onUnauthorized={()=>{setClasses(null);setAdmin(false);void authClient.auth.signOut({scope:'local'});}}/>:<>
     <div className="page-heading"><div><h1>{title}</h1>{tab==='home'&&<p>{student?`${student.student.name}님, 오늘의 미션을 확인해 보세요.`:'코드로 입장하고 우리 반 미션에 참여해요.'}</p>}{tab==='diary'&&<p>미션을 하며 느낀 점을 기록해요.</p>}</div>{student&&<span className="chapter-chip"><span className="online-dot"/>{student.revealed?'정체 공개 완료':'미션 진행 중'}</span>}</div>
     {tab==='home'&&<><section className="hero"><div className="hero-copy"><span className="hero-tag"><Heart size={14}/>나만 아는 친구</span><h2>나의 마니또를 확인해 보세요!</h2><p>누구를 챙겨주게 될까요? 정체는 공개 전까지 비밀!</p><button className="btn primary" disabled={busy||loading} onClick={mate}>{student?'마니또 확인하기':'코드로 시작하기'}<ArrowRight size={17}/></button></div><div className="hero-art" aria-hidden="true"><span className="hero-mail"><Mail size={66}/><Heart size={26}/></span><Star className="hero-star" size={23}/><span className="hero-heart"><Heart size={18}/></span></div></section><div className="overview"><button className="stat-card" onClick={mate}><span className="stat-icon pink"><Heart size={22}/></span><div><span className="muted">나의 마니또</span><strong>{student?'친구 확인하기':'코드로 확인해요'}<LockKeyhole size={13}/></strong></div><ChevronRight className="ml-auto" size={17}/></button><div className="stat-card progress-card"><span className="stat-icon lavender"><CheckCheck size={22}/></span><div><span className="muted">미션 달성</span><strong>{count}<small> / 5 완료</small></strong><div className="mini-progress" role="progressbar" aria-label="미션 완료" aria-valuenow={count} aria-valuemin={0} aria-valuemax={5}><i style={{width:`${count*20}%`}}/></div></div></div><button className="stat-card" onClick={()=>setTab('reveal')}><span className="stat-icon lavender"><Gift size={22}/></span><div><span className="muted">정체 공개</span><strong>{student?.revealed?'지금 확인해요':'선생님 공개 대기'}</strong></div><ChevronRight className="ml-auto" size={17}/></button></div></>}
     {(tab==='home'||tab==='missions')&&<section className="missions-section"><div className="section-heading"><h2>{tab==='home'?'비밀 미션':'미션 목록'}<span className="count-badge">5</span></h2><span className="muted small"><CalendarDays size={15}/>지정된 날짜에 열려요</span></div>{days.length?<div className="mission-grid">{days.map(d=>{const done=student?.logs.some(l=>l.day===d.day&&l.done),Icon=icons[d.day-1]||Mail;return <button key={d.day} className={`mission-card ${done?'completed':d.open?'available':'locked'}`} disabled={busy} onClick={()=>journal(d)}><div className="mission-card-top"><span className="day-label">DAY {d.day}</span><span className={`status ${done?'done':d.open?'in-progress':'upcoming'}`}>{done?<Check size={12}/>:d.open?<span className="status-dot"/>:<LockKeyhole size={12}/>} {done?'완료':d.open?'진행 중':'예정'}</span></div><span className={`mission-symbol symbol-${d.day-1}`}><Icon size={25}/></span><h3>{d.title}</h3><span className="mission-date">{dateLabel(d.date)}</span><div className="mission-card-bottom">{done?'기록 보기':d.open?'미션 확인하기':'아직 열리지 않았어요'}{d.open?<ArrowRight size={15}/>:<LockKeyhole size={14}/>}</div></button>;})}</div>:<div className="panel empty"><Mail className="empty-icon" size={35}/><p>{student?'선생님이 미션을 준비하고 있어요.':'코드로 입장하면 우리 반 미션을 확인할 수 있어요.'}</p>{!student&&<button className="btn" onClick={()=>open('login')}>코드로 입장하기</button>}</div>}</section>}
     {tab==='home'&&<section className="promise-strip"><ShieldCheck size={23}/><div><h3>정체는 비밀로!</h3><p>부담 없는 작은 행동이면 충분해요.</p></div><button className="text-button" onClick={()=>open('help')}>이용 안내<ChevronRight size={16}/></button></section>}
     {tab==='diary'&&<div className="diary-list">{!student?<section className="panel empty"><span className="empty-icon"><BookHeart size={30}/></span><h2>나의 미션 기록</h2><p>코드로 입장하면 비밀 일지를 쓸 수 있어요.</p><button className="btn primary" onClick={()=>open('login')}>코드로 입장하기</button></section>:days.length?days.map(d=>{const log=student.logs.find(l=>l.day===d.day);return <section key={d.day} className="panel diary-card"><div className="section-line"><span className="day-label">DAY {d.day}<span className="diary-date">{dateLabel(d.date)}</span></span><span className={`status ${log?.done?'done':''}`}>{log?.done?'완료':log?'작성 중':'기록 전'}</span></div><h2>{d.title}</h2><p className="entry-text">{log?.text||'미션을 마치고 오늘의 이야기를 남겨보세요.'}</p><div className="diary-bottom">{log&&<span className="mood-tag"><Heart size={13}/>{log.mood}</span>}<button className="text-button" onClick={()=>journal(d)}>{log?'일지 보기':'일지 쓰기'}<ArrowRight size={15}/></button></div></section>;}):<p className="notice">선생님이 미션을 준비하고 있어요.</p>}</div>}
     {tab==='reveal'&&<section className="panel empty reveal-panel"><span className={`empty-icon ${student?.revealed?'pink':'lavender'}`}>{student?.revealed?<Gift size={34}/>:<LockKeyhole size={32}/>}</span><h2>{student?.revealed?'나의 마니또를 만나요!':'아직은 비밀이에요'}</h2><p>{student?.revealed?'나를 챙겨준 친구를 확인해 보세요.':'선생님이 정체를 공개하면\n나를 챙겨준 친구를 확인할 수 있어요.'}</p>{student?.revealed?<div className="reveal-result"><div><span>나를 챙겨준 친구</span><strong>{student.caredBy?.name||'확인 중'}</strong></div><Heart size={22}/><div><span>내가 챙겨준 친구</span><strong>{student.mate?.name||'먼저 비밀 서약을 해주세요'}</strong></div></div>:<button className="btn" disabled={busy} onClick={()=>student?void run(refresh):open('login')}><RefreshCw size={16}/>{student?'공개 상태 새로고침':'코드로 확인하기'}</button>}</section>}
    </>}
    <footer><span><Mail size={15}/>비밀의 마니또</span><div className="footer-links"><button onClick={teacher}>선생님 공간</button><button onClick={()=>open('help')}>이용 안내</button></div></footer>
   </div>
  </main>
  {dialog&&<Modal title={dialog==='login'?'코드로 입장하기':dialog==='teacher'?'선생님 로그인':dialog==='pledge'?'우리만의 비밀 유지 서약':dialog==='mate'?'나의 마니또':dialog==='journal'?day?.title||'비밀 일지':'비밀의 마니또 이용 안내'} busy={busy} onClose={()=>{setDialog(null);setError('');setCode('');setPassword('');}}>
   {error&&<p className="error" role="alert">{error}</p>}
   {dialog==='login'?<><p>선생님에게 받은 8자리 코드를 입력해요. 기존 20자리 코드도 사용할 수 있어요.</p><form onSubmit={e=>{e.preventDefault();const submitted=code;setCode('');void run(async()=>{await studentRepository.login(submitted);epoch.current++;const data=await studentRepository.snapshot();setStudent(data);setDialog(data.pledged?null:'pledge');});}}><label>나의 접속 코드<input autoFocus className="code-input" maxLength={40} autoComplete="off" autoCapitalize="characters" spellCheck={false} value={code} onChange={e=>setCode(e.target.value)} placeholder="8자리 접속 코드" disabled={busy}/></label><button className="btn primary full" disabled={busy||!code.trim()}>{busy?'확인 중…':'입장하기'}<ArrowRight size={17}/></button></form></>
   :dialog==='teacher'?<><p>승인된 교사 계정으로 로그인해 주세요.</p><form onSubmit={e=>{e.preventDefault();void loginTeacher();}}><label>이메일<input type="email" autoComplete="username" required value={email} onChange={e=>setEmail(e.target.value)} disabled={busy}/></label><label>비밀번호<input type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)} disabled={busy}/></label><button className="btn primary full" disabled={busy}>{busy?'확인 중…':'교사 로그인'}<ShieldCheck size={17}/></button></form></>
   :dialog==='pledge'?<><p>{student?.student.name}님, 비밀 요원이 될 준비가 되었나요?</p><div className="pledge-list"><p><LockKeyhole size={18}/>공개하는 날까지 내 정체를 지킬게요.</p><p><Heart size={18}/>친구가 편안한 작은 다정함을 전할게요.</p><p><Gift size={18}/>놀리거나 부담스러운 선물은 하지 않을게요.</p><p><BookHeart size={18}/>내 비밀 일지에 솔직하게 남길게요.</p></div><button className="btn primary full" disabled={busy} onClick={()=>void run(async()=>{await studentRepository.pledge();await refresh();setDialog('mate');})}>약속해요, 마니또 만나기<Heart size={17}/></button></>
   :dialog==='mate'?<><p>내가 챙겨줄 친구는…</p><div className="mate-name"><span className="mate-avatar"><Heart size={27}/></span><strong>{student?.mate?.name||'아직 배정 중이에요'}</strong><span className="mate-secret"><LockKeyhole size={12}/>공개 전까지 비밀!</span></div><p>이 화면은 나만 보기!</p><button className="btn primary full" onClick={()=>setDialog(null)}><Eye size={17}/>확인했어요</button></>
   :dialog==='journal'&&day?<><span className="day-label">DAY {day.day}<span className="diary-date">{dateLabel(day.date)}</span></span><p>{day.description}</p><fieldset className="mood-field" disabled={busy}><legend>오늘의 기분</legend><div className="moods">{['설레요','뿌듯해요','따뜻해요','조금 어려워요'].map(m=><button key={m} aria-pressed={mood===m} className={mood===m?'selected':''} onClick={()=>setMood(m)}>{m}</button>)}</div></fieldset><label htmlFor="live-journal">나의 비밀 일지</label><textarea id="live-journal" rows={5} maxLength={1500} value={text} onChange={e=>setText(e.target.value)} disabled={busy} placeholder="무엇을 했나요? 어떤 기분이었나요?"/><span className="char-count">{text.length} / 1,500</span><div className="modal-actions">{[false,true].map(done=><button key={String(done)} className={done?'btn primary':'btn'} disabled={busy} onClick={()=>void run(async()=>{await studentRepository.saveLog({day:day.day,done:done||!!student?.logs.find(l=>l.day===day.day)?.done,text,mood});await refresh();setDialog(null);setToast(done?'미션을 완료했어요!':'일지를 저장했어요.');})}>{done?<><Check size={17}/>미션 완료</>:'일지 저장'}</button>)}</div></>
   :<><ol className="guide"><li>선생님이 준 개인 코드로 입장해요.</li><li>비밀 서약을 하고 내 마니또를 확인해요.</li><li>지정된 날짜에 미션을 확인해요.</li><li>미션을 하고 비밀 일지를 남겨요.</li><li>선생님이 공개할 때까지 정체는 비밀!</li></ol><div className="notice">일지는 본인과 담당 선생님만 볼 수 있어요. 공용 기기에서는 사용 후 로그아웃해 주세요.</div><button className="btn primary full" onClick={()=>setDialog(null)}>알겠어요</button></>}
  </Modal>}
  {toast&&<div className="toast" role="status"><Check size={18}/>{toast}</div>}
 </div>;
}
