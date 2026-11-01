# 비밀의 마니또

중학교 한 반을 위한 5회 비밀 미션 웹앱. React + Vite + TypeScript + Tailwind CSS + Lucide React.

## 실행

```sh
npm install
npm run dev
npm run test
npm run test:security
npm run test:browser
npm run build
```

Windows PowerShell 실행 정책으로 npm이 차단되면 `npm.cmd`를 사용하세요. 개발 서버에서 출력되는 Network 주소로 같은 네트워크의 휴대폰에서도 화면을 볼 수 있습니다.

Windows + Chrome의 운영 모드 로컬 HTTPS는 먼저 [mkcert 설정 안내](docs/LOCAL_HTTPS_WINDOWS.md)에 따라 인증서를 준비한 뒤 `npm.cmd run dev:https`를 실행하세요. 브라우저 인증서 경고를 우회하지 않습니다.

## 체험

- 학생: `DEMO01` ~ `DEMO04`로 입장 → 비밀 서약 → 자신이 챙길 친구 확인.
- 미션은 선생님이 지정한 날짜의 한국 시간 00시부터 열립니다. 기본 일정은 2026년 11월 2·4·6·9·11일입니다. 선생님 공간에서 날짜를 바꿔 체험할 수 있습니다.
- 하단 왼쪽의 선생님 공간에서 학생 명단 추가, 코드 CSV 다운로드, 무작위 배정, 5회 일정 및 미션 편집, 수동 정체 공개가 가능합니다. 휴대폰에서는 페이지 맨 아래의 선생님 공간 링크를 사용하세요.
- 학생 추가 또는 재배정은 기존 배정·서약·일지를 초기화합니다. 이름이 같은 학생도 서로 다른 코드로 구분됩니다.
- 미션 완료와 일지 저장은 독립적입니다. 정체 공개는 날짜와 무관하게 선생님이 직접 확인하고 실행해야 합니다.

## 현재 범위와 실제 운영 전 작업

Supabase 공개 환경변수가 둘 다 없으면 기존 **로컬 체험 앱**입니다. 데이터는 localStorage에 저장됩니다. 다른 브라우저/휴대폰과 동기화되지 않으며, 개발자 도구에서 전체 데이터가 보입니다. 데모에 실제 학생 명단·비밀 일지를 입력하지 마세요.

**Supabase 2단계**에서 기존 디자인을 유지한 학생·교사 운영 UI를 연결했습니다. 정상 공개 설정이 있으면 서버 로그인·쿠키 복원·서약·미션·일지·관리 기능이 실행됩니다. 일부 공개 설정만 있으면 오류 화면을 표시합니다. 운영 일지는 학생 본인과 담당 승인 교사가 조회할 수 있습니다. 기존 데모는 공개 설정 두 개가 모두 없을 때만 실행되며 데이터는 서로 섞이지 않습니다.

기존 001~003 SQL을 적용했다면 **[004 migration](supabase/migrations/202611010004_short_access_codes.sql)만 추가 적용**하면 새 코드가 8자리로 발급됩니다. 기존 20자리 로그인은 유지되며 재발급하면 기존 코드·학생 세션이 폐기됩니다. 서버 전용 SUPABASE_SECRET_KEY를 설정하고 `npm.cmd run setup:local` → `npm.cmd run dev:https`로 실행합니다. 자세한 절차는 [2단계 실행 가이드](docs/PHASE2.md), 권한 경계는 [Supabase 안내](supabase/README.md)를 확인하세요. 최신 publishable key를 VITE_SUPABASE_ANON_KEY에 사용할 수 있습니다. Node 22.18 이상이 필요합니다.

## Vercel

Vite 프리셋, 빌드 명령 `npm run build`, 출력 폴더 `dist`, 동일 출처 `api/backend.ts` Node Function 구성을 사용합니다. 개발 서버에는 API middleware가 연결되며 Vite preview는 정적 파일 확인용입니다. 이번 작업에서는 배포하지 않습니다. 실제 프로젝트의 Auth·쿠키·다중 기기 통합 검증을 마친 뒤 운영하세요. 서버 비밀 키를 VITE 변수에 넣지 마세요. 배포 환경변수 목록과 APP_ORIGIN 설정은 [2단계 실행 가이드](docs/PHASE2.md)에 있습니다.
