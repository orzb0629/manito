export const ACCESS_CODE_LENGTH=8;
export const ACCESS_CODE_ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const isNewAccessCode=(value:unknown):value is string=>typeof value==='string'&&/^[A-HJ-NP-Z2-9]{8}$/.test(value);
export function normalizeAccessCode(value:unknown):string|null {
 if(typeof value!=='string'||value.length>40)return null;
 const normalized=value.replace(/[ -]/g,'').toUpperCase();
 // Migration period: never truncate or re-hash existing 20-character credentials.
 return /^(?:[A-HJ-NP-Z2-9]{8}|[A-HJ-NP-Z2-9]{20})$/.test(normalized)?normalized:null;
}
export function issuedCodeCsv(rows:{name:string;code:string}[]):string {
 if(rows.some(r=>!isNewAccessCode(r.code)))throw new Error('새로 발급한 8자리 코드만 CSV로 내려받을 수 있어요.');
 const cell=(s:string)=>'"'+(/^[=+\-@\t\r]/.test(s)?"'"+s:s).replaceAll('"','""')+'"';
 return '\uFEFF이름,접속 코드\r\n'+rows.map(r=>`${cell(r.name)},${cell(r.code)}`).join('\r\n');
}
