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

**새로 만든 구성임을 밝힙니다**: 이 과제 시점(5단계)에는 `src/decider.mjs`가 아직 시작 틀 그대로(`starter.deny`, 6단계부터 규칙을 채우는 계약)라서, 그 파일과 `RULE_IDS`는 건드리지 않았습니다. 대신 **별도의 새 부품**(`xdr/brute-force/*`, `src/xdr-login-guard.mjs`, `supabase/xdr_blocklist.local.sql`)을 만들어 기존 로그인 접근 제어(`api/auth/login.mjs`) 앞에 추가 확인 한 단계로 꽂았습니다. 판정기 규칙을 대신하지 않고, 기존 로그인 동작(이메일·비밀번호 검증, 401/400/405/500 응답)은 그대로 보존합니다.

- **경보 읽기** (`xdr/brute-force/read-alerts.mjs`): `xdr/fixtures/brute-force.json`(**합성 시험 자료**, 실제 Wazuh 배포에서 뽑은 게 아님)에서 시각·출발 주소·계정·규칙 수준·설명만 추출합니다. 근거 경보 번호(`id`)는 추출 결과와 분리해 내부 추적용으로만 돌려주고, 원본 경보 건수와 추출 건수가 다르면 예외를 던집니다.
- **패턴** (`xdr/brute-force/patterns.json`): 같은 출발 주소·계정의 반복 실패(MITRE ATT&CK T1110.001), 그 애매한 구간, 같은 출발 주소의 여러 계정 대상 실패(비밀번호 추측 의심, MITRE ATT&CK T1110.003)를 패턴 이름·조건·근거 한 줄로 정리했습니다. 실패 로그만으로 "같은 비밀번호 사용"을 단정하지 않고 의심 신호로만 구분합니다.
- **판단** (`xdr/brute-force/decide.mjs`): `decide(alert)`가 출발 주소별 시간 창(기본 10분) 집계를 관리하며 `{action, confidence, reason}`을 돌려줍니다. confidence ≥0.85 block, ≥0.5 alert, 그 아래 record. 애매한 구간만 `xdr/brute-force/jev-client.mjs`로 Jev에 확신도를 묻고, **이 저장소에는 실제 Jev 주소·키 정보가 없어** `JEV_ENDPOINT`/`JEV_API_KEY` 환경변수가 없으면 호출 자체를 하지 않고 바로 alert 기본값으로 떨어집니다(응답 실패·시간 초과·잘못된 응답도 동일). 실제 Jev 연동이 필요하면 그 주소·키를 Vercel/로컬 환경변수 화면에 직접 넣으세요(이 코드에는 적지 않습니다).
- **차단 연결** (`xdr/brute-force/block-rules.mjs`, `src/xdr-login-guard.mjs`, `supabase/xdr_blocklist.local.sql`): block 판정만 만료 시각·근거 경보 번호가 붙은 임시 거부 규칙으로 올라가고, 같은 출발 주소가 다시 block돼도 규칙이 중복 생성되지 않습니다(근거 번호만 합쳐짐). 알림(block·alert)은 비밀값 없이 `xdr/alerts.log`에 한 줄씩 쌓입니다(`.gitignore` 대상, Git에 올라가지 않음). Vercel의 상태 없는 서버 함수 사이에서도 차단이 유지되도록, 기존 Supabase DB에 새 표 `public.xdr_brute_force_blocklist`를 쓰며(`supabase/xdr_blocklist.local.sql`, 로컬 전용 SQL, 학생이 직접 실행해야 적용됨), `api/auth/login.mjs`가 로그인 시도 전에 `src/xdr-login-guard.mjs`로 이 표를 확인해 403으로 거부합니다. DB 조회가 실패하면 정상 로그인이 막히지 않도록 열어 둡니다(fail-open, 콘솔 오류만 남김).
- **다시 실행하는 방법**: `npm run xdr:run -- brute-force`로 합성 시험 경보를 돌려 `xdr/brute-force/result.json`(block·alert·record 건수, 정상 이벤트 오차단 건수, 차단 만료 검증, 무관 주소 통과 여부)을 갱신합니다. 이번 실행 결과: 전체 25건 중 **block 2·alert 9·record 14**, 정상 이벤트 오차단 **0건**, 만료 검증·무관 주소 통과 모두 **true**.
- **아직 연결되지 않은 부분(정직하게 남김)**: 실제 Wazuh 운영 경보를 이 모듈로 흘려보내는 수집 파이프라인은 없습니다(합성 fixture만 있음). 실제 Jev 엔드포인트도 없어 애매한 경우는 전부 alert 기본값으로 처리됩니다. `supabase/xdr_blocklist.local.sql`을 학생이 Supabase에서 실제로 실행하기 전에는, 로그인 쪽 차단 검사가 DB 조회 실패로 항상 열려 있습니다(fail-open). 이 셋 중 무엇도 "운영 심판 판정"이나 "실제 공격 차단 증거"로 보고하지 않습니다 — `npm run xdr:run`은 합성 자료로 하는 학생 연습입니다.

## 시작 틀의 자동 처리

`vercel.json`은 정적 결과물 `public`을 배포합니다. 빌드 명령 `npm run build`는 Vercel이 제공하는 GitHub 저장소 소유자·이름, 커밋 SHA, 배포 URL을 검증하고 `public/aleph.json`을 생성합니다. 이 값이 없으면 빌드가 실패하므로, 성공한 것처럼 빈 주소를 내보내지 않습니다. `aleph.json`의 내용만으로 저장소 소유권이나 방어 성공을 인정하지 않습니다. 심판이 공개 저장소의 실제 커밋과 배포된 자료를 따로 대조해야 합니다.

`aleph.config.json`의 `repoUrl`과 `publicAppUrl`은 이전 제출 묶음 방식의 자리표시자입니다. 1단계에서는 학생이 편집하지 않습니다. 2단계 이후 코딩 도구가 필요한 설정과 보호 기능을 단계별로 작성합니다. `npm run bundle`과 `bundle-notes.json`도 1단계의 세 걸음에는 포함되지 않습니다.

로컬에서 가상 화면만 확인할 때는 `npm run build -- --local`을 사용합니다. 로컬 실행은 Vercel 배포나 심판 접수를 증명하지 않습니다. 저장소의 `src/attack-check.mjs`는 2단계부터 실제 배포 주소로 `/data.json`(메모가 없어야 함)과 `/api/notes`(아직 비로그인도 허용되는 공개 주소)를 각각 요청해 결과를 기록합니다.

## 다음 단계의 코딩 도구에 전달할 규칙

[AGENTS.md](AGENTS.md)를 먼저 읽히고 한 번에 한 제작 단위만 요청하세요. 2단계부터는 자료 보호를 구현할 때 `public/data.json`을 복사하는 1단계 빌드 흐름도 함께 바꿔야 합니다. 3단계 이후의 로그인, 허용 경로, 5단계의 원본 API 주소, 6단계 이후 정책 규칙은 해당 단계 원고와 계약에 맞춰 추가합니다. 비밀번호·토큰·서버 전용 키·실제 학생 기록을 코드, Git, 제출 묶음에 넣지 않습니다.

`src/decider.mjs`와 `src/detect.mjs`의 로컬 시험은 반 엔진이나 운영 심판의 결과가 아닙니다. 1단계 이후 제출 묶음 계약 `aleph.defense.submission.v2`는 `scripts/bundle.mjs`에 남아 있으며, 코딩 도구가 해당 단계의 최신 배포 주소와 Git 원격을 맞춘 뒤 사용합니다.
