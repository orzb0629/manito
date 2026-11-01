export type ClientConfig = { mode: 'demo' } | { mode: 'supabase'; url: string; key: string } | { mode: 'invalid'; message: string };

export function resolveClientConfig(env: { VITE_SUPABASE_URL?: string; VITE_SUPABASE_ANON_KEY?: string }): ClientConfig {
 const url = env.VITE_SUPABASE_URL?.trim();
 const key = env.VITE_SUPABASE_ANON_KEY?.trim();
 if (!url && !key) return { mode: 'demo' };
 const invalid = (detail:string):ClientConfig => ({ mode:'invalid',message:`Supabase 공개 환경변수를 확인해 주세요. 데모 모드로 자동 전환하지 않습니다. ${detail}` });
 if (!url || !key) return invalid('VITE_SUPABASE_URL과 VITE_SUPABASE_ANON_KEY를 모두 설정해 주세요.');
 try {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) return invalid('VITE_SUPABASE_URL에는 사용자 정보·쿼리·해시가 없는 HTTPS 프로젝트 기본 주소를 입력해 주세요.');
  if(parsed.pathname!=='/')return invalid('VITE_SUPABASE_URL에는 /rest/v1/ 등의 경로를 제외한 프로젝트 기본 주소만 입력해 주세요.');
  if (key.startsWith('sb_publishable_') && key.length > 24) return { mode: 'supabase', url, key };
  // Only a legacy anon JWT is allowed in the client, never a service_role JWT.
  const payload = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  if (key.split('.').length !== 3 || payload.role !== 'anon') return invalid('VITE_SUPABASE_ANON_KEY에는 publishable key 또는 legacy anon key만 사용할 수 있어요.');
  return { mode: 'supabase', url, key };
 } catch { return invalid('URL 형식과 공개 키 형식을 확인하고 설정 변경 후 개발 서버를 재시작해 주세요.'); }
}
