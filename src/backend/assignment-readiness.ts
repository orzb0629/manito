import type {TeacherSnapshot} from './types.ts';
export function assignmentReadiness(state:TeacherSnapshot):'ready'|'locked'|'students'|'missions' {
 if(state.status!=='setup')return 'locked';
 if(state.students.length<3)return 'students';
 if(state.days.length!==5)return 'missions';
 let previous='';
 for(const [index,day] of state.days.entries()) {
  if(day.day!==index+1||typeof day.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(day.date)||!Number.isFinite(Date.parse(day.date+'T00:00:00Z'))||new Date(day.date+'T00:00:00Z').toISOString().slice(0,10)!==day.date||day.date<=previous||typeof day.title!=='string'||!day.title.trim()||typeof day.description!=='string'||!day.description.trim())return 'missions';
  previous=day.date;
 }
 return 'ready';
}
