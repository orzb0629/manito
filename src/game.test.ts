import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {assign,defaults,code} from './game.ts';
test('배정은 자기 자신을 제외하고 모든 친구에게 정확히 한 번 연결한다',()=>{for(let n=2;n<=40;n++){const students=Array.from({length:n},(_,i)=>({id:String(i),name:`학생${i}`,code:String(i)}));for(let trial=0;trial<20;trial++){const result=assign(students);assert.equal(Object.keys(result).length,n);assert.equal(new Set(Object.values(result)).size,n);students.forEach(s=>{assert.notEqual(result[s.id],s.id);assert.ok(students.some(v=>v.id===result[s.id]));});}}});
test('한 명만 등록한 경우 배정을 거부한다',()=>{assert.throws(()=>assign(defaults.students.slice(0,1)));});
test('기본 미션은 5개이며 정체는 비공개 상태로 시작한다',()=>{assert.equal(defaults.missions.length,5);assert.equal(defaults.revealed,false);});
test('접속 코드는 8자리이며 혼동하기 쉬운 문자를 제외한다',()=>{for(let i=0;i<100;i++)assert.match(code(),/^[A-HJ-NP-Z2-9]{8}$/);});
