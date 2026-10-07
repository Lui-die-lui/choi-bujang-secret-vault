# BYTE BACK 방어전 시작 틀 R5

이 저장소는 1단계에서 학생 본인이 GitHub 저장소와 Vercel 배포를 만드는 출발점입니다. 포함된 메모 네 건은 가상 자료입니다. 실제 학생 자료, 토큰, 비밀키를 넣지 마세요.

## 지금 작동하는 기능 (5단계 저장점)

- 화면(`/`)에서 이메일·비밀번호로 로그인/로그아웃할 수 있습니다. 로그인·세션 갱신·로그아웃은 전부 서버 함수(`/api/auth/login`·`/api/auth/refresh`·`/api/auth/logout`)가 공식 Supabase SDK로 처리하며, **화면 코드에는 Supabase 프로젝트 URL이나 공개 키가 전혀 없습니다.**
- 로그인해야만 `/api/notes`(2단계 공개 가상 메모 4건, `t02_vault_notes`, 소유자 없는 공용 자료)가 보입니다. 로그아웃하면 화면의 메모도 바로 지워집니다.
- 로그인한 사용자는 "내 메모"에서 **자신의** 가상 메모만 추가·수정·삭제할 수 있습니다. API는 `GET/POST /api/my-notes`, `GET/PUT/DELETE /api/my-notes/:id`이며 `t03_personal_notes` 테이블(`owner_id uuid`)을 씁니다.
- 개인 메모는 **API 쿼리 조건**(`id`+`owner_id`), **DB RLS 정책**(`auth.uid() = owner_id`), 그리고 **anon·authenticated 직접 테이블 권한 회수**(5단계) 세 겹으로 보호됩니다. 브라우저도 서버 함수만 거치고, Supabase Data API에 직접 접속하는 경로는 공개 키로도 로그인 토큰으로도 막혀 있습니다(`t02_vault_notes`는 2단계부터, `t03_personal_notes`는 4~5단계에 걸쳐).
- 모든 자료 API는 `src/verify-login.mjs`(미수정)로 `Authorization: Bearer <토큰>`을 검증합니다. 토큰이 없거나 검증 실패 시 메모 없이 401 JSON 오류를 돌려줍니다.
- `data.json`, `public/data.json`에는 메모가 없습니다(`"notes": []`).
- **다시 실행하는 방법**: 저장소를 받은 뒤 Vercel Environment Variables에 `SUPABASE_URL`, `SUPABASE_SECRET_KEY`를 입력하고, Supabase SQL Editor에서 `supabase/notes_seed.local.sql`, `supabase/personal_notes.local.sql`, `supabase/owner_fixtures.local.sql`(선택, 시험 데이터), `supabase/personal_notes_rls.local.sql`, `supabase/t03_revoke_direct.local.sql`을 순서대로 실행한 뒤 배포합니다. 로컬에서 정적 화면 생성만 확인할 때는 `npm run build -- --local`, 코드 기본 동작 점검은 `npm run test:r5`를 사용합니다(둘 다 실제 Supabase 접속 없이 실행 가능).
- **남은 약점**: `/api/notes`(공용 자료)는 로그인만 확인하고 소유자 개념이 없습니다(의도된 설계, 아래 4단계 절 참고). 과거 공개 커밋·배포 이력의 메모 노출도 해소되지 않았습니다(아래 2단계 절 참고).

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

## 4단계: 로그인해도 내 자료만 보이게 합니다

**제작 1**: `t03_personal_notes`에 A·B의 시험 메모를 준비하는 학습용 SQL을 제안했습니다(`supabase/owner_fixtures.local.sql`, 로컬 전용). 기존 행은 지우거나 소유자를 바꾸지 않고, A의 메모만 2건 추가해 "A 3건·B 1건"을 맞췄습니다. 학생이 직접 검토 후 실행했습니다.

**제작 2**: 개인 메모 API(`GET/PUT/DELETE /api/my-notes/:id`)의 조회·수정·삭제 쿼리에 `id` 조건과 함께 `owner_id = 서버가 검증한 사용자 ID` 조건을 같이 넣었습니다. 남의 메모는 쿼리 결과가 아예 없어 "존재하지 않는 메모"와 구분 없이 **404**로 거부됩니다(존재 여부 자체를 알려주지 않음). 수정 요청 본문은 `{title, body}`만 읽고 `owner_id`는 애초에 읽지 않으므로 소유자 변경 자체가 불가능합니다. 목록 조회(`GET /api/my-notes`)와 생성(`POST /api/my-notes`)은 3단계부터 이미 `owner_id`를 서버 검증 ID로만 다뤘으므로 이번에는 바꾸지 않았습니다. DB 쪽 RLS·GRANT 강화는 다음 제작(제작 3)으로 남겨 두었고, 이번에는 API 코드만 바꿨습니다.

**개인 메모 보호 범위**: `t03_personal_notes`를 쓰는 `/api/my-notes`, `/api/my-notes/:id`(GET/POST/PUT/DELETE 전체)는 모두 요청자 본인 소유 행만 다루도록 쿼리 단에서 제한됩니다.

**제작 3**: 학습 DB `t03_personal_notes`에 최소 권한 SQL을 제안했습니다(`supabase/personal_notes_rls.local.sql`, 로컬 전용). `PUBLIC`·`anon`·`authenticated`의 기존 테이블 권한을 모두 회수한 뒤 `authenticated`에만 SELECT·INSERT·UPDATE·DELETE를 다시 부여하고, RLS 정책 4개(`t03_select_own`/`t03_insert_own`/`t03_update_own`/`t03_delete_own`, 모두 `auth.uid() = owner_id` 기준)를 적용했습니다. `t02_vault_notes`나 `service_role` 권한은 건드리지 않았습니다. 학생이 직접 검토 후 실행했고, 정책 4개가 의도한 대로 생성된 것을 결과로 확인했습니다. 추가로 Supabase REST(`/rest/v1/t03_personal_notes`)를 **anon 키로 직접 호출**해 `42501 permission denied`로 거부되는 것까지 독립적으로 확인했습니다(우리 서버 API를 거치지 않은 DB 직접 접근 검증).

**개인 메모 보호 범위**: `t03_personal_notes`를 쓰는 `/api/my-notes`, `/api/my-notes/:id`(GET/POST/PUT/DELETE 전체)는 API 쿼리 조건과 DB의 RLS 정책, 두 단계에서 모두 본인 소유 행만 다루도록 제한됩니다. anon 키나 authenticated 키로 Supabase Data API를 직접 불러도 같은 제한이 적용됩니다(anon은 권한 자체가 없고, authenticated는 RLS로 본인 행만 보임).

**공용 자료 예외 (확정 아님, 판단 근거만 기록)**: `/api/notes`(`t02_vault_notes`)는 이번 4단계에서 소유자 비교를 적용하지 않았습니다. 이 테이블은 모든 행의 `owner_id`가 처음부터 NULL인 공용 가상 자료이고, 여기에 `auth.uid()=owner_id` 식 검사를 적용하면 조건이 영원히 거짓이 되어 로그인한 누구도 읽을 수 없게 되는 기능 회귀가 생깁니다. 로그인 자체는 3단계부터 이미 요구하고 있어 "비로그인 접근 차단"은 충족된 상태입니다. **다만 이 처리가 과제 요구사항상 허용되는지는 확정된 것이 아니며, 심판 판정이나 다음 단계 지시로 바뀔 수 있는 설계 판단입니다.**

## 5단계: 자료 요청을 서버 한곳으로 모읍니다

**제작 1**: 브라우저 코드가 메모 자료를 Supabase에서 직접 읽거나 고치는 곳이 있는지 확인했습니다 — **없음**. `public/index.html`은 메모 CRUD를 전부 `/api/notes`, `/api/my-notes*` 서버 함수로만 호출하고 있었고, 로그인(Auth) 호출만 `supabase.auth.*`로 클라이언트에서 직접 이뤄지고 있었습니다. 그래서 파일은 바꾸지 않았습니다.

**제작 2**: `t03_personal_notes`의 `PUBLIC`·`anon`·`authenticated` 직접 테이블 권한을 전부 회수하는 SQL을 제안했습니다(`supabase/t03_revoke_direct.local.sql`, 로컬 전용). 이제 이 테이블은 `service_role`(=우리 서버 함수)로만 접근 가능합니다. `service_role` 권한과 RLS 정책, 그리고 서버 함수의 로그인·소유자 검사 코드는 그대로 두었습니다. `aleph.config.json`의 `originalApiUrl`을 쿼리 없는 `t03_personal_notes` REST 주소(`https://iyxvvnrekxthoixcdlht.supabase.co/rest/v1/t03_personal_notes`)로 기록했습니다 — 심판이 anon 키로 직접 두드려볼 "원본 자료" 경로입니다. (`t02_vault_notes`는 2단계부터 이미 `anon`/`authenticated` 직접 권한이 없어 이번 SQL 대상에서 제외했습니다.)

**추가 작업(공개 키 제거 보너스)**: 제작1·2와 별개로, 화면 코드에서 Supabase 공개 키(publishable/anon key)를 완전히 제거했습니다. 로그인·세션 갱신·로그아웃을 새 서버 함수 `api/auth/login.mjs`·`api/auth/refresh.mjs`·`api/auth/logout.mjs`로 옮기고(모두 공식 SDK의 `signInWithPassword`/`refreshSession`/`auth.admin.signOut`만 사용, JWT 직접 생성 없음), 화면은 이 서버 함수들을 `fetch`로 호출하도록 바꿨습니다. 세션은 브라우저의 `sessionStorage`에만 보관됩니다. 세 함수 모두 응답에 `Cache-Control: no-store`를 적용했고, 비밀번호·키·토큰 값은 로그에 남기지 않습니다(에러 로그에는 Supabase가 주는 일반 사유 문구만 기록). **참고**: 로그아웃은 해당 세션의 refresh token을 서버에서 즉시 폐기해 재발급을 막지만, 이미 발급된 access token(JWT, 기본 1시간 수명)은 서명 검증상 자연 만료 전까지 유효할 수 있습니다 — Supabase가 매 요청마다 로그아웃 여부를 실시간으로 대조하지는 않기 때문입니다.

**이번 단계로 막은 길**: 로그인한 사람의 진짜 토큰이나 공개 anon 키로 Supabase Data API(`/rest/v1/...`)를 직접 불러 자료에 접근하던 경로가 `t02_vault_notes`·`t03_personal_notes` 모두에서 막혔습니다. 브라우저도 이제 Auth 호출을 제외하면 우리 서버 함수만 거칩니다.

## 보너스 xdr-01: 무차별 로그인 공격 탐지 (저장점)

**왜 `src/decider.mjs`(ZTNA 판정기)가 아니라 `api/auth/login.mjs`에 연결했는가**: `AGENTS.md`를 다시 정확히 확인했습니다 — "5단계에는 `decider.mjs`를 고치면 안 된다"는 **독립된 금지 문장은 없습니다**. 실제 문장은 "6단계부터 `src/decider.mjs`를 고칠 때는 `docs/DECIDER_REQUEST.md`의 실제 요청·응답 계약을 먼저 읽으세요..."로, 이건 6단계부터 그 파일을 **고칠 때 지켜야 할 절차**(계약 먼저 읽기, 계약에 없는 필드 금지, 함수 모양 유지)를 설명하는 조건문이며, "9단계부터 `src/detect.mjs`를 고칠 때는..." 문장과 같은 구조입니다 — 두 파일이 각각 어느 단계 커리큘럼에 속하는지를 가리킬 뿐, 그 전 단계에서의 수정을 명시적으로 금지하는 별도 조항은 아닙니다. 그래서 이전 설명("금지합니다")은 과장이었고, 이렇게 정정합니다.

다만 연결 지점을 바꿀 필요는 없습니다 — 더 결정적인 이유가 따로 있습니다. `docs/DECIDER_REQUEST.md`가 정의한 요청 계약(18개 필드: `schema`, `requestId`, `classId`, `projectId`, `subjectId`, `deviceId`, `service`, `method`, `path`, `route`, `queryLength`, `querySha256`, `at`, `policyRevision`, `deviceRegistered`, `stepUp`, `recentEvents`, `signals`)에는 **출발 IP를 담는 필드가 아예 없습니다**(`signals.source`는 실제 경로에서 늘 `"none"`). 즉 설령 지금 `decider.mjs`를 고쳐도 되더라도, 이 계약으로는 `decide(request)` 안에서 IP 기반 차단을 구현할 길이 없습니다(계약에 없는 `request.sourceIp` 같은 필드를 임의로 만드는 것은 별도로, 명시적으로 금지되어 있음 — "현재 계약에 없는 `request.device`, `request.identity`, `request.geo`, `request.role`을 만들어 쓰지 마세요"). 또한 `decide()`는 `scripts/decider-test.mjs`·`scripts/fixture-7.mjs`·`scripts/bundle.mjs`(로컬 개발·빌드 스크립트)와 외부 반 엔진에서만 호출되고, 이 저장소의 `api/*.mjs` 어디에서도 호출되지 않습니다 — 이 앱의 실제 요청 처리에는 지금 작동하는 ZTNA 판정기가 없습니다. **로그인 가드(`src/xdr-login-guard.mjs`)는 판정기와 동등하거나 그걸 대신하는 것이 아닙니다** — 판정기가 계약상 볼 수 없는 신호(실제 IP)에 대해서만 작동하는, 로그인 경로 앞에 붙는 좁은 범위의 별도 부품입니다. 과제 자체의 "ZTNA 판정기가 없으면 기존 접근 제어에 연결" 조항이 이 상황(계약상 판정기가 이 신호를 다룰 수 없음)에 해당한다고 보고 이렇게 연결했습니다. 나중에 계약에 관련 필드가 추가되면 판정기 쪽으로 옮기는 게 더 맞습니다.

### 구현된 전체 경로

`decide(alert)` → **로컬·격리된** 임시 거부 규칙(만료 시각·근거 경보 번호 포함, `xdr/brute-force/blocklist.json`) → `api/auth/login.mjs`가 로그인 시도 전에 `src/xdr-login-guard.mjs`로 거부 규칙을 조회해 403으로 거부. 이 전체가 **같은 코드**로 두 가지 저장소(시험용 격리 메모리 표 / 운영 Supabase 표)에 대해 동작합니다 — `src/xdr-login-guard.mjs`가 `store` 인터페이스(`{ isBlocked(sourceIp, nowMs) }`)를 받고, `createMemoryBlocklistStore`(격리된 시험용)와 `createSupabaseBlocklistStore`(운영 Supabase)가 그 인터페이스를 각각 구현합니다.

- **경보 읽기** (`xdr/brute-force/read-alerts.mjs`): `xdr/fixtures/brute-force.json`(**합성 시험 자료**, 실제 Wazuh 배포에서 뽑은 게 아님)에서 시각·출발 주소·계정·규칙 수준·설명만 추출합니다. 근거 경보 번호(`id`)는 추출 결과와 분리해 내부 추적용으로만 돌려주고, 원본 경보 건수와 추출 건수가 다르면 예외를 던집니다.
- **패턴** (`xdr/brute-force/patterns.json`): 같은 출발 주소·계정의 반복 실패(MITRE ATT&CK T1110.001), 그 애매한 구간, 같은 출발 주소의 여러 계정 대상 실패(비밀번호 추측 의심, MITRE ATT&CK T1110.003)를 패턴 이름·조건·근거 한 줄로 정리했습니다. 실패 로그만으로 "같은 비밀번호 사용"을 단정하지 않고 의심 신호로만 구분합니다.
- **판단** (`xdr/brute-force/decide.mjs`): `decide(alert)`가 출발 주소별 시간 창(기본 10분) 집계를 관리하며 `{action, confidence, reason}`을 돌려줍니다. confidence ≥0.85 block, ≥0.5 alert, 그 아래 record. 애매한 구간만 `xdr/brute-force/jev-client.mjs`로 Jev에 확신도를 묻습니다.
- **차단 규칙 생성** (`xdr/brute-force/block-rules.mjs`): block 판정만 만료 시각·근거 경보 번호가 붙은 임시 거부 규칙으로 바뀌어 저장됩니다. 같은 출발 주소가 다시 block돼도 규칙이 중복 생성되지 않습니다(근거 번호만 합쳐짐, 만료 시각은 더 늦은 쪽으로만 늘어남). 알림(block·alert)은 비밀값 없이 `xdr/alerts.log`에 한 줄씩 쌓입니다.
- **요청 처리 쪽 연결** (`src/xdr-login-guard.mjs`): `api/auth/login.mjs`가 로그인 시도 전에 `isSourceBlocked({ store, sourceIp })`를 호출해 403으로 거부합니다. 조회가 실패하면 정상 로그인이 막히지 않도록 열어 둡니다(fail-open, 콘솔 오류만 남김). 운영 저장소는 Vercel의 상태 없는 서버 함수 사이에서도 차단이 유지되도록 기존 Supabase DB의 새 표 `public.xdr_brute_force_blocklist`(`supabase/xdr_blocklist.local.sql`, 로컬 전용 SQL, **학생이 직접 실행해야 적용됨**)를 씁니다.

### 출발 IP를 어떤 헤더로, 왜 그렇게 신뢰하는가 (Vercel 공식 문서 확인함)

[Vercel 공식 문서(Request headers, 2025-12-13 갱신)](https://vercel.com/docs/headers/request-headers)를 직접 확인했습니다. 이전 버전에서는 "클라이언트가 보낸 `x-forwarded-for`의 첫 홉은 위조 가능하니 마지막 홉만 신뢰한다"는 **일반적인 리버스 프록시 관례**로 구현했었는데, 이는 Vercel의 실제 동작과 달랐습니다. 문서의 정확한 문구:

> `x-forwarded-for`: "The public IP address of the client that made the request... If you are trying to use Vercel behind a proxy, we currently **overwrite** the X-Forwarded-For header and **do not forward external IPs**. This restriction is in place to prevent IP spoofing."
> `x-vercel-forwarded-for`: "identical to the x-forwarded-for header. However, x-forwarded-for **could be overwritten if you're using a proxy on top of Vercel**."
> `x-real-ip`: "identical to the x-forwarded-for header."

즉 기본값(Enterprise 전용 "Trusted Proxy" 기능을 쓰지 않는 한, 이 프로젝트는 안 씀)에서는 Vercel이 `x-forwarded-for`를 클라이언트가 보낸 값과 무관하게 실제 연결 IP로 **통째로 덮어씁니다** — 여러 홉이 이어진 체인이 아니라 단일 값입니다. 다만 Vercel **앞에 학생이 나중에 다른 프록시(예: Cloudflare)를 추가**하면 그 프록시가 `x-forwarded-for`를 다시 바꿀 수 있어, 그 경우에도 안 바뀌는 `x-vercel-forwarded-for`를 최우선으로 쓰도록 `extractSourceIp`를 고쳤습니다(우선순위: `x-vercel-forwarded-for` → `x-forwarded-for` → `x-real-ip`, 혹시 쉼표로 이어진 값이 오면 마지막 항목만 — 통상적인 단일 IP 상황에서는 결과가 같음). 이 우선순위 로직 자체는 `npm run xdr:run`의 전체 경로 시험(아래)에서 가짜 요청으로 확인했지만, **실제 Vercel 배포가 보내는 헤더 값을 가지고 검증한 것은 아닙니다** — 배포 후 로그로 직접 확인해 주세요.

### 전체 경로를 격리된 저장소로 자동 시험 (`npm run xdr:run -- brute-force`)

`xdr/brute-force/run.mjs`는 `src/xdr-login-guard.mjs`의 `createMemoryBlocklistStore`로 **이번 실행에서 decide()가 만든 블록 규칙만 담은, 운영 Supabase와 완전히 분리된 메모리 표**를 만들고, `api/auth/login.mjs`가 실제로 호출하는 **같은** `extractSourceIp`·`isSourceBlocked` 함수를 가짜 요청 헤더로 호출합니다. 즉 DB에 수동으로 넣는 시험이 아니라, 로그인 경로가 쓰는 코드 자체를 자동으로 왕복시킵니다. 이번 실행 결과(`xdr/brute-force/result.json`):

- 탐지: 전체 25건 중 **block 2 · alert 9 · record 14**, 정상 이벤트 오차단 **0건**.
- 전체 경로 시험 6건 모두 통과: 명확한 공격 요청 거부, 애매한 시도는 차단하지 않음, 정상 이벤트 주소는 통과, 전혀 무관한 주소는 통과, **만료 이후에는 같은 주소도 통과**, 위조 가능한 `x-forwarded-for`보다 `x-vercel-forwarded-for`를 우선함.

이 결과는 전부 로컬·격리된 저장소 기준이며, 운영 Supabase 표나 실제 배포 요청을 쓰지 않았습니다 — 실제 DB 왕복은 아래 `xdr:sync`가 따로 담당합니다.

### 운영 DB 동기화는 명시적으로 분리된 별도 명령 (`npm run xdr:sync -- brute-force`)

`xdr:run`은 Supabase에 **절대** 쓰지 않습니다(의도적 — 합성 시험 자료가 운영 차단 표에 자동으로 섞여 들어가는 걸 막기 위함). 운영 DB에 손대는 건 오직 `xdr/brute-force/sync.mjs` 하나이며, 플래그 없이는 아무것도 쓰지 않습니다.

- `npm run xdr:sync -- brute-force` (플래그 없음): **미리보기만**. 로컬 `blocklist.json`의 만료되지 않은 항목을 보여주기만 하고 DB에 쓰지 않습니다. (SUPABASE_URL/SUPABASE_SECRET_KEY가 없는 이 세션에서 실행해 확인함 — 안전하게 "환경변수 없음" 안내만 출력됨.)
- `npm run xdr:sync -- brute-force --probe`: **실제 DB 왕복 자체 점검**. 표시용 행 1개(RFC 5737 문서용 주소, 실사용자와 안 겹침)를 운영 표에 넣고 → `src/xdr-login-guard.mjs`의 실제 운영 저장소(`createSupabaseBlocklistStore`)로 조회해 맞게 읽히는지 확인하고 → 그 행을 지웁니다. 끝나면 운영 표에 아무것도 남지 않습니다. **이 세션에는 실제 Supabase 자격 정보가 없어 이 모드를 실행해 확인하지 못했습니다** — 학생이 자신의 `SUPABASE_URL`/`SUPABASE_SECRET_KEY`를 로컬 환경변수에 넣고 직접 실행해야 합니다(이 코드나 대화에는 그 값을 적지 않음).
- `npm run xdr:sync -- brute-force --confirm`: 로컬 `blocklist.json`의 만료되지 않은 항목을 실제로 운영 표에 올립니다. **지금은 쓰지 마세요** — 지금 저장소에는 합성 fixture만 있어, 이 명령을 쓰면 RFC 5737 문서용 주소가 운영 차단 표에 그대로 올라갑니다. 실제 공격 IP를 다룰 수 있게 되기 전까지는 `--probe`만 쓰세요.

### 운영 검증 한눈에 보기

| 항목 | 값 |
|---|---|
| SQL | `supabase/xdr_blocklist.local.sql` (Supabase SQL Editor에서 한 번 실행) |
| 환경변수 | `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (로그인 기능이 이미 쓰는 것과 같은 이름·값, Vercel 환경변수 화면에 직접 입력) |

| 명령 | 하는 일 | 기대 결과 |
|---|---|---|
| `npm run xdr:run -- brute-force` | 로컬·격리 저장소로만 탐지+전체 경로 시험 (Supabase 미접속) | `block 2 · alert 9 · record 14`, 오차단 `0`, 전체 경로 시험 `6건 중 통과 6건` |
| `npm run xdr:sync -- brute-force` | 운영 DB 미리보기만, 아무것도 안 씀 | "미리보기만 합니다(DB에 아무것도 쓰지 않음)" |
| `npm run xdr:sync -- brute-force --probe` | 운영 Supabase에 시험 행 1개 넣고→조회→지움(왕복 자체 점검) | 마지막 줄이 `... true (기대값 true)`, 종료 코드 0 |
| `npm run xdr:sync -- brute-force --confirm` | **지금은 실행하지 않음** — 실행하면 합성 fixture의 RFC 5737 주소가 운영 표에 올라감 | — |

### Jev: 이 저장소에 있는 것과 실제로 필요한 것

이 저장소·`AGENTS.md`·`docs/` 어디에도 "Jev"의 실제 엔드포인트·인증 방식·요청/응답 스키마가 정의되어 있지 않고, `node_modules`·`package-lock.json`에도 관련 패키지가 없습니다(직접 검색해 확인함) — 즉 Jev는 이 스타터 킷에는 존재하지 않는, 과제 설명에만 나오는 외부 서비스입니다. `xdr/brute-force/jev-client.mjs`는 **제가 임의로 가정한 모양**(POST, JSON 본문, `Authorization: Bearer <JEV_API_KEY>`, 응답 `{confidence: 0~1}`)의 자리만 만들어 뒀고, `JEV_ENDPOINT`/`JEV_API_KEY` 환경변수가 없으면 호출 자체를 하지 않고 바로 alert 기본값으로 떨어집니다(응답 실패·시간 초과·잘못된 응답도 동일). **실제 연동에 필요한 것**: (1) 운영 측이 제공하는 실제 Jev 엔드포인트 URL과 (2) 인증 키 — 이 둘은 과제 자료 어디에도 없으므로 먼저 확인이 필요하고, (3) 제가 가정한 요청/응답 모양이 실제 Jev 스펙과 다를 수 있으므로 실제 스펙을 받으면 `jev-client.mjs`의 요청 구성·응답 파싱을 그 스펙에 맞게 다시 고쳐야 합니다. 이번에 검증한 것은 전부 "Jev가 없을 때의 기본값 경로"(alert로 떨어짐)이며, 실제 Jev 응답을 받아 확신도를 반영하는 경로는 전혀 실행해 보지 못했습니다.

### 아직 충족하지 못한 조건 (정직하게 남김)

과제 원문은 Wazuh 수집을 `xdr/fixtures/brute-force.json` **fixture 읽기**로 정의하고 있어(실시간 수집 파이프라인 구축을 요구하지 않음), 그 자체는 미충족 항목이 아닙니다 — 다만 지금 쓰는 fixture는 **합성 자료**이고 실제 Wazuh 배포에서 뽑은 게 아니라는 점은 그대로입니다.

1. 실제 Jev 엔드포인트·키 없음(미응답 경로만 시험됨, 위 "Jev" 절 참고).
2. `npm run xdr:sync -- brute-force --probe`를 실제 Supabase 자격 정보로 실행해 확인한 적 없음(코드는 작성·구문 검사만 했음, 이 세션에는 자격 정보가 없음).
3. 위에서 설계한 전체 경로는 격리된 메모리 저장소로는 자동 검증됐지만, **실제 배포된 Vercel 함수 + 실제 Supabase 표**로의 왕복은 아직 실행해 확인하지 않았습니다.
4. `x-vercel-forwarded-for` 우선순위 로직이 실제 Vercel 요청에서 기대한 값을 주는지는 아직 실제 배포 로그로 확인하지 않았습니다(공식 문서 문구 기준으로만 구현).

이 중 무엇도 "운영 심판 판정"이나 "실제 공격 차단 증거"로 보고하지 않습니다 — `npm run xdr:run`은 격리된 저장소로 하는 로컬 학생 연습이고, `npm run xdr:sync`는 실제 DB에 닿는 별도의 명시적 명령입니다.

## 시작 틀의 자동 처리

`vercel.json`은 정적 결과물 `public`을 배포합니다. 빌드 명령 `npm run build`는 Vercel이 제공하는 GitHub 저장소 소유자·이름, 커밋 SHA, 배포 URL을 검증하고 `public/aleph.json`을 생성합니다. 이 값이 없으면 빌드가 실패하므로, 성공한 것처럼 빈 주소를 내보내지 않습니다. `aleph.json`의 내용만으로 저장소 소유권이나 방어 성공을 인정하지 않습니다. 심판이 공개 저장소의 실제 커밋과 배포된 자료를 따로 대조해야 합니다.

`aleph.config.json`의 `repoUrl`과 `publicAppUrl`은 이전 제출 묶음 방식의 자리표시자입니다. 1단계에서는 학생이 편집하지 않습니다. 2단계 이후 코딩 도구가 필요한 설정과 보호 기능을 단계별로 작성합니다. `npm run bundle`과 `bundle-notes.json`도 1단계의 세 걸음에는 포함되지 않습니다.

로컬에서 가상 화면만 확인할 때는 `npm run build -- --local`을 사용합니다. 로컬 실행은 Vercel 배포나 심판 접수를 증명하지 않습니다. 저장소의 `src/attack-check.mjs`는 2단계부터 실제 배포 주소로 `/data.json`(메모가 없어야 함)과 `/api/notes`(아직 비로그인도 허용되는 공개 주소)를 각각 요청해 결과를 기록합니다.

## 다음 단계의 코딩 도구에 전달할 규칙

[AGENTS.md](AGENTS.md)를 먼저 읽히고 한 번에 한 제작 단위만 요청하세요. 2단계부터는 자료 보호를 구현할 때 `public/data.json`을 복사하는 1단계 빌드 흐름도 함께 바꿔야 합니다. 3단계 이후의 로그인, 허용 경로, 5단계의 원본 API 주소, 6단계 이후 정책 규칙은 해당 단계 원고와 계약에 맞춰 추가합니다. 비밀번호·토큰·서버 전용 키·실제 학생 기록을 코드, Git, 제출 묶음에 넣지 않습니다.

`src/decider.mjs`와 `src/detect.mjs`의 로컬 시험은 반 엔진이나 운영 심판의 결과가 아닙니다. 1단계 이후 제출 묶음 계약 `aleph.defense.submission.v2`는 `scripts/bundle.mjs`에 남아 있으며, 코딩 도구가 해당 단계의 최신 배포 주소와 Git 원격을 맞춘 뒤 사용합니다.
