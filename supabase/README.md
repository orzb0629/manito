# 비밀의 마니또 · Supabase

운영 UI·서버 API·DB/RLS 구현이 포함되어 있습니다. 이미 적용한 마이그레이션은 재실행하지 않습니다. 8자리 코드 발급에는 **004 migration 추가 적용**이 필요합니다. 실행·쿠키·환경변수·Vercel 준비 절차는 [2단계 설정 가이드](../docs/PHASE2.md)를 확인하세요.

## 마이그레이션

| 파일 | 내용 |
| --- | --- |
| 202611010001_schema.sql | 기본 테이블·FK·인덱스·삭제 정책·RLS·날짜/배정 제약 |
| 202611010002_api.sql | 학생 코드/세션·서약·일지·교사 코드 발급·배정/공개 2단계 RPC |
| 202611010003_teacher_management.sql | 교사 학급·명단·일정·진행 현황·일지 API, settings_version |
| 202611010004_short_access_codes.sql | 8자리 발급용 충돌 방지 RPC; 기존 해시·세션 보존 |

새 프로젝트는 파일명 순서대로 4개를 적용합니다. 기존 프로젝트는 아직 적용하지 않은 파일만 SQL Editor에서 postgres 소유자로 실행합니다. 각 migration은 트랜잭션이며 반복 실행용 스크립트는 아닙니다. 적용 후 `tests/verify_access.sql`을 실행하세요. 이번 로컬 작업에서는 실제 프로젝트에 SQL을 실행하지 않았습니다.

## 테이블

| 테이블 | 내용 |
| --- | --- |
| public.classes | 담당 교사, setup/locked/revealed, 학급명, 활성 상태, 명단/설정 버전 |
| public.activity_days | 학급별 DAY 1~5, 서로 다른 오름차순 날짜 |
| public.students | 학생·학급·자격 버전 |
| public.assignments | 단일 전체 순환 배정, 확정 후 잠금 |
| public.missions | 날짜별 제목·설명 |
| public.mission_logs | 학생별 완료·기분·비밀 일지 |
| public.pledges | 학생별 비밀 유지 서약 |
| public.access_credentials | 코드 해시·버전·만료 |
| app_private.teacher_accounts | 관리자가 승인한 Auth 교사 |
| app_private.student_sessions | 세션 토큰 해시·만료·폐기 |
| app_private.rate_limits | 서버 인스턴스 간 공유 요청 제한 |
| app_private.confirmations | 교사/학급/목적별 단일 사용 확인 토큰 해시 |

모든 12개 테이블에 ENABLE/FORCE RLS를 적용합니다. `app_private`는 Data API 노출 스키마에 추가하지 않습니다. 학급 삭제는 학생·배정·일지·코드·세션으로 cascade하며, 담당 학급이 남아 있으면 교사 Auth 계정 삭제는 restrict됩니다. 확정 후 명단과 배정 수정은 차단되고, 일정·미션 수정은 교사가 명시적으로 저장할 수 있습니다.

## 인증과 접근 경계

- 학생은 Supabase Auth 회원가입 없이 서버 발급 코드로 입장합니다. 새 코드는 대문자·숫자 8자리이며 O/0/I/1을 제외합니다. 32종 문자에서 crypto.randomInt로 선택하는 40비트 코드이며, 기존 20자리보다 엔트로피가 낮아 서버 요청 제한을 함께 적용합니다. 서버에는 HMAC-SHA256 해시만 저장하고, 세션은 별도의 256비트 난수입니다.
- 학생은 Supabase JWT를 받지 않으며 테이블 직접 접근은 차단됩니다. 동일 출처 API가 HttpOnly/Secure/SameSite=Strict `__Host-` 쿠키를 받아 세션 해시에서 학생을 찾아 자기 데이터에만 연결합니다. 브라우저가 보내는 학생 ID·역할을 인증으로 사용하지 않습니다.
- 코드 만료는 90일, 학생 세션은 최대 12시간입니다. 코드 재발급은 버전 증가·코드 교체·기존 세션 폐기를 하나의 트랜잭션으로 처리합니다. AUTH_PEPPER 변경은 기존 코드·세션을 무효화하므로 운영 중 임의 변경하지 않습니다.
- 학생 snapshot에는 전체 명단·원본 코드·전체 배정·타인 일지가 없습니다. 서약 후 배정받은 친구 이름만 보이고, 공개 전에는 `caredBy` 속성 자체가 없습니다.
- 교사는 Supabase Auth로 로그인합니다. API마다 getUser로 신원을 검증한 뒤 승인 목록·학급 소유권을 SQL에서 재검사합니다. 교사 세션만 전용 localStorage 키로 유지하고 자동 갱신하며, 새로고침 복원 시 서버 승인을 다시 확인합니다. 사용자 메타데이터나 저장된 세션 자체를 승인 근거로 쓰지 않습니다. 학생의 HttpOnly 쿠키 인증은 별도로 유지합니다.
- 승인 교사는 자기 학급 관련 테이블 SELECT만 직접 허용됩니다. 원본 자격·내부 세션은 조회할 수 없습니다. 모든 변경은 서버 전용 RPC로 처리합니다. 담당 교사는 학생 일지를 조회할 수 있지만 진행 현황 snapshot에는 본문이 포함되지 않습니다.
- `manito_*` RPC는 anon/authenticated/PUBLIC 실행 권한이 없고 service_role만 호출할 수 있습니다. 서비스 키는 RLS를 우회하므로 각 RPC의 신원·소유권 검사가 핵심 경계입니다. SECURITY DEFINER 함수는 빈 search_path와 완전한 스키마명을 사용합니다.
- 로그인 제한은 IP별 10분 60회·24시간 600회, 코드별 10분 5회, 전체 서비스 10분 600회입니다. 성공·실패 모두 집계하며 실패 시 카운터를 유지합니다. 전체 제한은 분산 시도를 제한하지만 공격 시 정상 입장도 잠시 제한될 수 있습니다. 공유 IP를 쓰는 학급은 실제 사용량을 점검하세요. 학생 API는 세션별 분당 120회, 교사 API는 교사별 분당 60회입니다. Origin 일치, 요청 크기, 허용 입력 필드를 검증합니다. 오류·콘솔에 실제 이름·코드·일지를 출력하지 않습니다.

기존 20자리 코드·해시·세션은 004 적용만으로 변경되지 않으며 만료 전까지 로그인 가능합니다. 20자리 코드를 잘라 8자리로 만들지 않습니다. 교사가 재발급하면 새 8자리 코드가 생성되고 기존 코드와 모든 기존 학생 세션이 폐기됩니다. 재발급 코드는 자신의 현재 코드와 같을 수 없고, 다른 학생에게 발급 중인 코드와도 중복될 수 없습니다. DB 유일 제약이 동시 요청의 최종 방어이며 충돌은 최대 5회 새 난수로 재시도합니다. 이력 전체를 영구 예약하지는 않으므로 이미 교체되어 DB에서 제거된 과거 코드의 영구 재사용 금지를 보장하는 구조는 아닙니다.

운영 배정은 최소 3명의 암호학적 셔플 뒤 전체 단일 순환입니다. 자기 자신·중복·상호 2인쌍·분리 순환을 금지합니다. 배정과 공개는 미리보기/준비 → 5분 단일 사용 확인 토큰으로 확정하는 두 단계입니다. DAY 5 자동 공개는 없습니다.

## 검증 및 운영 점검

`npm.cmd test`, `npm.cmd run test:security`, `npm.cmd run test:browser`, `npm.cmd run build`를 실행합니다. DB 테스트는 PGlite의 실제 PostgreSQL 엔진에 migration과 RLS/권한/트리거/RPC를 적용합니다. 브라우저 테스트는 별도의 HTTPS 서버와 가상 Auth만 사용합니다. 실제 Supabase의 네트워크·Auth·발급 키 검증은 추가로 진행해야 합니다.

실제 운영 전 개발용 가명 학생으로 다중 브라우저 격리·재발급·공개·로그아웃을 확인하세요. 비활성 교사·타 학급 접근을 재확인하고, 만료 세션/확인/요청 제한 행 정리와 학급 기록 보존·삭제 정책을 설정하세요. 개인정보가 요청/응답·오류 수집 로그에 포함되지 않도록 운영 도구 설정도 점검합니다. 자동 정체 공개 예약 작업은 만들지 않습니다.

공식 자료: [키](https://supabase.com/docs/guides/api/api-keys), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [getUser](https://supabase.com/docs/reference/javascript/auth-getuser).
