export type Student = { id: string; name: string; code: string };
export type Mission = { title: string; description: string; date: string };
export type Entry = { done: boolean; text: string; mood: string };
export type Game = { className: string; students: Student[]; assignments: Record<string,string>; missions: Mission[]; entries: Record<string,Entry>; pledged: string[]; revealed: boolean };
export const defaults: Game = {
 className: '2학년 3반', students: [{id:'demo1',name:'김하늘',code:'DEMO01'},{id:'demo2',name:'이서연',code:'DEMO02'},{id:'demo3',name:'박지우',code:'DEMO03'},{id:'demo4',name:'최도윤',code:'DEMO04'}],
 assignments: {demo1:'demo2',demo2:'demo3',demo3:'demo4',demo4:'demo1'},
 missions: [
 {title:'몰래 건네는 응원 한마디',description:'마니또에게 오늘 하루 힘이 되는 말을 건네 보세요. 짧은 쪽지도, 자연스러운 한마디도 좋아요.',date:'2026-11-02'},
 {title:'작은 도움의 요정',description:'친구에게 도움이 필요한 순간을 찾아 조용히 도와주세요. 마음만큼은 크게!',date:'2026-11-04'},
 {title:'칭찬 한 스푼',description:'평소에 발견한 친구의 좋은 점을 진심을 담아 칭찬해 주세요.',date:'2026-11-06'},
 {title:'함께라서 좋은 하루',description:'친구가 혼자 있는 순간, 먼저 다가가 함께해 주세요.',date:'2026-11-09'},
 {title:'마음을 담은 마지막 편지',description:'다섯 번의 미션을 떠올리며 고마운 마음을 편지로 전해 주세요. 정체는 아직 비밀!',date:'2026-11-11'}], entries:{},pledged:[],revealed:false
};
export function assign(students: Student[]): Record<string,string> {
 if(students.length<2) throw new Error('학생을 2명 이상 등록해 주세요.');
 const shuffled=[...students];
 for(let i=shuffled.length-1;i>0;i--){const j=crypto.getRandomValues(new Uint32Array(1))[0]%(i+1);[shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]];}
 return Object.fromEntries(shuffled.map((s,i)=>[s.id,shuffled[(i+1)%shuffled.length].id]));
}
export function today(){return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date());}
export function code(){return Array.from(crypto.getRandomValues(new Uint8Array(8)),v=>'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[v%32]).join('');}
export function load():Game {try {const v=JSON.parse(localStorage.getItem('manito-v1')||'null');if(v && Array.isArray(v.students)&&v.missions?.length===5&&v.entries&&v.assignments&&Array.isArray(v.pledged))return v;}catch{/* fall back */} return structuredClone(defaults);}
