# Vercel Node 함수의 TypeScript 빌드

`api/backend.ts`와 `server/*.ts`는 개발 중 TypeScript 소스를 직접 import합니다. 프로덕션에서는 Vercel Node 빌더가 이 파일들을 JavaScript로 변환하여 패키징합니다. JavaScript 산출물에 `.ts` import가 그대로 남으면, 패키지에 존재하는 `.js` 파일 대신 없는 `.ts` 파일을 찾다가 `ERR_MODULE_NOT_FOUND`가 발생합니다.

`rewriteRelativeImportExtensions: true`를 루트·서버 TypeScript 설정에 명시하여 상대 `.ts` import를 방출 단계에서 `.js`로 변환합니다. API 가까이에 둔 `api/tsconfig.json`은 서버 설정을 상속하고 NodeNext 모듈 규칙을 적용합니다. 프런트엔드의 Vite/Bundler 설정은 유지합니다. 별도 includeFiles로 원본 TS를 복사하거나 Node의 TypeScript 런타임 지원에 의존하지 않습니다. `tsc`와 Vercel의 TypeScript 컴파일러가 같은 확장자 변환 규칙을 사용합니다.

참고: [Vercel Node.js 런타임](https://vercel.com/docs/functions/runtimes/node-js), [TypeScript rewriteRelativeImportExtensions](https://www.typescriptlang.org/tsconfig/rewriteRelativeImportExtensions.html).

## 검증

`npm.cmd run test:all`에 포함된 `tests/vercel-runtime.test.ts`는 다음을 확인합니다.

- 이전 설정에서는 `.ts` import가 남는 문제 재현
- API의 실제 tsconfig로 서버 모듈 전체를 JS로 방출
- 방출된 파일에 상대 `.ts` import가 남지 않는지 확인
- TypeScript 지원을 끈 별도 Node 프로세스에서 API cold start
- 환경설정 누락 시 안전한 503, 미인증 교사 401, Origin 불일치 403
- 가상 교사 API 및 학생 로그인과 HttpOnly/Secure/SameSite 쿠키 유지

테스트 산출물은 무시된 `.npm-cache/`에 생성하며 웹 정적 `dist/`에 서버 코드를 넣지 않습니다. 테스트는 실제 환경변수 파일을 읽거나 실제 Supabase를 호출하지 않습니다. 실제 학생 로그인·코드 발급·기록 저장·초기화 요청은 프로덕션 검증에 사용하지 않습니다.

배포 후 GitHub의 Vercel 커밋 상태와 프로덕션 `/api/backend`의 안전한 미인증 응답을 함께 확인합니다. 빌드 성공만으로 함수 cold start 성공을 판단하지 않습니다. 인증된 교사 계정으로의 최종 로그인 확인은 별도로 수행합니다.
