# Windows + Chrome: 신뢰할 수 있는 localhost HTTPS

기존 @vitejs/plugin-basic-ssl의 자체 서명 인증서는 Windows가 신뢰하지 않아 NET::ERR_CERT_AUTHORITY_INVALID가 발생합니다. mkcert의 로컬 CA를 Windows에 등록하고, 그 CA가 서명한 **서버용 인증서**를 Vite에서 사용합니다. Chrome 경고 우회나 인증서 검증 해제는 사용하지 않습니다.

## 1. 실행 중인 개발 서버 종료

서버를 실행한 터미널에서 Ctrl+C를 누릅니다. 아래 명령은 **Windows PowerShell**에서 실행합니다. WSL/컨테이너의 별도 인증서 저장소에서 실행하지 않습니다.

## 2. mkcert 설치 (사용자 직접 실행)

현재 점검 시 mkcert는 PATH에서 발견되지 않았고 winget은 사용 가능합니다.

```powershell
winget install --id FiloSottile.mkcert --exact --source winget
```

설치 내용·출처·라이선스를 확인하고 필요한 승인 창을 처리하세요. 설치 후 PowerShell 또는 VS Code 터미널을 새로 열고 확인합니다.

```powershell
mkcert -version
```

패키지를 찾지 못하면 [공식 GitHub Releases](https://github.com/FiloSottile/mkcert/releases)의 Windows용 바이너리를 받아 PATH에 등록하거나 공식 설치 안내의 Chocolatey/Scoop을 사용합니다. 프로젝트에서 임의 바이너리를 자동 다운로드하지 않습니다.

## 3. 로컬 CA를 Windows에서 신뢰하도록 등록 (사용자 승인 필요)

```powershell
mkcert -install
```

이 명령은 개발용 루트 인증기관을 Windows 신뢰 저장소에 등록합니다. 인증서 설치 확인 또는 관리자 승인 창이 뜨면 작업 내용을 확인한 뒤 승인하세요. 권한 오류가 발생하면 **같은 Windows 사용자 계정으로** PowerShell을 관리자 권한으로 열어 재실행합니다. 다른 관리자 계정으로 전환하면 CA 위치·사용자 신뢰가 달라질 수 있습니다.

프로젝트 코드나 이번 작업에서 시스템 신뢰 저장소를 자동 변경하지 않습니다. 학교/회사 정책으로 설치가 금지된 기기라면 관리자에게 허용된 개발 인증서 방식을 요청하세요.

## 4. 이 프로젝트의 서버 인증서 생성

```powershell
Set-Location C:\vscode\manito
New-Item -ItemType Directory -Path .certs -Force | Out-Null
mkcert -cert-file .certs/localhost.pem -key-file .certs/localhost-key.pem localhost 127.0.0.1 ::1
```

서버용 두 파일은 ignored `.certs/`에 생성됩니다. 기존 `_cert.pem` 자체 서명 파일은 선택하지 않으며 삭제할 필요도 없습니다. 같은 이름의 새 인증서를 다시 생성하면 해당 두 파일이 교체되므로 기존 파일을 다른 용도로 사용 중이면 먼저 확인하세요.

**rootCA-key.pem은 공유하거나 프로젝트로 복사하지 않습니다.** CA 파일 위치 확인은 `mkcert -CAROOT`로 가능하지만, Vite에는 루트 인증서/루트 개인 키를 지정하지 않습니다. Vite는 위의 localhost 서버용 인증서와 개인 키만 사용합니다.

## 5. 기존 .env.local 유지

DEV_TLS_CERT_FILE과 DEV_TLS_KEY_FILE이 없거나 둘 다 비어 있으면 프로젝트가 `.certs/localhost.pem`, `.certs/localhost-key.pem`을 자동으로 사용합니다. 이번 수정은 `.env.local`을 변경하지 않습니다.

이미 다른 TLS 경로를 지정했다면 **이 두 경로 설정만** 새 서버 인증서로 맞추세요. Supabase 키·AUTH_PEPPER 등 나머지 값은 그대로 둡니다.

```dotenv
DEV_TLS_CERT_FILE=.certs/localhost.pem
DEV_TLS_KEY_FILE=.certs/localhost-key.pem
```

접속 주소가 아래 주소라면 APP_ORIGIN은 다음과 정확히 같아야 합니다.

```dotenv
APP_ORIGIN=https://localhost:5173
```

호스트·포트·프로토콜이 다른 경우 실제 주소에 맞춥니다. 경로와 끝 `/`는 넣지 않습니다. 인증서에 localhost와 IP가 모두 들어 있어도 앱의 Origin 검사는 별개이므로, APP_ORIGIN이 localhost라면 브라우저에서도 localhost로 접속합니다.

## 6. Chrome 재시작 후 실행

열려 있는 Chrome 작업을 저장한 뒤 모든 Chrome 창을 종료하고 다시 실행합니다. 백그라운드 프로세스가 남아 신뢰 설정이 갱신되지 않으면 Chrome의 완전 종료 또는 Windows 재시작 후 확인합니다.

```powershell
npm.cmd run dev:https
```

**https://localhost:5173**에 접속합니다. 인증서 경고 화면에서 ‘계속 진행’하지 않습니다. 정상적으로 신뢰되면 경고 없이 앱이 열립니다. 주소창의 사이트 정보에서 연결 보안 상태와 인증서를 확인하세요.

포트가 사용 중이면 기존 서버를 종료합니다. 다른 포트를 사용할 경우 실행 포트와 APP_ORIGIN을 함께 맞춥니다.

## 계속 오류가 나면

- AUTHORITY_INVALID: 같은 사용자·같은 Windows 환경에서 `mkcert -install`이 성공했는지 확인하고 Chrome을 완전히 재시작합니다. `certmgr.msc`의 ‘신뢰할 수 있는 루트 인증 기관 → 인증서’에서 mkcert 루트가 있는지 확인합니다. 조직 정책/보안 소프트웨어가 신뢰를 차단하면 관리자에게 확인합니다.
- COMMON_NAME_INVALID: 실제 접속 호스트가 인증서의 SAN에 포함되어야 합니다. 위 인증서는 localhost·127.0.0.1·::1용이며 LAN IP용이 아닙니다.
- 이전 인증서가 보임: 서버를 완전히 재시작하고 DEV_TLS_* 설정이 예전 `_cert.pem`을 가리키는지 확인합니다. Vite는 더 이상 자체 서명 인증서로 자동 대체하지 않습니다.
- 만료/키 불일치: mkcert로 서버용 인증서를 다시 생성합니다. 프로젝트는 잘못된 파일·만료·자체 서명·키 불일치 시 내용을 출력하지 않고 시작을 거부합니다.
- 인증서는 정상인데 API가 403: APP_ORIGIN과 실제 HTTPS 주소를 확인합니다. 쿠키/Origin 검사를 끄지 않습니다.

개인 키는 Git ignore뿐 아니라 Vite 파일 제공 차단 목록에도 추가했습니다. .certs/, .env.local, 인증서 개인 키를 ZIP/GitHub로 공유하지 마세요. 로컬 CA는 개발 PC용이며 실제 배포에는 호스팅 서비스의 공인 TLS를 사용합니다. 이번 작업에는 배포가 포함되지 않습니다.

공식 자료: [mkcert 설치·신뢰 저장소·보안 안내](https://github.com/FiloSottile/mkcert), [Vite HTTPS 설정](https://vite.dev/config/server-options#server-https).
