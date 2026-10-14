# BYTE BACK 방어전 12단계 — 탈환 작전실을 완성합니다

가상 메모 자료실입니다. 포함된 자료는 모두 가상 자료이며 실제 학생 자료, 토큰, 비밀키는 넣지 않습니다. 이 문서는 지금 작동하는 기능과 12단계(탈환 작전실·신원 회수·검증표), 그리고 구성 요소별 운영 안내를 설명합니다. 1~11단계와 보너스 XDR의 자세한 기록은 [docs/STAGE_NOTES.md](docs/STAGE_NOTES.md)에 있습니다.

## 지금 작동하는 기능 (12단계까지)

- 화면(`/`)에서 이메일·비밀번호로 로그인/로그아웃할 수 있습니다. 로그인·세션 갱신·로그아웃은 전부 서버 함수(`/api/auth/login`·`/api/auth/refresh`·`/api/auth/logout`)가 공식 Supabase SDK로 처리하며, **화면 코드에는 Supabase 프로젝트 URL이나 공개 키가 전혀 없습니다.**
- **11단계**: 화면은 설치형 웹앱(`/manifest.webmanifest`)이고, 로그인한 뒤에도 **서버가 이 기기를 등록 기기로 확인하기 전에는 자료 API가 자료를 주지 않습니다**(403). 기기 승인 요청은 등록부에 대기로만 남고, 승인은 DB에서 따로 하며, 허용 여부는 서버가 등록부를 조회해 판정기에 넣어 정합니다. 기기 키는 기기의 인증 장치(패스키)에만 있고, 로그인 토큰도 브라우저 저장소에 넣지 않습니다. 아래 "11단계" 절 참고.
- 로그인하고 기기 확인까지 끝나야 `/api/notes`(2단계 공개 가상 메모 4건, `t02_vault_notes`, 소유자 없는 공용 자료)가 보입니다. 로그아웃하면 화면의 메모도 바로 지워집니다.
- 로그인한 사용자는 "내 메모"에서 **자신의** 가상 메모만 추가·수정·삭제할 수 있습니다. API는 `GET/POST /api/my-notes`, `GET/PUT/DELETE /api/my-notes/:id`이며 `t03_personal_notes` 테이블(`owner_id uuid`)을 씁니다.
- 개인 메모는 **API 쿼리 조건**(`id`+`owner_id`), **DB RLS 정책**(`auth.uid() = owner_id`), 그리고 **anon·authenticated 직접 테이블 권한 회수**(5단계) 세 겹으로 보호됩니다. 브라우저도 서버 함수만 거치고, Supabase Data API에 직접 접속하는 경로는 공개 키로도 로그인 토큰으로도 막혀 있습니다(`t02_vault_notes`는 2단계부터, `t03_personal_notes`는 4~5단계에 걸쳐).
- 모든 자료 API는 `src/verify-login.mjs`(미수정)로 `Authorization: Bearer <토큰>`을 검증합니다. 토큰이 없거나 검증 실패 시 메모 없이 401 JSON 오류를 돌려줍니다.
- `data.json`, `public/data.json`에는 메모가 없습니다(`"notes": []`).
- **6단계**: `src/decider.mjs`(ALEPH SDP 엔진이 호출하는 ZTNA 판정기)가 "자료실 읽기" 요청(`service: 'notes'`, `method: 'GET'`)에 기기 등록 조건을 겁니다 — `deviceRegistered`가 명시적으로 `true`일 때만 `allow`, 그 외(미등록·값 없음)는 `deny`+`device_not_registered`로 거부합니다. [docs/STAGE_NOTES.md](docs/STAGE_NOTES.md)의 "6단계: 등록한 기기만 자료실에 들어옵니다" 절 참고.
- **7단계**: 같은 판정기가 "평소와 다른 시각 + 처음 보는 네트워크 + 갑작스러운 대량 자료 읽기"가 겹친 가상 접속 사건을 `step_up`(추가 확인)으로 보냅니다. [docs/STAGE_NOTES.md](docs/STAGE_NOTES.md)의 "7단계" 절 참고. 실제 자료 차단·재로그인 후 허용은 **미실행**입니다.
- **8단계**: 판정기가 자료를 구역(자원 ID)으로 나눕니다 — 메모는 `note:<id>`, 강사 공지는 `announcement:<id>`. 알 수 없는 경로·메서드는 거부하고, 강사 공지 수정은 항상 거부합니다(강사 권한을 검증해 주는 계약이 없음). **판정기의 소유자(A/B) 구분은 미구현**이며 남의 메모 차단은 최종 API의 `owner_id` 조건만 맡습니다. [docs/STAGE_NOTES.md](docs/STAGE_NOTES.md)의 "8단계" 절 참고.
- **9단계**: `src/detect.mjs`의 `detect(events)`가 같은 가명 사용자의 `GET` 사건이 10분 안에 120건을 넘을 때만 `propose_revocation`(이유 코드 `burst_read`)을 **제안**합니다. 그 밖에는 `observe`입니다. 실제 회수·권한 변경은 하지 않습니다. [docs/STAGE_NOTES.md](docs/STAGE_NOTES.md)의 "9단계" 절 참고.
- **10단계** ([docs/STAGE_NOTES.md](docs/STAGE_NOTES.md)의 "10단계" 절): `GET /api/note-restore/:id`가 복원할 사본 버전과 바뀔 항목을 먼저 보여 주고(아무것도 쓰지 않음), `POST /api/note-restore/:id`가 비공개 사본(`t10_note_backups`)에서 로그인한 본인의 메모 한 건만 되살립니다(사본을 읽어 ID·소유자·내용 해시를 대조하고 쓰기 직전에 한 번 더 읽어 검증, 하나라도 다르면 중단). 복원 시도는 덧붙이기 전용 감사 기록 표(`t10_restore_audit`)에 한 줄씩 남고, 다른 메모와 전부터 있던 감사 기록은 바꾸지 않습니다. `npm run policy:diff`는 침해 전에 검증한 안전 정책 사본(`policy/safe-policy.json`)과 지금의 시험 정책(`policy/test-policy.json`)의 차이와 복원할 버전을 보여 주고, `npm run policy:restore -- --service notes --confirm`은 지정한 서비스의 규칙만 되돌리며 다른 서비스 규칙과 감사 이력은 보존합니다(사본이 없거나 검증에 실패하면 중단, 운영 판정기 `src/decider.mjs`는 건드리지 않음). **`supabase/t10_note_backups.local.sql`을 실행해야 배포본에서 작동합니다.** 
- **12단계**: 로그인·등록 기기 확인 뒤 열리는 「탈환 작전실」(`GET /api/ops/summary`)이 본인 범위의 판정기 규칙·탐지 사건·신원/기기 회수 상태·복구 기록을 서버에서 읽어 보여 줍니다(코드 정의값·서버 조회값·조회 실패·미연결을 구분, 메모 본문 없음). 회수된 신원(`t12_revoked_identities`)은 로그인·기기 확인 결과가 유효해도 모든 보호·기기 API가 `403 identity_revoked`로 닫히고, 요청마다 서버가 만든 `X-Request-Id`가 접근 사건 기록과 연결됩니다. 아래 "12단계" 절 참고. **`docs/sql/t12_ops.sql`을 먼저 실행해야 배포본이 열립니다.**
- **다시 실행하는 방법**: 저장소를 받은 뒤 Vercel Environment Variables에 `SUPABASE_URL`, `SUPABASE_SECRET_KEY`를 입력하고, Supabase SQL Editor에서 `supabase/notes_seed.local.sql`, `supabase/personal_notes.local.sql`, `supabase/owner_fixtures.local.sql`(선택, 시험 데이터), `supabase/personal_notes_rls.local.sql`, `supabase/t03_revoke_direct.local.sql`, `docs/sql/t10_note_backups.sql`, `docs/sql/t10_restore_audit.sql`, `docs/sql/t11_devices.sql`, `docs/sql/t12_ops.sql`을 순서대로 실행한 뒤 배포합니다. 로컬에서 정적 화면 생성만 확인할 때는 `npm run build -- --local`, 코드 기본 동작 점검은 `npm run test:r5`를 사용합니다(둘 다 실제 Supabase 접속 없이 실행 가능).
- **남은 약점**: `/api/notes`(공용 자료)는 로그인만 확인하고 소유자 개념이 없습니다(의도된 설계, docs/STAGE_NOTES.md의 4단계 절 참고). 과거 공개 커밋·배포 이력의 메모 노출도 해소되지 않았습니다(docs/STAGE_NOTES.md의 2단계 절 참고).

## 12단계: 탈환 작전실을 완성합니다

검사 기준: 11단계 저장점 커밋 `115e297`에 12단계 변경을 더한 작업 트리입니다(커밋 해시는 「12단계 저장점」 커밋 뒤 `git log -1`로 확인). 실제 배포·심판 제출은 하지 않았습니다.

### 구현한 것

| 구성 | 파일 | 하는 일 |
|---|---|---|
| 탈환 작전실 API | `api/ops/summary.mjs` | `GET /api/ops/summary`. 로그인 → 회수 신원 검사 → 등록 기기 확인(다른 자료 API와 같은 관문)을 거친 뒤 **본인 범위**의 판정기 규칙·탐지 사건·신원/기기 회수 상태·복구 사본/복원 기록만 돌려줍니다 |
| 작전실 화면 | `public/index.html`의 「탈환 작전실」 | 위 응답만 표시. 값마다 "코드에 정의된 값 / 서버 조회 결과 / 조회됨·기록 0건 / 조회 실패 / 연결되지 않음"을 구분하고 요청 ID를 보여 줍니다 |
| 신원 회수 등록부 | `src/ops-registry.mjs`, `docs/sql/t12_ops.sql` | 회수된 신원은 로그인·기기 확인 결과가 유효해도 보호 API와 기기 API가 `403 identity_revoked`로 닫힙니다. 등록부를 못 읽으면 `503`으로 닫습니다(fail-closed). 회수·복권은 관리자가 DB에서 하며 이 앱의 API에는 회수를 바꾸는 경로가 없습니다 |
| 접근 사건 기록 | `src/ops-registry.mjs`의 `recordAccess` | 보호 API 관문의 결과(허용/기기 미등록/신원 회수)를 메서드·경로 모양·상태·요청 ID·사용자 번호의 SHA-256 앞 16자리로만 기록합니다. 본문·토큰·쿼리는 없습니다 |
| 요청 ID | `src/request-trace.mjs` | 서버가 요청마다 만든 UUID를 응답 헤더 `X-Request-Id`와 사건 기록에 남깁니다. 배포 플랫폼의 `x-vercel-id`가 있으면 함께 저장합니다. 브라우저가 보낸 값은 쓰지 않습니다 |
| 검증표 | `scripts/ops-verify.mjs`, `docs/OPS_VERIFY.md` | 실제 API 요청의 정상·금지 결과와 수동 절차를 한 표로 만듭니다 |

### 어느 계층이 무엇을 책임지는가

- **판정기(`src/decider.mjs`)**: 계약(`docs/DECIDER_REQUEST.md`)에는 신원 회수·서명 필드가 없습니다. 그래서 판정기는 기기 등록·구역·추가 확인만 판단하며, 회수나 서명 값을 만들어 쓰지 않습니다. 이번 단계에서 판정기 규칙은 바꾸지 않았습니다(`RULE_IDS` 6개 그대로).
- **접속 앱 → 서버 → 판정기 경로(학생 구현)**: 기기의 패스키가 서버의 일회용 질문에 서명 → 서버가 등록부의 공개키로 검증하고 승인 기기에만 30분짜리 **기기 확인 결과(`X-Device-Session`)** 발급 → 보호 요청마다 서버가 이를 검증하고 등록부를 다시 조회해 그 결과를 `deviceRegistered`로 판정기에 넣음. 이 확인 결과가 없는 요청은 변경이든 조회든 자료에 닿지 못합니다. 요청마다 경로·본문을 다시 서명하는 장치는 **없습니다**.
- **신원 회수(학생 구현, 이번 단계)**: 운영 엔진의 사건 전달·회수 집행은 이 저장소에 없습니다. 앱 계층에서 위 등록부로 회수된 신원을 닫습니다. 탐지(`src/detect.mjs`)의 `propose_revocation`은 **제안만** 하며 자동으로 회수를 집행하지 않습니다(정상 사용자를 막는 사고를 피하려는 선택). 작전실에는 `engineDelivery: not_connected`로 표시됩니다.
- **회수된 기기와 회수된 신원은 다릅니다**: 기기 회수(`t11_devices.status='revoked'`)는 그 기기의 확인 결과만 닫고, 같은 계정의 다른 승인 기기는 열립니다. 신원 회수(`t12_revoked_identities`)는 그 계정의 모든 기기·토큰을 닫습니다. 심판 신원 토큰(`kind: judge`)도 같은 관문을 거칩니다.

### 작전실 조회 범위

- 로그인만, 또는 등록 기기 확인만으로 전체 사용자의 기기·감사 기록을 보여 주지 **않습니다**. 호출자 본인의 `owner_id`·사용자 지문과 일치하는 행만 읽습니다(코드: `eq('owner_id', 본인)`).
- 이 앱에는 운영자 역할을 검증해 주는 값이 없어(계약에 `role` 없음) 전체 사용자 범위 조회는 만들지 않았습니다. 필요하면 운영 측이 역할 값을 계약으로 제공한 뒤 별도 경로로 추가해야 합니다.
- 메모 제목·본문, 토큰, 기기 공개키·credential ID, 원본 사용자 번호는 응답에 없습니다. 사본과 메모 ID는 앞 8자리만 표시합니다.

### 검증 결과 (이 작업 트리에서 실제로 실행한 것)

| 구분 | 실행 | 결과 |
|---|---|---|
| `npm run test:device` (인메모리 대역, 심판 판정 아님) | 실행 | 9건 통과: 기존 5건 + 회수된 신원 전 경로 403·복권 뒤 재허용·다른 정상 사용자 허용, 회수 등록부 조회 실패 시 503, 요청 ID 연결, 작전실 범위·민감값 제외·조회 실패 표시 |
| `npm run test:zones`·`test:restore`·`test:policy`·`test:r5` | 실행 | 13·10·4·2건 통과(기존 정상 허용·금지 거부 유지) |
| `npm run ops:verify`의 정적 점검 | 실행 | 판정기가 계약 18개 이름 중 11개만 사용·계약 밖 이름 0개, 가상 요청 1,008건 모두 응답 형식 일치·`ruleIds ⊂ RULE_IDS`, 구역 안 1건 허용·구역 밖 3종 거부(함수 단위) |
| `npm run ops:verify`의 실제 API 시험 | **미실행** | 이 PC의 `.env`에 `SUPABASE_URL`·`SUPABASE_SECRET_KEY`(서버 전용 키)가 없어 로컬 API 서버를 실제 Supabase에 연결하지 못했습니다. 키를 `.env`에 넣고 다시 실행하면 표에 기록됩니다 |
| 승인된 기기가 필요한 흐름(회수된 신원·복구 뒤 변경·타인 메모 404) | **수동 대기** | 패스키 서명은 기기 안에서만 만들어지므로 자동화하지 않았습니다. 절차: [docs/OPS_VERIFY.md](docs/OPS_VERIFY.md) |
| 41종 시험 | **목록·도구 없음** | 저장소·`docs/`에서 41종 목록과 실행 도구를 찾지 못했습니다. 임의로 만들거나 통과로 세지 않았습니다 |
| 공식 심판 판정 | **미제출** | 배포·제출을 하지 않았습니다 |

### 100점 추가 조건 확인

| 항목 | 결과 |
|---|---|
| 별도 체크아웃에서 `npm install` | 실행 — 추적·신규 파일만 빈 폴더에 복사(`node_modules`·`.env` 없음)해 실행, 패키지 10개 추가·오류 0건·`package-lock.json` 변화 없음. 이번 단계에 추가한 패키지 없음 |
| 판정기가 계약의 요청 이름만 읽음 | 실행 — `ops:verify` B-2a: 계약 18개 중 11개 사용, 계약 밖 이름 0개(`request.role`·`identity`·`device` 미사용) |
| 모든 가상 요청에 형식 맞는 응답, `ruleIds ⊂ RULE_IDS` | 실행 — `ops:verify` B-2b: 1,008건 중 불일치 0건 |
| `aleph.config.json`의 `step` | `12` |

### 이번 단계에서 막지 못했거나 확인하지 못한 것

- **심판 괴물 3종(연속 공격)의 공식 판정**은 받지 않았습니다. 위 흐름의 실제 거부 결과는 로컬 API 서버 + 실제 DB 시험(미실행)과 수동 절차로만 남길 수 있습니다.
- **신원 회수의 자동 집행**은 연결하지 않았습니다. 관리자가 DB에서 회수해야 닫힙니다. 운영 엔진의 회수 신호를 이 앱이 받는 경로는 계약·자료에 없어 만들지 않았습니다.
- **서명 뒤 경로·본문 변경**(11단계 괴물)은 이 앱에 요청 단위 서명이 없어 해당 시험을 실행하지 못했습니다.
- `t12_ops.sql`을 실행하기 전에 배포하면 보호 API가 503으로 닫힙니다(fail-closed). 배포 전에 SQL을 먼저 실행해야 합니다.
- 접근 사건은 보호 API 관문의 결과만 담습니다. 최종 응답(404·500 등)이나 비로그인(401) 요청은 사용자를 알 수 없어 기록하지 않습니다.

## 운영 안내 (구성 요소별 설치·실행·중지·복구)

> **ALEPH SDP 엔진 사용**: 요청 신원·기기·경로 확인과 판정기 호출 형식(`aleph.decision.v1`), 검증 계약은 제공 엔진의 몫이며 이 저장소에 코드가 없습니다. 아래에서 **학생 구현**으로 표시한 부분만 학생이 만들었습니다. 제공 엔진의 판정 결과나 운영 반의 사건 전달·회수 집행을 이 저장소가 대신 증명하지 않습니다.

공통 준비: Node 22 이상, `npm install`. 환경변수는 이름과 용도만 적습니다(값은 `.env` 또는 Vercel Environment Variables에만 넣고 Git에 올리지 않습니다).

| 이름 | 용도 |
|---|---|
| `SUPABASE_URL` | 학습 DB 프로젝트 주소(서버 함수 전용) |
| `SUPABASE_SECRET_KEY` | 서버 전용 키. 로그인 검증·DB 접근·기기 확인 결과 봉합에 쓰며 브라우저에 두지 않음 |
| `USER01_EMAIL`·`USER01_PASSWORD`·`USER02_EMAIL`·`USER02_PASSWORD` | 시험용 계정(`npm run ops:verify` 전용, 배포에는 필요 없음) |
| `PASSKEY_USER01` | `.env.example`에 있는 시험 메모용 이름. 이 저장소의 코드는 읽지 않음 |
| `OPS_BASE_URL` | (선택) `ops:verify`가 시험할 서버 주소 |

### 1) 학생 판정기 (`src/decider.mjs`, 학생 구현)

- 설치: 별도 설치 없음(`npm install`). 규칙 이름은 `RULE_IDS`(6개)에 있습니다.
- 실행: 자료 API가 요청마다 `decide()`를 호출합니다(`src/device-registry.mjs`). 로컬 연습은 `npm run decider:test`, `npm run fixture:7`(가상 요청, 심판 판정 아님).
- 중지: 규칙을 끄는 설정은 없습니다. 판정기 호출 실패 시 접근은 열리지 않습니다.
- 복구: `npm run policy:diff`로 안전 정책 사본과 비교, `npm run policy:restore -- --service notes --confirm`으로 지정 서비스 규칙만 복원(시험 정책 `policy/test-policy.json`만 변경, 운영 판정기는 건드리지 않음).
- 결과 확인: `npm run ops:verify`의 B-2a·B-2b·Z 줄(함수 단위).

### 2) 탐지 규칙 (`src/detect.mjs`, 학생 구현)

- 규칙: 같은 가명 사용자의 `GET`이 10분 안에 120건 초과 → `propose_revocation`(이유 `burst_read`). 제안만 하고 집행하지 않습니다.
- 실행: `npm run detect:test`(가상 사건). 실제 사건은 `t12_access_events`에 쌓이며 작전실이 읽는 시점에 `detect()`를 적용해 보여 줍니다.
- 중지·복구: 탐지는 읽기 전용이라 끄거나 되돌릴 상태가 없습니다. 사건 표 정리는 관리자가 SQL로 합니다.
- 결과 확인: 작전실 「탐지 사건」 또는 `GET /api/ops/summary`의 `detection`. 운영 엔진 전달은 `not_connected`입니다.
- XDR 보너스: `npm run xdr:run -- brute-force`(로컬 연습 경보, 심판 판정 아님. 자세한 기록은 `docs/STAGE_NOTES.md`).

### 3) 접속 앱 (`public/index.html`, `api/auth/*`, `api/device/*`, 학생 구현)

- 설치: 배포 주소를 Chrome·Edge에서 열어 「앱 설치」(선택). 설치 여부는 기기 확인에 쓰이지 않습니다.
- 실행: 로그인 → 「이 기기 승인 요청」 → 관리자가 `docs/sql/t11_devices.sql`의 `[승인]` 실행 → 「승인 상태 다시 확인」. 로컬 API 서버는 `npm run ops:serve`(127.0.0.1:3000, 서버 전용 키 필요).
- 중지: 로그아웃(화면 메모리의 토큰·기기 확인 결과 삭제). 접속 차단은 기기 `[회수]` 또는 신원 `[회수]`(`docs/sql/t11_devices.sql`, `docs/sql/t12_ops.sql`).
- 복구: 기기는 다시 승인 요청 → `[승인]`. 신원은 `t12_ops.sql`의 `[복권]`.
- 결과 확인: 작전실 「신원 회수」·「기기 회수 상태」.

### 4) 자료실 (`api/notes.mjs`, `api/my-notes/*`, `api/note-restore/[id].mjs`, 학생 구현)

- 설치: Supabase SQL Editor에서 `supabase/notes_seed.local.sql`, `personal_notes.local.sql`, `personal_notes_rls.local.sql`, `t03_revoke_direct.local.sql`, `docs/sql/t10_note_backups.sql`, `t10_restore_audit.sql`, `t11_devices.sql`, `t12_ops.sql`을 순서대로 실행하고 Vercel에 `SUPABASE_URL`·`SUPABASE_SECRET_KEY`를 설정해 배포합니다.
- 실행: 배포 주소의 화면에서 로그인·기기 확인 뒤 사용합니다. 정적 화면만 확인할 때는 `npm run build -- --local`.
- 중지: 배포를 내리거나, 사용자는 신원 `[회수]`로 접근을 닫습니다. 데이터 표는 지우지 않습니다.
- 복구: 메모 한 건은 `GET`(미리보기) → `POST /api/note-restore/:id`(복원, 감사 기록 한 줄 추가). 복원 시험은 시험용 메모로만 합니다.
- 결과 확인: 작전실 「복구 버전·결과」, `t10_restore_audit`, `npm run test:restore`.

### 검증표 만들기

```
npm run ops:verify        # artifacts/ops-verify.json 과 표를 출력(Git에 올리지 않음)
npm run bundle            # 제출 묶음 artifacts/submission.json (직접 점검 결과 포함, 심판 판정 아님. GET·HEAD 요청만 보내며 쓰기 점검은 not_run)
```

수동 항목과 서버 기록 대조 절차는 [docs/OPS_VERIFY.md](docs/OPS_VERIFY.md)에 있습니다.

## 이전 단계 기록

1~11단계 제작 기록(11단계 접속 앱·기기 승인 상세 포함, 8단계 구역 규칙, 9단계 탐지 규칙, 10단계 정책·메모 복원과 실제 실행 결과 포함)과 보너스 xdr-01·xdr-02의 자세한 내용은 [docs/STAGE_NOTES.md](docs/STAGE_NOTES.md)에 있습니다. 요약은 위 "지금 작동하는 기능"에 있습니다.

## 시작 틀의 자동 처리

`vercel.json`은 정적 결과물 `public`을 배포합니다. 빌드 명령 `npm run build`는 Vercel이 제공하는 GitHub 저장소 소유자·이름, 커밋 SHA, 배포 URL을 검증하고 `public/aleph.json`을 생성합니다. 이 값이 없으면 빌드가 실패하므로, 성공한 것처럼 빈 주소를 내보내지 않습니다. `aleph.json`의 내용만으로 저장소 소유권이나 방어 성공을 인정하지 않습니다. 심판이 공개 저장소의 실제 커밋과 배포된 자료를 따로 대조해야 합니다.

`aleph.config.json`의 `repoUrl`과 `publicAppUrl`은 이전 제출 묶음 방식의 자리표시자입니다. 1단계에서는 학생이 편집하지 않습니다. 2단계 이후 코딩 도구가 필요한 설정과 보호 기능을 단계별로 작성합니다. `npm run bundle`과 `bundle-notes.json`도 1단계의 세 걸음에는 포함되지 않습니다.

로컬에서 가상 화면만 확인할 때는 `npm run build -- --local`을 사용합니다. 로컬 실행은 Vercel 배포나 심판 접수를 증명하지 않습니다. 저장소의 `src/attack-check.mjs`는 2단계부터 실제 배포 주소로 `/data.json`(메모가 없어야 함)과 `/api/notes`(아직 비로그인도 허용되는 공개 주소)를 각각 요청해 결과를 기록합니다.

## 다음 단계의 코딩 도구에 전달할 규칙

[AGENTS.md](AGENTS.md)를 먼저 읽히고 한 번에 한 제작 단위만 요청하세요. 2단계부터는 자료 보호를 구현할 때 `public/data.json`을 복사하는 1단계 빌드 흐름도 함께 바꿔야 합니다. 3단계 이후의 로그인, 허용 경로, 5단계의 원본 API 주소, 6단계 이후 정책 규칙은 해당 단계 원고와 계약에 맞춰 추가합니다. 비밀번호·토큰·서버 전용 키·실제 학생 기록을 코드, Git, 제출 묶음에 넣지 않습니다.

`src/decider.mjs`와 `src/detect.mjs`의 로컬 시험은 반 엔진이나 운영 심판의 결과가 아닙니다. 1단계 이후 제출 묶음 계약 `aleph.defense.submission.v2`는 `scripts/bundle.mjs`에 남아 있으며, 코딩 도구가 해당 단계의 최신 배포 주소와 Git 원격을 맞춘 뒤 사용합니다.
