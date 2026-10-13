# BYTE BACK 방어전 10단계 — 백업에서 자료실을 되살립니다

가상 메모 자료실입니다. 포함된 자료는 모두 가상 자료이며 실제 학생 자료, 토큰, 비밀키는 넣지 않습니다. 이 문서는 지금 작동하는 기능과 10단계(백업에서 되살리기)를 설명합니다. 1~9단계와 보너스 XDR의 자세한 기록은 [docs/STAGE_NOTES.md](docs/STAGE_NOTES.md)에 있습니다.

## 지금 작동하는 기능 (10단계 저장점)

- 화면(`/`)에서 이메일·비밀번호로 로그인/로그아웃할 수 있습니다. 로그인·세션 갱신·로그아웃은 전부 서버 함수(`/api/auth/login`·`/api/auth/refresh`·`/api/auth/logout`)가 공식 Supabase SDK로 처리하며, **화면 코드에는 Supabase 프로젝트 URL이나 공개 키가 전혀 없습니다.**
- 로그인해야만 `/api/notes`(2단계 공개 가상 메모 4건, `t02_vault_notes`, 소유자 없는 공용 자료)가 보입니다. 로그아웃하면 화면의 메모도 바로 지워집니다.
- 로그인한 사용자는 "내 메모"에서 **자신의** 가상 메모만 추가·수정·삭제할 수 있습니다. API는 `GET/POST /api/my-notes`, `GET/PUT/DELETE /api/my-notes/:id`이며 `t03_personal_notes` 테이블(`owner_id uuid`)을 씁니다.
- 개인 메모는 **API 쿼리 조건**(`id`+`owner_id`), **DB RLS 정책**(`auth.uid() = owner_id`), 그리고 **anon·authenticated 직접 테이블 권한 회수**(5단계) 세 겹으로 보호됩니다. 브라우저도 서버 함수만 거치고, Supabase Data API에 직접 접속하는 경로는 공개 키로도 로그인 토큰으로도 막혀 있습니다(`t02_vault_notes`는 2단계부터, `t03_personal_notes`는 4~5단계에 걸쳐).
- 모든 자료 API는 `src/verify-login.mjs`(미수정)로 `Authorization: Bearer <토큰>`을 검증합니다. 토큰이 없거나 검증 실패 시 메모 없이 401 JSON 오류를 돌려줍니다.
- `data.json`, `public/data.json`에는 메모가 없습니다(`"notes": []`).
- **6단계**: `src/decider.mjs`(ALEPH SDP 엔진이 호출하는 ZTNA 판정기)가 "자료실 읽기" 요청(`service: 'notes'`, `method: 'GET'`)에 기기 등록 조건을 겁니다 — `deviceRegistered`가 명시적으로 `true`일 때만 `allow`, 그 외(미등록·값 없음)는 `deny`+`device_not_registered`로 거부합니다. [docs/STAGE_NOTES.md](docs/STAGE_NOTES.md)의 "6단계: 등록한 기기만 자료실에 들어옵니다" 절 참고.
- **7단계**: 같은 판정기가 "평소와 다른 시각 + 처음 보는 네트워크 + 갑작스러운 대량 자료 읽기"가 겹친 가상 접속 사건을 `step_up`(추가 확인)으로 보냅니다. [docs/STAGE_NOTES.md](docs/STAGE_NOTES.md)의 "7단계" 절 참고. 실제 자료 차단·재로그인 후 허용은 **미실행**입니다.
- **8단계**: 판정기가 자료를 구역(자원 ID)으로 나눕니다 — 메모는 `note:<id>`, 강사 공지는 `announcement:<id>`. 알 수 없는 경로·메서드는 거부하고, 강사 공지 수정은 항상 거부합니다(강사 권한을 검증해 주는 계약이 없음). **판정기의 소유자(A/B) 구분은 미구현**이며 남의 메모 차단은 최종 API의 `owner_id` 조건만 맡습니다. [docs/STAGE_NOTES.md](docs/STAGE_NOTES.md)의 "8단계" 절 참고.
- **9단계**: `src/detect.mjs`의 `detect(events)`가 같은 가명 사용자의 `GET` 사건이 10분 안에 120건을 넘을 때만 `propose_revocation`(이유 코드 `burst_read`)을 **제안**합니다. 그 밖에는 `observe`입니다. 실제 회수·권한 변경은 하지 않습니다. [docs/STAGE_NOTES.md](docs/STAGE_NOTES.md)의 "9단계" 절 참고.
- **10단계**: `GET /api/note-restore/:id`가 복원할 사본 버전과 바뀔 항목을 먼저 보여 주고(아무것도 쓰지 않음), `POST /api/note-restore/:id`가 비공개 사본(`t10_note_backups`)에서 로그인한 본인의 메모 한 건만 되살립니다(사본을 읽어 ID·소유자·내용 해시를 대조하고 쓰기 직전에 한 번 더 읽어 검증, 하나라도 다르면 중단). 복원 시도는 덧붙이기 전용 감사 기록 표(`t10_restore_audit`)에 한 줄씩 남고, 다른 메모와 전부터 있던 감사 기록은 바꾸지 않습니다. `npm run policy:diff`는 침해 전에 검증한 안전 정책 사본(`policy/safe-policy.json`)과 지금의 시험 정책(`policy/test-policy.json`)의 차이와 복원할 버전을 보여 주고, `npm run policy:restore -- --service notes --confirm`은 지정한 서비스의 규칙만 되돌리며 다른 서비스 규칙과 감사 이력은 보존합니다(사본이 없거나 검증에 실패하면 중단, 운영 판정기 `src/decider.mjs`는 건드리지 않음). **`supabase/t10_note_backups.local.sql`을 실행해야 배포본에서 작동합니다.** 아래 "10단계" 절 참고.
- **다시 실행하는 방법**: 저장소를 받은 뒤 Vercel Environment Variables에 `SUPABASE_URL`, `SUPABASE_SECRET_KEY`를 입력하고, Supabase SQL Editor에서 `supabase/notes_seed.local.sql`, `supabase/personal_notes.local.sql`, `supabase/owner_fixtures.local.sql`(선택, 시험 데이터), `supabase/personal_notes_rls.local.sql`, `supabase/t03_revoke_direct.local.sql`을 순서대로 실행한 뒤 배포합니다. 로컬에서 정적 화면 생성만 확인할 때는 `npm run build -- --local`, 코드 기본 동작 점검은 `npm run test:r5`를 사용합니다(둘 다 실제 Supabase 접속 없이 실행 가능).
- **남은 약점**: `/api/notes`(공용 자료)는 로그인만 확인하고 소유자 개념이 없습니다(의도된 설계, docs/STAGE_NOTES.md의 4단계 절 참고). 과거 공개 커밋·배포 이력의 메모 노출도 해소되지 않았습니다(docs/STAGE_NOTES.md의 2단계 절 참고).

## 10단계: 백업에서 자료실을 되살립니다

**시작 상태**: 10단계 작업을 시작할 때는 저장소(모든 원격 브랜치 포함)에 정책 사본·메모 사본·감사 기록·백업 검증 방식이 주어져 있지 않았습니다(`aleph.config.json`의 `restoreRoute: null`뿐). 지금은 아래처럼 사본 표·감사 기록 표·정책 사본을 이 단계에서 만들어 쓰고 있습니다. CHECK.md에도 사건 자료는 없습니다. 그래서 이미 있는 구조(자료 API의 로그인·소유자 조건, Git 커밋, `*.local.sql` 관례)만 써서 아래를 새로 만들었습니다. `src/decider.mjs`와 기존 API의 응답은 바꾸지 않았습니다.

### 시험 정책 비교·복원 (제작 1·2)

**세 파일** (모두 `policy/` 폴더, 가상 시험용이며 실제 운영 정책이 아님)

| 파일 | 역할 |
|---|---|
| `policy/test-policy.json` | 지금의 **시험 정책**. 서비스별 규칙(`notes`·`announcements`·`devices`·`stepUp`·`detect`·`noteRestore`)과 감사 이력(`audit`)을 담음 |
| `policy/safe-policy.json` | **침해 전에 검증한 안전 정책 사본**(revision 8, 검증 시각 2026-10-13T15:37:34+09:00, 8단계 저장점 `6666eeb` 기준) |
| `policy/safe-policy.manifest.json` | 사본의 버전과 SHA-256을 사본 파일과 따로 적어 둔 기록 |

- **실제 운영 정책은 건드리지 않습니다**: 이 기능이 쓰는 파일은 `policy/test-policy.json` 하나뿐입니다. 운영 판정기 `src/decider.mjs`, 배포된 앱, 반 엔진의 정책은 읽지도 쓰지도 않습니다. 아래 실제 실행 전후로 `src/decider.mjs`의 SHA-256이 같았습니다.
- **`npm run policy:diff`** (제작 1, 차이만 보여 줌): 저장된 사본을 읽어 SHA-256·버전을 기록과 대조한 뒤, **복원할 버전**(revision·검증 시각)과 **서비스별로 바뀔 규칙 항목**(지금 값 → 사본 값)을 보여 줍니다. 아무것도 쓰지 않습니다.
- **사본이 없거나 검증에 실패하면 중단합니다**: 사본 기록이 없음, 사본 파일이 없음, SHA-256이 기록과 다름, 버전·형식이 기록과 다름 — 어느 경우든 "복원을 중단합니다"로 끝나고(종료 코드 1) 시험 정책을 바꾸지 않습니다.
- **`npm run policy:restore -- --service notes --confirm`** (제작 2, 되돌리기): 먼저 같은 미리보기(복원할 버전과 바뀔 항목)를 보여 준 뒤, `--confirm`이 있을 때만 씁니다. **쓰기 직전에 사본과 시험 정책을 다시 읽어 다시 검증**하고, 미리보기 때와 달라졌으면 중단합니다. `--confirm`이 없으면 미리보기만 합니다.
- **다른 서비스 규칙과 감사 이력은 보존합니다**: 지정한 서비스 하나의 규칙만 사본 값으로 바꿉니다. 다른 서비스 규칙(사본에 없는 `detect`·`noteRestore` 포함)과 이미 있던 감사 이력은 그대로 두고, 감사 이력에는 이번 복원 한 줄(`policy_restored`: 시각·서비스·버전·사본 SHA-256·바뀐 항목)만 덧붙입니다. 쓴 뒤 다시 읽어 "대상 서비스는 사본과 같음, 다른 서비스 규칙 그대로, 이전 감사 이력 그대로"를 확인합니다.

**실제 실행 결과 (2026-10-13, 이 저장소의 `policy/` 파일로 실행)** — 침해를 흉내 낸 시험 정책(메모 규칙 `ownerOnly: false`, `listAll: true`, `methods`에 `DELETE` 추가)에서 시작했습니다.

| 순서 | 명령 | 결과 |
|---|---|---|
| 1 | `npm run policy:diff` | 복원할 버전 revision 8 · 사본 검증 SHA-256 일치 · `notes` 3개 항목이 사본과 다름(`ownerOnly: false → true`, `listAll: true → false`, `methods` 축소) · 다른 서비스는 사본과 같음 · 감사 이력 2줄 · **B의 A 메모 읽기: 허용**(침해 상태) |
| 2 | 사본 기록을 치우고 `policy:restore -- --service notes --confirm` | "사본 기록을 읽지 못했습니다. 복원을 중단합니다." 종료 코드 1, 시험 정책 그대로 |
| 3 | 사본 내용을 바꾸고 같은 명령 | "SHA-256이 기록과 다릅니다(사본 검증 실패). 복원을 중단합니다." 종료 코드 1, 시험 정책 그대로 |
| 4 | 사본 파일을 치우고 같은 명령 | "안전 정책 사본이 없습니다. 복원을 중단합니다." 종료 코드 1, 시험 정책 그대로 |
| 5 | `npm run policy:restore -- --service notes` (확인 없음) | 미리보기만, 아무것도 바꾸지 않음 |
| 6 | `npm run policy:restore -- --service notes --confirm` | `notes` 규칙 3개 항목 복원 · 그대로 둔 서비스 `announcements`·`devices`·`stepUp`·`detect`·`noteRestore` · 감사 이력 한 줄 추가(이전 2줄 보존) · **B의 A 메모 읽기: 거부 / A의 자기 메모 읽기: 허용** |
| 7 | `npm run policy:diff` | 모든 서비스가 사본과 같음 · 감사 이력 3줄 |

- `npm run test:policy`(임시 폴더의 가상 정책, 4건 통과): 미리보기는 쓰지 않음 / 지정한 서비스만 복원하고 다른 서비스 규칙·감사 이력 보존, B의 A 자료 거부·A 정상 허용 / 사본 기록·사본 파일 없음·SHA-256 불일치·버전 불일치·사본에 없는 서비스는 중단 / 미리보기 뒤 사본이나 시험 정책이 바뀌면 중단.
- 여기서 "B의 A 메모 읽기"는 시험 정책의 메모 규칙으로 가상 요청을 판단한 결과입니다. 실제 API에서 B가 A의 메모를 못 읽는 것은 `npm run test:zones`와 자료 API의 소유자 조건이 따로 확인합니다.


### 메모 한 건 복원 — 서비스와 경로 (제작 3)

| 항목 | 값 |
|---|---|
| 서비스 | 이 앱의 Vercel 서버 함수 `api/note-restore/[id].mjs` |
| 복원 경로 | `POST /api/note-restore/:id` (`aleph.config.json`의 `restoreRoute`·`allowedRoutes`, 배포본 `/aleph.json`의 `restoreRoute`에 기록). 본문은 없어도 되고, `{"id"}`를 보내면 경로의 ID와 같아야 함 |
| 미리보기 경로 | `GET /api/note-restore/:id` — 실행 전에 복원할 사본 버전과 바뀔 항목을 보여 줌. 아무것도 쓰지 않음 |
| 로그인 | 다른 자료 API와 같은 `Authorization: Bearer <토큰>` 검증(`src/notes-auth.mjs` → `src/verify-login.mjs`) |
| 감사 기록 | Supabase 표 `public.t10_restore_audit` — 덧붙이기 전용, `service_role`에 SELECT·INSERT만 |
| 사본 | Supabase 표 `public.t10_note_backups`(`note_id`·`owner_id`·`title`·`content`·`content_sha256`), `service_role`만 접근 |
| 미리보기 응답 | `200 {"id","backupVerified":true,"backupVersion":{"createdAt","contentSha256"},"changes":[…],"restored":false}` |
| 복원 응답 | `200 {"id","restored":true,"backupVerified":true,"backupVersion":{…},"changes":[…],"contentSha256","auditRecorded":true}` — 제목·본문은 어느 응답에도 넣지 않음 |
| 바뀔 항목(`changes`) | `title`(제목이 사본과 다름), `body`(본문이 사본과 다름), `recreate_deleted_note`(지워진 메모를 같은 ID·소유자로 다시 만듦), 빈 목록(이미 사본과 같음) |

- **사본이 생기는 때**: 메모를 처음 만들 때(`POST /api/my-notes`) 서버가 한 번 남깁니다. 이후 수정·삭제로는 사본이 바뀌지 않아, 변조된 내용이 사본을 덮어쓰지 않습니다. 사본을 남기지 못해도 메모 추가는 그대로 성공합니다(사유만 기록).
- **복원 순서**: ① 로그인 확인 → ② **저장된 사본을 읽어 검증**: 본인 소유 사본만 읽고(없거나 남의 것이면 404로 중단) 메모 ID·소유자·내용 해시를 대조(다르면 409 `backup_verification_failed`로 중단) → ③ 지금의 메모를 읽고, 같은 ID가 다른 소유자의 행이면 중단(409) → ④ **실행 전에 보여 줄 내용 만들기**: 복원할 사본 버전(사본을 만든 시각·내용 해시)과 바뀔 항목. 미리보기(`GET`)는 여기서 끝나며 아무것도 쓰지 않음 → ⑤ **쓰기 직전에 사본을 다시 읽어 ID·소유자·내용 해시를 한 번 더 검증**(없어졌거나, 검증에 실패하거나, ④에서 본 버전과 달라졌으면 409로 중단하고 아무것도 쓰지 않음) → ⑥ **감사 기록에 `restore_started`를 먼저 덧붙임**(남기지 못하면 중단) → ⑦ 다시 읽은 사본의 내용으로 그 한 행만 수정하거나, 지워졌으면 같은 ID·소유자로 다시 추가 → ⑧ 되살린 행을 읽어 해시가 사본과 같은지 확인 → ⑨ 감사 기록에 `restored`를 덧붙임. 사본 표를 읽지 못하면 500으로 중단합니다.
- **사본이 없거나 검증에 실패하면 복원하지 않습니다**: 위 ②③⑤ 어느 곳에서든 멈추면 메모 표에는 쓰기 요청 자체를 보내지 않습니다(`npm run test:restore`의 "복원 중단" 두 시험과 "미리보기" 시험이 중단·미리보기 뒤 저장 내용이 그대로인지 확인).
- **범위**: 바꾸는 것은 검증된 사용자 본인의 지정한 메모 한 행뿐입니다. 요청 본문은 읽지 않아 대상·소유자·내용을 바꿀 수 없습니다. 다른 메모, 다른 계정 자료, 사본 표, 로그는 건드리지 않습니다. 코드로 "시험 계정 B"만 허용하도록 묶지는 않았고(본인 소유 조건), 확인은 B의 메모로 합니다.
- **내용 해시**: `sha256(<제목 바이트 길이> + ':' + 제목 + 본문)` (`src/note-backup.mjs`의 `contentHash`). SQL의 기존 메모 사본 만들기 식과 같은 모양입니다.
- **감사 기록(덧붙이기 전용)**: Supabase 표 `public.t10_restore_audit`에 복원(`POST`) 시도를 결과와 상관없이 한 줄씩 덧붙입니다(`note_id`·`owner_id`·`outcome`·`reason`·사본 해시·복원 전 해시·복원 후 해시·시각). 성공한 복원은 **쓰기 전에** `restore_started` 한 줄을 먼저 남기고(남기지 못하면 500 `restore_audit_failed`로 멈추고 메모를 바꾸지 않음), 끝난 뒤 `restored` 한 줄을 남깁니다. 사본 없음·검증 실패·남의 메모로 멈춘 시도도 한 줄씩 남습니다. 미리보기(`GET`)는 감사 기록을 포함해 아무것도 쓰지 않습니다. 코드에는 이 표를 고치거나 지우는 요청이 없고, 표 권한도 `service_role`에 SELECT·INSERT만 줍니다(UPDATE·DELETE 없음, `anon`·`authenticated`는 접근 불가). 제목·본문·토큰은 담지 않습니다. 서버 로그에는 기존처럼 `note-restore.preview`·`note-restore.restore` 한 줄(JSON)을 남기며 기존 로그 줄은 바꾸지 않았습니다.
- **복원이 바꾸는 범위**: 메모 표에서는 지정한 한 행, 감사 표에서는 새 줄 추가뿐입니다. 다른 메모·다른 계정 자료·사본 표·전부터 있던 감사 기록·판정기 규칙(`src/decider.mjs`)은 읽기만 하거나 건드리지 않습니다(`npm run test:restore`의 "감사 기록" 시험이 전부터 있던 기록과 다른 메모가 그대로인지 확인).
- **표 정의는 저장소에 있습니다**: `docs/sql/t10_note_backups.sql`(사본 표·권한·기존 메모 사본 만들기), `docs/sql/t10_restore_audit.sql`(감사 표·덧붙이기 전용 권한), `docs/sql/t10_restore_check.sql`(복원 뒤 읽기 전용 확인: 복원한 한 건의 ID·소유자·내용 해시가 사본과 같은지, 사본 해시 불일치 수, 그 메모의 감사 기록, 감사·메모 전체 건수). 세 파일 모두 메모 내용이나 비밀값이 없습니다. `supabase/*.local.sql`은 같은 내용의 로컬 사본입니다.
- **감사 표 준비(2026-10-13 실행함)**: 학생이 Supabase SQL Editor에서 `supabase/t10_restore_audit.local.sql`을 실행했습니다(로컬 전용 파일, Git 미포함). 공개 키로 이 표를 직접 조회하거나 줄을 추가하면 둘 다 `42501 permission denied`(HTTP 401)로 거부되는 것을 확인했습니다. 새 프로젝트에서는 이 SQL을 실행하기 전까지 복원 요청이 500 `restore_audit_failed`로 중단됩니다(메모는 바뀌지 않음).
- **사본 표 준비(2026-10-13 실행함)**: 학생이 Supabase SQL Editor에서 `supabase/t10_note_backups.local.sql`을 실행했습니다(로컬 전용 파일, Git 미포함). 표를 만들고 권한을 닫은 뒤, 그때 있던 메모의 사본을 한 번 만듭니다. 공개 키로 이 표를 직접 조회하면 `42501 permission denied`(HTTP 401)로 거부되는 것을 확인했습니다(없는 표 이름은 404). 새 프로젝트에서는 이 SQL을 실행하기 전까지 복원 요청이 500 `backup_unavailable`로 중단됩니다.
- **알려진 한계**: 사본은 처음 만든 내용이라, 복원하면 그 뒤의 정상 수정도 함께 되돌아갑니다. `restoreRoute`의 표기(`POST /api/note-restore/:id`)는 `allowedRoutes`와 같은 모양으로 적은 제 판단이며, 심판이 기대하는 형식·응답 모양에 대한 공식 자료는 찾지 못했습니다.

### 배포본에서 실제로 복원한 기록 (2026-10-13, 학생 실행)

배포 주소(커밋 `8fea91f`)에 학생이 시험 계정으로 로그인해 브라우저에서 아래 순서를 실제로 보냈습니다. 그때의 복원 경로는 `POST /api/my-notes/<id>/restore`였고, 이후 같은 처리를 `POST /api/note-restore/<id>`로 옮겼습니다(아래 "대응" 참고). 대상은 이 시험을 위해 방금 만든 가상 메모 한 건이며, 끝난 뒤 지웠습니다.

| 순서 | 요청 | 결과 |
|---|---|---|
| 1 | `POST /api/my-notes` (가상 메모 추가 — 이때 서버가 사본을 남김) | 201 |
| 2 | `PUT /api/my-notes/<id>` (내용 변조) | 200 |
| 3 | `POST /api/my-notes/<id>/restore` | 200 `restored` |
| 4 | `GET /api/my-notes/<id>` | 200, 본문이 처음 내용과 같음 |
| 5 | `DELETE /api/my-notes/<id>` (삭제) | 204 |
| 6 | `POST /api/my-notes/<id>/restore` | 200 `restored` |
| 7 | `GET /api/my-notes/<id>` | 200, 같은 ID로 다시 보이고 본문이 처음 내용과 같음 |
| 8 | `DELETE /api/my-notes/<id>` (시험 메모 정리) | 204 |

- 같은 순서를 두 번 실행했고(서로 다른 메모 ID) 두 번 모두 같은 결과였습니다. Vercel 로그에도 `my-notes.restore` / `outcome: restored` 줄이 요청마다 남았습니다(제목·본문·토큰 없음).
- **이 기록의 범위**: 위 실행은 "쓰기 직전 사본 재검증"(복원 순서 ⑤)과 미리보기, 경로 변경을 넣기 전 배포본에서 한 것입니다. 지금 경로(`/api/note-restore/<id>`)의 배포본에서 하는 미리보기·복원 재실행, 계정 A·B 두 개로 한 교차 확인(B가 A의 메모 ID로 복원 요청 → 404), SQL로 메모 표와 사본 표의 해시를 직접 대조하는 확인은 **미실행**입니다. 교차 거부와 재검증 중단은 `npm run test:restore`(인메모리 대역)로만 확인했습니다.

### 10단계 제출 경과

- 커밋 `66f010b`부터 여러 번 제출하며 고쳤습니다: 복원 경로를 `:id`가 끝에 오는 `POST /api/note-restore/:id`로 옮김 → 미리보기(`GET`)와 쓰기 직전 사본 재검증 추가 → 덧붙이기 전용 감사 기록 표 추가 → 표 정의를 `docs/sql/`에 올림 → 정책 복원을 운영 판정기와 분리된 시험 정책(`policy/`) 대상으로 다시 만듦.
- 마지막 변경의 이유: 처음에는 "시험 정책"을 운영 판정기 파일(`src/decider.mjs`)로 해석해 그 파일을 통째로 되돌리는 스크립트를 만들었습니다. 이는 "실제 운영 정책은 건드리지 않는다", "다른 서비스 규칙과 감사 이력은 보존한다"는 요구와 맞지 않아, 위 "시험 정책 비교·복원"처럼 고쳤습니다. 이전 스크립트와 `backup/policy-safe.json`은 없앴습니다.
- 학생이 본 Vercel 로그에는 심판 토큰으로 온 복원 요청이 보이지 않았습니다. 심판의 판정 방식에 대한 공식 자료는 찾지 못했습니다.

### 복구 뒤 다시 확인하는 순서 (1~9단계)

아래 순서대로 실행합니다. "이번 실행"은 이 저장점에서 실제로 돌린 결과입니다.

| 순서 | 확인 | 명령·요청 | 정상 결과 / 거부되어야 할 결과 | 이번 실행 |
|---|---|---|---|---|
| 1 | 정책 사본 검증·차이 | `npm run policy:diff`, `npm run test:policy` | "SHA-256 일치", 모든 서비스 "사본과 같음", B의 A 메모 읽기 거부 / 사본이 없거나 바뀌면 중단 | 실행 — 일치, 모두 사본과 같음, 거부·허용 확인, 시험 4건 통과 |
| 2 | 메모 복원(대역) | `npm run test:restore` | 10건 통과(미리보기는 아무것도 쓰지 않음, 본문 id 불일치 중단, 감사 기록 덧붙이기·보존, 감사 기록 실패 시 복원 안 함 포함): B의 변조·삭제 메모가 사본과 같은 ID·소유자·해시로 복원 / 사본 없음·해시 불일치·남의 메모·비로그인은 중단, 쓰기 직전 사본이 바뀌었거나 없어지면 중단 | 실행 — 10건 통과 |
| 3 | 1~2단계 공개 자료 | `npm run bundle`의 직접 점검(`/data.json`) | 메모 0건 | 실행 — 아래 묶음 결과 참고 |
| 4 | 3~5단계 로그인·직접 접근 | `npm run bundle`의 직접 점검 | 비로그인 `/api/notes`·`/api/my-notes` 401, anon 키 직접 조회·추가 401 | 실행 — 아래 묶음 결과 참고 |
| 5 | 4·8단계 소유자·구역 | `npm run test:zones` | 13건 통과: A 자기 메모 허용 / B의 A 메모 404, 목록 경로·공지 쓰기 거부 | 실행 — 13건 통과 |
| 6 | 6·7단계 기기·추가 확인 | `npm run decider:test`, `npm run fixture:7` | 정상 `allow` / 미등록 `deny`, 복합 이상 `step_up` | 실행 — 4건 통과, `allow`·`step_up` |
| 7 | 9단계 탐지 | `npm run detect:test` | 30건·120건 `observe` / 121건·200건 `propose_revocation` | 실행 — 6건 통과 |
| 8 | 기본 동작 | `npm run test:r5` | 2 pass | 실행 — 2 pass |
| 9 | 배포본에서 B의 메모 변조→복원 | B로 로그인해 메모 추가 → 수정 → `GET /api/note-restore/<id>`(미리보기) → `POST /api/note-restore/<id>` → 조회 | 처음 내용으로 돌아옴 / A의 ID로 복원 요청은 404 | 실행(2026-10-13, 학생, 이전 경로 `/api/my-notes/<id>/restore`) — 복원 200, 처음 내용과 같음. 지금 경로에서의 재실행과 A의 ID로 한 교차 요청은 **미실행** |
| 10 | 배포본에서 B의 메모 삭제→복원 | 삭제 → 복원 → 조회 | 같은 ID로 다시 보임 | 실행(2026-10-13, 학생, 이전 경로) — 복원 200, 같은 ID로 다시 보이고 처음 내용과 같음. 지금 경로에서의 재실행은 **미실행** |
| 11 | 배포본 화면 | 로그인 → "내 메모" 추가·수정·삭제 | 기존대로 작동 | **미실행** |

**정책 복원 실제 실행 결과**는 위 "시험 정책 비교·복원"의 표에 있습니다.

위 결과는 로컬 가상 요청·인메모리 대역 시험이며 실제 DB 복원이나 심판 통과의 증거가 아닙니다.

## 이전 단계 기록

1~9단계 제작 기록, 8단계 구역 규칙 표와 판정 경과, 9단계 탐지 규칙, 보너스 xdr-01·xdr-02의 자세한 내용은 [docs/STAGE_NOTES.md](docs/STAGE_NOTES.md)로 옮겼습니다(내용은 그대로). 요약은 위 "지금 작동하는 기능"에 있습니다.

## 시작 틀의 자동 처리

`vercel.json`은 정적 결과물 `public`을 배포합니다. 빌드 명령 `npm run build`는 Vercel이 제공하는 GitHub 저장소 소유자·이름, 커밋 SHA, 배포 URL을 검증하고 `public/aleph.json`을 생성합니다. 이 값이 없으면 빌드가 실패하므로, 성공한 것처럼 빈 주소를 내보내지 않습니다. `aleph.json`의 내용만으로 저장소 소유권이나 방어 성공을 인정하지 않습니다. 심판이 공개 저장소의 실제 커밋과 배포된 자료를 따로 대조해야 합니다.

`aleph.config.json`의 `repoUrl`과 `publicAppUrl`은 이전 제출 묶음 방식의 자리표시자입니다. 1단계에서는 학생이 편집하지 않습니다. 2단계 이후 코딩 도구가 필요한 설정과 보호 기능을 단계별로 작성합니다. `npm run bundle`과 `bundle-notes.json`도 1단계의 세 걸음에는 포함되지 않습니다.

로컬에서 가상 화면만 확인할 때는 `npm run build -- --local`을 사용합니다. 로컬 실행은 Vercel 배포나 심판 접수를 증명하지 않습니다. 저장소의 `src/attack-check.mjs`는 2단계부터 실제 배포 주소로 `/data.json`(메모가 없어야 함)과 `/api/notes`(아직 비로그인도 허용되는 공개 주소)를 각각 요청해 결과를 기록합니다.

## 다음 단계의 코딩 도구에 전달할 규칙

[AGENTS.md](AGENTS.md)를 먼저 읽히고 한 번에 한 제작 단위만 요청하세요. 2단계부터는 자료 보호를 구현할 때 `public/data.json`을 복사하는 1단계 빌드 흐름도 함께 바꿔야 합니다. 3단계 이후의 로그인, 허용 경로, 5단계의 원본 API 주소, 6단계 이후 정책 규칙은 해당 단계 원고와 계약에 맞춰 추가합니다. 비밀번호·토큰·서버 전용 키·실제 학생 기록을 코드, Git, 제출 묶음에 넣지 않습니다.

`src/decider.mjs`와 `src/detect.mjs`의 로컬 시험은 반 엔진이나 운영 심판의 결과가 아닙니다. 1단계 이후 제출 묶음 계약 `aleph.defense.submission.v2`는 `scripts/bundle.mjs`에 남아 있으며, 코딩 도구가 해당 단계의 최신 배포 주소와 Git 원격을 맞춘 뒤 사용합니다.
