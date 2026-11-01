# Supabase 2단계: 운영 화면 연결 및 HTTPS 실행

학생·교사 화면이 기존 라벤더/연핑크 디자인 그대로 서버 repository에 연결되었습니다. 기존 데모 App과 `manito-v1` 데이터는 별도로 유지합니다. 이번 작업에서는 GitHub push, Vercel 배포, 실제 Supabase 학생 데이터 변경을 수행하지 않았습니다.

## 지금 필요한 두 가지

**8자리 코드 업데이트:** 001~003을 이미 적용했다면 `202611010004_short_access_codes.sql`만 추가 적용하고 개발 서버를 재시작하세요. 이후 발급·재발급·CSV는 8자리로 통일됩니다. 004가 없으면 신규 발급은 마이그레이션 안내와 함께 거부됩니다. 기존 20자리 로그인은 계속 지원하며, 재발급 전 코드를 임의로 자르지 않습니다. 아래의 003 안내는 아직 003을 적용하지 않은 경우에만 해당합니다.

1. Supabase SQL Editor에서 **`supabase/migrations/202611010003_teacher_management.sql`만 추가 실행**합니다. 적용한 001·002 파일을 다시 실행하지 않습니다. 이어서 `supabase/tests/verify_access.sql`을 다시 실행합니다. 새 migration은 `classes.settings_version`과 교사 관리 RPC를 추가하며 기존 데이터를 초기화하지 않습니다.
2. `.env.local`에 **서버용 `SUPABASE_SECRET_KEY`**를 넣습니다. Supabase API Keys에서 `sb_secret_...` 또는 레거시 service_role 값을 확인해 편집기에서 직접 입력하세요. 이 값은 채팅·공유 문서·VITE 변수에 넣지 않습니다. 실제 키는 `.env.example`에 적지 않습니다.

`npm.cmd run setup:local`은 기존 설정을 보존하면서 AUTH_PEPPER가 비어 있으면 난수를 생성하고, APP_ORIGIN이 없으면 로컬 HTTPS 기본값을 추가합니다. 생성된 비밀값은 터미널에 출력하지 않습니다. 기존 pepper를 덮어쓰지 않습니다. 이번 작업 중 이 도구를 실행했으며, 당시 서버 secret key 미설정을 확인했습니다.

```dotenv
# 브라우저 공개 설정 (이미 설정했다면 유지)
VITE_SUPABASE_URL=https://<PROJECT_REF>.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_<PUBLIC_KEY>

# 서버 전용
SUPABASE_SECRET_KEY=<SERVER_SECRET_KEY>
AUTH_PEPPER=<setup:local에서 생성된 값을 유지>
APP_ORIGIN=https://localhost:5173
```

서버의 SUPABASE_URL·SUPABASE_ANON_KEY를 별도로 적지 않으면 공개 URL·공개 키를 재사용합니다. 브라우저로 서버 비밀을 전달하는 역방향 fallback은 없습니다. 설정을 바꾸면 개발 서버를 재시작하세요.

## 로컬 실행

```powershell
npm.cmd install
npm.cmd run setup:local
npm.cmd run dev:https
```

브라우저에서 **https://localhost:5173**을 엽니다. `APP_ORIGIN`은 브라우저 주소창의 실제 HTTPS origin(프로토콜·호스트·포트)과 정확히 같아야 합니다. 끝 `/`, 경로, wildcard를 넣지 않습니다. localhost와 127.0.0.1은 서로 다른 origin입니다. 포트가 이미 사용 중이면 기존 개발 서버를 종료하거나 포트와 APP_ORIGIN을 함께 변경하세요. 자동으로 다른 포트로 넘어가지 않도록 strictPort를 사용합니다.

Vite의 서버 전용 middleware가 `/api/backend`를 같은 HTTPS 서버에서 실행합니다. 프런트엔드와 API를 따로 띄울 필요가 없습니다. `npm.cmd run dev`도 정상 Supabase 설정에서는 HTTPS를 켜며, 공개 설정 두 개가 모두 없는 데모에서는 기존 HTTP 개발 모드를 유지합니다. **`vite preview`는 정적 파일 확인용이며 API 서버가 아닙니다.**

### 인증서와 쿠키

- 로컬 개발은 mkcert가 서명한 `.certs/localhost.pem`, `.certs/localhost-key.pem`을 자동으로 사용합니다. 자체 서명 인증서로 되돌아가지 않으며, 인증서가 없으면 설정 안내와 함께 시작을 거부합니다. Windows 신뢰 등록과 생성 순서는 [localhost HTTPS 안내](LOCAL_HTTPS_WINDOWS.md)를 따르세요.
- 다른 인증서 경로는 DEV_TLS_CERT_FILE·DEV_TLS_KEY_FILE을 둘 다 지정해 사용합니다. 인증서 신뢰 설치는 OS·휴대폰에서 사용자가 직접 진행합니다. 코드에서 시스템 신뢰 저장소를 변경하지 않습니다. 빌드·실제 배포에는 로컬 인증서가 필요하지 않습니다.
- 로컬 인증서 또는 HTTPS 문제를 해결하기 위해 `Secure`, `HttpOnly`, `SameSite=Strict`, `__Host-` 쿠키 정책을 끄지 않습니다. 개발 프록시의 TLS 검증을 전역으로 해제하지 않습니다.
- 휴대폰 LAN 테스트에서는 해당 HTTPS 호스트에 대한 신뢰 인증서가 필요하고 APP_ORIGIN도 그 주소로 맞춰야 합니다. 실제 학급 사용에는 유효한 공인 TLS가 있는 배포 주소를 사용하세요.

## 사용 흐름

### 교사

1. ‘선생님 공간’ → Supabase Auth 교사 이메일/비밀번호 로그인.
2. 서버가 승인 교사인지 검사한 후 담당 학급 목록을 반환합니다. 일반 회원가입이나 클라이언트 역할값으로 승인되지 않습니다. 담당 학급이 없으면 대시보드의 teacher_id 연결을 확인합니다.
3. setup 학급에서 명단 추가·이름 수정·삭제가 가능합니다. 삭제 시 해당 학생의 코드·세션·기록도 삭제됨을 확인받습니다. 최대 80명이며 이름 중복은 허용합니다.
4. 반 이름과 DAY 1~5 날짜·미션을 입력하고 **설정 저장**을 누릅니다. 날짜는 서로 다른 오름차순이어야 하고, 연속 날짜·월~금 제한은 없습니다. 수정 중 학급 전환은 저장/취소 전까지 막습니다.
5. 각 학생의 **코드 발급**을 누릅니다. 새 코드는 혼동 문자 O/0/I/1을 제외한 대문자·숫자 8자리입니다. 원본 코드는 이번 발급 응답에서만 보이며, ‘발급한 코드 CSV’에는 현재 화면에서 발급한 8자리 코드만 담깁니다. 과거 코드 원문을 서버에서 조회하지 않습니다. 교사 화면을 떠나거나 새로고침하면 메모리의 코드가 사라집니다. 재발급하면 기존 코드·세션이 폐기됩니다.
6. 학생 최소 3명, 날짜·미션 5개 준비 후 **배정 미리보기 → 확인하고 배정 확정**. 확정하면 명단·배정은 잠깁니다. 잠긴 뒤 임의 재배정은 제공하지 않습니다.

   날짜·미션은 입력만 하지 말고 반드시 ‘설정 저장’으로 저장해야 합니다. 저장된 5개가 없으면 미리보기가 비활성화되며 서버도 422 `assignment_not_ready`로 거부합니다. 미리보기 전 최신 학급 정보를 읽고, 서버가 확인한 rosterVersion/settingsVersion과 미리보기를 함께 전달합니다. 생성 전후나 확정 전 상태가 달라지면 기존 미리보기를 폐기하고 다시 생성하도록 안내합니다. 명단 버전의 최종 원자적 검사는 기존 002의 확인 RPC가 수행합니다. 설정 버전은 서버 재조회로 확인하며, RPC 간 별도 트랜잭션을 하나의 원자적 트랜잭션으로 간주하지 않습니다.

   미리보기/확정 오류가 나면 이전 미리보기와 확인 토큰을 화면에서 제거하고 최신 상태를 재조회합니다. 날짜·미션 미저장, 버전 변경, 만료·교체된 미리보기는 각각 다른 안내를 표시하며 권한 거부는 기존처럼 차단합니다. 화면 상태를 강제로 locked로 바꾸거나 실패한 확정을 자동 재시도하지 않습니다.
7. 진행 현황에서 서약·DAY별 완료 여부를 확인합니다. 일지는 ‘보기’를 눌러 담당 학급 학생의 기록만 조회합니다. 기본 진행 현황 응답에는 일지 본문이 없습니다.
8. **우리 반 정체 공개하기 → 확인하고 정체 공개**. 확인 토큰은 5분 단일 사용이며 취소하면 공개되지 않습니다. DAY 5나 완료 체크로 자동 공개되지 않습니다.
9. 사용 후 **교사 로그아웃**. 교사 Auth 세션만 Supabase SDK의 전용 localStorage 키(`manito.teacher.auth.*`)로 유지하며 토큰을 자동 갱신합니다. 새로고침 때는 복원이 끝날 때까지 대기하고 서버에서 승인·담당 학급을 다시 확인합니다. 명시적 로그아웃이나 유효하지 않은 세션은 저장된 인증을 제거하고 재로그인을 요구합니다. 학생 쿠키 세션과 별개이며 학생 코드·토큰·일지는 이 저장소에 넣지 않습니다. 비밀번호를 저장하지 않으며 공용 PC에서는 반드시 교사 로그아웃하세요.

학급 신규 생성은 이번 UI 범위에 포함하지 않았습니다. 이미 생성한 학급을 조회하며, 추가 학급은 대시보드에서 승인 교사의 UUID로 등록할 수 있습니다.

### 학생

개인 코드 입장 → 비밀 서약 → 내 마니또 확인 → 날짜에 맞는 미션·일지 저장 → 교사 공개 후 나를 챙겨준 친구 확인. 학생 세션은 HttpOnly 쿠키로 새로고침 후 복원됩니다. 30초 간격 및 탭 복귀 시 서버 상태를 갱신하며, 정체 공개 화면에서 직접 새로고침도 가능합니다. 로그아웃·만료·코드 재발급 후에는 다시 코드를 입력해야 합니다.

학생의 코드·토큰·일지·명단을 localStorage/sessionStorage에 저장하지 않습니다. 일반 연결 오류나 요청 제한 시 입력 일지는 화면에 유지되며 저장 성공 전 완료로 표시하지 않습니다. 세션 만료 시에는 개인 화면을 닫고 재로그인을 요청합니다. 일지 내용이 저장됐으나 후속 새로고침만 실패한 경우에는 오류를 확인하고 재조회하세요.

## 추가 API와 동시 편집

모두 `/api/backend` JSON POST이고 검증된 교사 Bearer와 서버 학급 소유권 검사가 필요합니다.

| action | 기능 |
| --- | --- |
| teacher.classes | 승인 확인과 담당 활성 학급 목록 |
| teacher.snapshot | 명단·일정·서약·완료 현황; 원본 코드·전체 배정·일지 본문 제외 |
| teacher.addStudents | 명단 추가 |
| teacher.renameStudent / teacher.removeStudent | setup 상태 명단 변경 |
| teacher.saveSettings | 반 이름·5일 일정·미션의 원자적 저장 |
| teacher.logs | 담당 학생 일지 명시적 조회 |

명단 변경은 기존 roster_version, 일정 변경은 새 settings_version을 검사합니다. 여러 교사 창에서 오래된 화면을 덮어쓰려 하면 409로 거부합니다. 새로고침 후 변경을 다시 적용하세요. DB 작업은 학급 row lock과 트랜잭션으로 처리합니다. API에 학생 ID를 보내는 교사 작업도 반드시 해당 학급 소속을 서버에서 확인합니다.

기존 학생 로그인·서약·저장·로그아웃, 코드 발급, 배정·공개의 서버 전용 RPC와 RLS를 재사용합니다. 새 RPC도 anon/authenticated/PUBLIC 실행을 차단하고 service_role만 실행합니다. 이미 적용한 001·002 마이그레이션은 수정하지 않았습니다.

## Vercel 배포 준비 (이번에는 배포하지 않음)

프로젝트 루트는 이 폴더, 프레임워크는 Vite, 빌드 명령 `npm run build`, 출력 `dist`를 사용합니다. `api/backend.ts`는 Node Function으로 함께 실행되어야 합니다. 정적 dist만 별도 호스팅하면 API가 동작하지 않습니다. `/api/*`를 index.html로 보내는 전역 SPA rewrite를 추가하지 마세요. Node 22.18 이상을 사용합니다.

| 환경변수 | 공개 여부 | 설정 |
| --- | --- | --- |
| VITE_SUPABASE_URL | 공개 | Supabase 프로젝트 URL |
| VITE_SUPABASE_ANON_KEY | 공개 | publishable key 또는 legacy anon JWT |
| SUPABASE_SECRET_KEY | 서버 전용 | secret key 또는 legacy service_role JWT |
| AUTH_PEPPER | 서버 전용 | 안정적으로 유지하는 고엔트로피 비밀; 기존 코드/세션을 유지하려면 같은 값 |
| APP_ORIGIN | 서버 전용 설정 | 실제 앱 HTTPS origin, 예: https://your-domain.example |
| SUPABASE_URL / SUPABASE_ANON_KEY | 서버 선택 설정 | 별도 지정하지 않으면 공개 설정의 URL/공개 키 사용 |

Vercel Environment Variables에서 Production·Preview를 구분합니다. preview를 사용할 경우 그 환경의 정확한 HTTPS origin과 별도의 검증용 Supabase 프로젝트·비밀을 사용합니다. 동적 preview 주소를 Host 헤더나 wildcard로 자동 신뢰하지 않습니다. 배포 주소가 확정되면 APP_ORIGIN을 해당 주소로 설정하고 재배포합니다. DEV_TLS_*와 자체 서명 인증서는 Vercel에 설정하지 않습니다.

Supabase Auth의 Site URL·Redirect URLs도 실제 앱 주소로 제한합니다. 공개 회원가입은 끄고 교사만 승인합니다. `app_private`를 Data API 노출 스키마에 추가하거나 민감한 테이블을 Realtime publication에 넣지 않습니다. 서버 secret은 RLS를 우회하므로 서버 RPC의 승인·소유권 검사를 제거하지 마세요.

## 검증

```powershell
npm.cmd test
npm.cmd run test:security
npm.cmd run test:browser
npm.cmd run build
```

브라우저 테스트는 Chrome/Edge 설치 경로를 자동 탐색합니다. 다른 경로는 BROWSER_EXECUTABLE로 지정하거나 `npx playwright install chromium`으로 테스트 브라우저를 설치하세요. 테스트는 별도 HTTPS 서버·PGlite PostgreSQL·가상 Auth 응답만 사용하며 실제 프로젝트·교사·학생 데이터를 변경하지 않습니다. 인증서 오류 허용은 이 테스트 브라우저 컨텍스트에만 사용합니다.

테스트가 검증하는 것: 승인 거부·로그인, 명단 등록/수정, 일정 저장, 코드/CSV, 배정 확정·잠금, 학생 HttpOnly/Secure/Strict 쿠키·복원·서약·일지, 진행 현황, 공개 취소·확정, 재발급 후 세션 폐기, 양쪽 로그아웃, 인증정보의 브라우저 저장소 미사용 및 모바일 가로 넘침 방지.

**실제 Supabase Auth·REST 네트워크 통합은 프로젝트에서 직접 확인해야 합니다.** 가상 학생 최소 3명으로 먼저 점검한 뒤 실제 학급에 사용하세요. 사용자 명단·개인 코드·일지·Authorization·쿠키가 로그/오류 수집 도구에 포함되지 않도록 운영 설정도 확인합니다.

공식 참고: [Vite HTTPS 및 middleware](https://vite.dev/config/server-options), [Supabase Auth 설정](https://supabase.com/docs/reference/javascript/initializing), [Supabase 키](https://supabase.com/docs/guides/api/api-keys), [Vercel Node Functions](https://vercel.com/docs/functions/runtimes/node-js).
