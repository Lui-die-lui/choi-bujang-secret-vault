# BYTE BACK 방어전 시작 틀 R5

이 저장소는 1단계에서 학생 본인이 GitHub 저장소와 Vercel 배포를 만드는 출발점입니다. 포함된 메모 네 건은 가상 자료입니다. 실제 학생 자료, 토큰, 비밀키를 넣지 마세요.

## 지금 작동하는 기능 (3단계 저장점)

- 화면(`/`)에서 Supabase Auth 이메일·비밀번호로 로그인/로그아웃할 수 있습니다(공식 SDK, 비밀번호·JWT 직접 생성 안 함).
- 로그인해야만 `/api/notes`(2단계 공개 가상 메모 4건, `t02_vault_notes`)가 보입니다. 로그아웃하면 화면의 메모도 바로 지워집니다.
- 로그인한 사용자는 "내 메모"에서 자신의 가상 메모를 추가·수정·삭제할 수 있습니다. API는 `GET/POST /api/my-notes`, `GET/PUT/DELETE /api/my-notes/:id`이며 `t03_personal_notes` 테이블(`owner_id uuid`)을 씁니다.
- 모든 자료 API는 `src/verify-login.mjs`(미수정)로 `Authorization: Bearer <토큰>`을 검증합니다. 토큰이 없거나 검증 실패 시 메모 없이 401 JSON 오류를 돌려줍니다.
- `data.json`, `public/data.json`에는 메모가 없습니다(`"notes": []`).
- **다시 실행하는 방법**: 저장소를 받은 뒤 Vercel Environment Variables에 `SUPABASE_URL`, `SUPABASE_SECRET_KEY`를 입력하고, Supabase SQL Editor에서 `supabase/notes_seed.local.sql`과 `supabase/personal_notes.local.sql`을 순서대로 실행한 뒤 배포합니다. 로컬에서 정적 화면 생성만 확인할 때는 `npm run build -- --local`, 코드 기본 동작 점검은 `npm run test:r5`를 사용합니다(둘 다 실제 Supabase 접속 없이 실행 가능).
- **남은 약점**: `GET/PUT/DELETE /api/my-notes/:id`는 로그인 여부만 확인하고 소유자(`owner_id`) 일치는 검사하지 않습니다 — 로그인한 다른 사용자가 메모 id를 알면 접근할 수 있습니다(4단계 과제). 과거 공개 커밋·배포 이력의 메모 노출도 해소되지 않았습니다(아래 2단계 절 참고).

## 학생이 하는 일: 세 걸음

1. GitHub 계정을 만듭니다.
2. 방어전 1단계 카드의 **Deploy** 버튼을 누릅니다. Vercel에 GitHub로 로그인하고, 새 저장소가 **본인 계정의 Public 저장소**인지 확인한 뒤 Deploy를 누릅니다.
3. 배포가 끝나면 화면에 나온 `https://…vercel.app` 주소를 방어전 1단계 카드에 붙여넣고 제출합니다. 저장소 주소나 설정 파일은 적지 않습니다.

배포가 끝나면 `/`에서 점령된 가상 자료실을 볼 수 있습니다. 1단계 시작 틀에서는 `/data.json`에 같은 가상 메모가 공개되었습니다. 이 공개 상태를 확인하는 것이 1단계의 출발점입니다. 1단계 접수와 심판 판정은 포털에서 확인합니다.

## 2단계: 자료를 코드 밖으로 옮깁니다

가상 메모 네 건은 더 이상 `data.json`/`public/data.json`에 들어있지 않습니다. 학습용 Supabase 테이블 `public.t02_vault_notes`로 옮겼고(`owner_id uuid` 칸은 있지만 `auth.users` 외래키는 걸지 않음, RLS 켜짐, `anon`·`authenticated`에는 SELECT 권한 없음), 화면은 `/api/notes`(Vercel 서버 함수, `api/notes.mjs`)를 통해 같은 네 건을 읽습니다. 이 함수는 서버 전용 환경변수 `SUPABASE_URL`, `SUPABASE_SECRET_KEY`로만 Supabase에 접속하며, 키 값을 응답이나 로그에 포함하지 않습니다. 두 환경변수는 Vercel 프로젝트 설정의 Environment Variables 화면에서 학생이 직접 입력합니다.

**남은 약점**: `/api/notes`는 아직 로그인 여부를 확인하지 않는 공개 주소입니다. 누구나 비로그인으로 호출해 같은 네 건을 읽을 수 있습니다. 이 약점은 3단계 이후 로그인·허용 경로가 추가되기 전까지 남아 있습니다. 또한 이전에 공개되었던 `data.json`의 Git 커밋 이력과 과거 배포 결과물은 지금 지워지지 않았으므로, 과거에 노출된 내용 자체가 해소된 것은 아닙니다.

### 메모 문장 검색 절차와 결과 (2단계)

아래 명령으로 "현재 Git 추적 파일"과 "마지막 커밋(HEAD, 과거 공개 이력)"에서 가상 메모 문장(예: `실습용 가상`, `과제`, `포트폴리오`, `리추얼`, `행정 기록`)을 각각 검색했습니다.

```bash
git ls-files -z | xargs -0 grep -l "실습용 가상\|과제\|포트폴리오\|리추얼\|행정 기록"
git show HEAD:data.json
git show HEAD:public/data.json
```

- **현재 작업본(곧 저장점으로 커밋될 상태)의 Git 추적 파일**: 검색 결과 0건. `data.json`, `public/data.json` 모두 `"notes": []`로 바뀌어 있고, 메모 문장이 들어있는 `supabase/notes_seed.local.sql`은 `.gitignore`(`*.local.sql`)에 걸려 Git 추적 대상이 아님(`git check-ignore -v`로 확인).
- **마지막 실제 커밋 `0f9a3c9`(origin/assignment와 동기화된 과거 공개 커밋)**: `git show HEAD:data.json`, `git show HEAD:public/data.json` 모두 가상 메모 네 건이 그대로 남아 있음을 확인. 즉 이번 저장점으로 새 커밋을 만들어도 **과거 커밋 이력에서는 메모가 지워지지 않습니다.**
- **과거 Vercel 배포 결과물**: 이전에 실제로 Vercel에 배포된 적이 있다면 그 배포본의 `/data.json`에도 같은 메모가 남아 있을 수 있습니다. 이번 작업에서는 실제 배포 주소에 접속해 확인하지 않았으므로 **미확인**으로 남깁니다.
- **지금 배포 기준 확인(미확인)**: 저장점 커밋 이후 실제로 재배포한 주소에서 `/`(카드 4개 정상 표시), `/data.json`(메모 없음), `/api/notes`(네 건 정상 응답, 아직 비로그인도 허용)을 직접 열어 확인하는 절차는 아직 실행하지 않았습니다.

**결론**: 지금 이 저장소의 작업본과 앞으로의 정적 배포에는 메모 문장이 없습니다. 그러나 과거 공개 커밋과 (존재한다면) 과거 배포 이력에 남은 노출은 이번 작업으로 해소되지 않았습니다.

## 3단계: 진짜 로그인을 붙입니다

**제작 1**: 화면에 Supabase Auth 이메일·비밀번호 로그인/로그아웃을 붙였습니다. 공식 SDK(`signInWithPassword`/`signOut`) 흐름만 쓰고 비밀번호나 JWT를 직접 만들지 않습니다.

**제작 2**: `/api/notes`가 `src/verify-login.mjs`(수정하지 않음)로 `Authorization: Bearer <토큰>`을 검증합니다. 토큰이 없거나 검증에 실패하면 메모 없이 **401** `{"error":"unauthorized"}`를 돌려줍니다. 검증에 쓰는 발급자 정보는 `aleph.config.json`의 `identityProvider`(issuer/audience/jwksUrl, 비밀 키 제외)에 기록했습니다.

**제작 3**: 로그인한 사용자가 자신의 가상 메모를 추가·수정·삭제하는 화면과 API를 붙였습니다.
- DB: 기존 `public.t02_vault_notes`(bigint id, 2단계 공개 메모 4건)는 그대로 두고, 새 테이블 `public.t03_personal_notes`(`id uuid`, `owner_id uuid`, `title`, `content`, RLS 켜짐, `anon`/`authenticated` 권한 없음)를 추가했습니다. **실행할 SQL**: `supabase/personal_notes.local.sql`을 Supabase SQL Editor에서 그대로 실행하세요(로컬 전용 파일이라 Git에는 올라가지 않습니다). 기존 테이블·데이터는 건드리지 않습니다.
- API: `GET/POST /api/my-notes`, `GET/PUT/DELETE /api/my-notes/:id`. 응답은 과제 규격 `{id,title,body}`를 따르고, DB 컬럼 `content`를 API의 `body`로 매핑합니다. POST에서 `id`를 생략하면 서버가 UUID를 만들어 `{id}`로 돌려줍니다. 삭제된 메모를 GET하면 404입니다.
- 서버가 `verify-login.mjs`로 검증한 사용자 ID만 `owner_id`로 저장합니다(요청 본문의 `userId`·`role`은 쓰지 않음). 목록 GET(`/api/my-notes`)은 로그인한 사용자 본인의 메모만 돌려줍니다.
- 실제 구현한 경로를 `aleph.config.json`의 `allowedRoutes`에 기록했습니다.

**남은 허점(알면서 아직 안 고침)**: 메모 한 건 조회·수정·삭제(`GET/PUT/DELETE /api/my-notes/:id`)는 로그인 여부만 확인하고, 요청자가 그 메모의 실제 소유자(`owner_id`)인지는 검사하지 않습니다. 즉 로그인한 사용자 B가 사용자 A의 메모 UUID를 알아내면 A의 메모를 읽거나 고치거나 지울 수 있습니다. 이 소유자 검사는 4단계 과제로 남겨 둡니다.

## 시작 틀의 자동 처리

`vercel.json`은 정적 결과물 `public`을 배포합니다. 빌드 명령 `npm run build`는 Vercel이 제공하는 GitHub 저장소 소유자·이름, 커밋 SHA, 배포 URL을 검증하고 `public/aleph.json`을 생성합니다. 이 값이 없으면 빌드가 실패하므로, 성공한 것처럼 빈 주소를 내보내지 않습니다. `aleph.json`의 내용만으로 저장소 소유권이나 방어 성공을 인정하지 않습니다. 심판이 공개 저장소의 실제 커밋과 배포된 자료를 따로 대조해야 합니다.

`aleph.config.json`의 `repoUrl`과 `publicAppUrl`은 이전 제출 묶음 방식의 자리표시자입니다. 1단계에서는 학생이 편집하지 않습니다. 2단계 이후 코딩 도구가 필요한 설정과 보호 기능을 단계별로 작성합니다. `npm run bundle`과 `bundle-notes.json`도 1단계의 세 걸음에는 포함되지 않습니다.

로컬에서 가상 화면만 확인할 때는 `npm run build -- --local`을 사용합니다. 로컬 실행은 Vercel 배포나 심판 접수를 증명하지 않습니다. 저장소의 `src/attack-check.mjs`는 2단계부터 실제 배포 주소로 `/data.json`(메모가 없어야 함)과 `/api/notes`(아직 비로그인도 허용되는 공개 주소)를 각각 요청해 결과를 기록합니다.

## 다음 단계의 코딩 도구에 전달할 규칙

[AGENTS.md](AGENTS.md)를 먼저 읽히고 한 번에 한 제작 단위만 요청하세요. 2단계부터는 자료 보호를 구현할 때 `public/data.json`을 복사하는 1단계 빌드 흐름도 함께 바꿔야 합니다. 3단계 이후의 로그인, 허용 경로, 5단계의 원본 API 주소, 6단계 이후 정책 규칙은 해당 단계 원고와 계약에 맞춰 추가합니다. 비밀번호·토큰·서버 전용 키·실제 학생 기록을 코드, Git, 제출 묶음에 넣지 않습니다.

`src/decider.mjs`와 `src/detect.mjs`의 로컬 시험은 반 엔진이나 운영 심판의 결과가 아닙니다. 1단계 이후 제출 묶음 계약 `aleph.defense.submission.v2`는 `scripts/bundle.mjs`에 남아 있으며, 코딩 도구가 해당 단계의 최신 배포 주소와 Git 원격을 맞춘 뒤 사용합니다.
