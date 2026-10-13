# BYTE BACK 방어전 11단계 — 나만의 접속 앱을 완성합니다

가상 메모 자료실입니다. 포함된 자료는 모두 가상 자료이며 실제 학생 자료, 토큰, 비밀키는 넣지 않습니다. 이 문서는 지금 작동하는 기능과 11단계(설치형 웹앱과 기기 승인)를 설명합니다. 1~10단계와 보너스 XDR의 자세한 기록은 [docs/STAGE_NOTES.md](docs/STAGE_NOTES.md)에 있습니다.

## 지금 작동하는 기능 (11단계 저장점)

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
- **다시 실행하는 방법**: 저장소를 받은 뒤 Vercel Environment Variables에 `SUPABASE_URL`, `SUPABASE_SECRET_KEY`를 입력하고, Supabase SQL Editor에서 `supabase/notes_seed.local.sql`, `supabase/personal_notes.local.sql`, `supabase/owner_fixtures.local.sql`(선택, 시험 데이터), `supabase/personal_notes_rls.local.sql`, `supabase/t03_revoke_direct.local.sql`, `docs/sql/t10_note_backups.sql`, `docs/sql/t10_restore_audit.sql`, `docs/sql/t11_devices.sql`을 순서대로 실행한 뒤 배포합니다. 로컬에서 정적 화면 생성만 확인할 때는 `npm run build -- --local`, 코드 기본 동작 점검은 `npm run test:r5`를 사용합니다(둘 다 실제 Supabase 접속 없이 실행 가능).
- **남은 약점**: `/api/notes`(공용 자료)는 로그인만 확인하고 소유자 개념이 없습니다(의도된 설계, docs/STAGE_NOTES.md의 4단계 절 참고). 과거 공개 커밋·배포 이력의 메모 노출도 해소되지 않았습니다(docs/STAGE_NOTES.md의 2단계 절 참고).

## 11단계: 나만의 접속 앱을 완성합니다

지금 배포 중인 자료실 화면을 설치형 웹앱으로 다듬고 기기 승인 흐름을 붙였습니다. 따로 설치하는 접속 프로그램은 없습니다. 앱을 설치했다는 사실은 기기 확인에 쓰지 않습니다.

### 설치형 웹앱 설정 (제작 1)

| 항목 | 값 |
|---|---|
| manifest 경로 | `public/manifest.webmanifest` → 배포 주소의 `/manifest.webmanifest` (`public/index.html`의 `<link rel="manifest">`로 연결) |
| 앱 이름 | `BYTE BACK 자료실` (짧은 이름 `자료실`) |
| 시작 주소·범위 | `/` · `/` |
| 표시 방식 | `standalone` |
| 아이콘 | `public/icon-192.png`, `public/icon-512.png` |

- **오프라인 안내**: 연결이 끊기면 화면 맨 위에 "지금 오프라인입니다. 이 앱은 자료를 기기에 저장하지 않으므로…" 안내가 뜹니다. **오프라인 기능은 구현하지 않았습니다.** manifest는 설치 정보일 뿐이고, 서비스 워커나 자료 캐시가 없어 오프라인에서는 로그인·기기 확인·자료 보기가 모두 되지 않습니다.
- **설치와 기기 확인은 별개입니다**: 화면에도 "이 화면을 홈 화면에 설치해도 기기 확인이 끝난 것은 아닙니다"라고 적었습니다. 설치 여부를 읽거나 서버에 보내는 코드는 없습니다.
- **설치·실행 방법**: 배포 주소를 Chrome·Edge에서 열고 주소창의 설치 단추(또는 메뉴의 "앱 설치")를 누릅니다. 설치하지 않고 브라우저에서 그대로 써도 기능은 같습니다.

### 기기 승인 흐름 (제작 2)

**기기 키는 브라우저 저장소에 없습니다.** 기기의 인증 장치(Windows Hello·Touch ID 등, 웹 표준 패스키)가 키를 만들어 그 안에 보관하고, 화면 코드는 키를 볼 수 없습니다. 서버에는 공개키만 등록부에 올라갑니다. 로그인 토큰과 기기 확인 결과도 페이지 메모리에만 두며 브라우저 저장소(로컬·세션 저장소, 쿠키, 색인 DB)에 넣지 않습니다. 그래서 새로고침하면 다시 로그인합니다(10단계까지 세션 저장소에 두던 로그인 정보 저장을 없앴습니다).

| 순서 | 화면 | 서비스·경로 | 서버가 하는 일 |
|---|---|---|---|
| 1 | 로그인 | `POST /api/auth/login` (기존) | 로그인 확인. 이 시점에는 자료를 요청하지도 받지도 않음 |
| 2 | 「기기 승인」 상태 표시 | `GET /api/device/challenge` | 일회용 질문(2분)과 이 계정이 등록부에 올린 기기 목록·상태를 돌려줌 |
| 3 | 「이 기기 승인 요청」 | `POST /api/device/request` | 기기가 만든 공개키를 등록부(`t11_devices`)에 **`pending`으로만** 추가. 권한은 주지 않음 |
| 4 | (관리자) | Supabase SQL Editor에서 `docs/sql/t11_devices.sql`의 `[승인]` | 화면의 확인 코드와 같은 기기 한 대를 `approved`로 바꿈. **이 앱의 API에는 승인으로 바꾸는 경로가 없음** |
| 5 | 「승인 상태 다시 확인」 | `POST /api/device/verify` | 기기가 질문에 서명한 값을 등록부의 공개키로 검증. `approved`인 기기에만 30분짜리 기기 확인 결과를 줌. `pending`·`revoked`는 서명이 맞아도 받지 못함 |
| 6 | 기존 자료실 화면 | `GET /api/notes`, `/api/my-notes*`, `/api/note-restore/:id` (기존) | 요청마다 기기 확인 결과를 검사하고 **등록부를 다시 조회**한 뒤, 그 결과를 판정기에 넣어 허용일 때만 자료를 조회 |

- **승인 전에는 자료 응답 자체가 없습니다**: 화면에서 숨기는 방식이 아닙니다. 자료 API가 로그인 확인 다음, 자료를 조회하기 전에 `src/device-registry.mjs`의 `requireRegisteredDevice`를 부르고, 허용이 아니면 `403 {"error":"device_not_registered"}`만 돌려줍니다. 비로그인 요청은 전과 같이 401입니다.
- **승인 여부는 서버와 판정기가 정합니다**: 서버가 등록부에서 조회한 승인 상태를 `docs/DECIDER_REQUEST.md`의 요청 모양(18개 이름)에 `deviceRegistered`로 넣어 `src/decider.mjs`의 `decide()`에 보냅니다. 판정기의 6단계 규칙(`device_registered`)이 `allow`를 돌려줄 때만 자료를 조회합니다. 브라우저가 보낸 값으로 `deviceRegistered`를 채우지 않습니다.
- **승인 단추만으로는 권한이 생기지 않습니다**: 승인 요청은 등록부에 대기 행을 추가할 뿐이고, 본문에 `status` 같은 값을 넣어도 읽지 않습니다. 등록부 표 권한도 서버에 조회·추가만 줍니다(수정·삭제 없음).
- **승인을 거두면 바로 닫힙니다**: 등록부 상태를 `revoked`로 바꾸면, 이미 받은 기기 확인 결과로 보낸 다음 요청부터 403입니다.
- **심판 신원 토큰도 같은 규칙입니다**: 기기 확인을 건너뛰는 예외를 두지 않았습니다.
- **학생이 직접 할 일**: Supabase SQL Editor에서 `docs/sql/t11_devices.sql`을 한 번 실행해 등록부 표를 만듭니다. 그 뒤 배포 화면에서 로그인 → 「이 기기 승인 요청」 → SQL의 `[목록]`으로 확인 코드를 대조 → `[승인]` 실행 → 「승인 상태 다시 확인」. **표를 만들기 전에는 기기 등록부 요청이 500으로 실패하고 자료는 열리지 않습니다.**

### 기존 보호 요청과 괴물 사례 (확인한 것과 못 한 것)

| 사례 | 이 앱에서의 처리 | 확인 |
|---|---|---|
| 승인 전(기기 확인 결과 없이) 보호 요청 | 자료 API 8종 모두 `403 device_not_registered`, 저장 내용 변화 없음 | 실행 — `npm run test:device` |
| 승인 요청만 하고 보호 요청 | 등록부 `pending`, 자료 403 | 실행 — `npm run test:device` |
| 등록부에서 승인된 기기의 기존 요청 | 공용 메모·내 메모 목록·한 건 조회가 전과 같은 응답 | 실행 — `npm run test:device` |
| 기존 거부 유지 | 비로그인 401, 남의 기기 확인 결과로 요청 403, B의 A 메모 404(`npm run test:zones`) | 실행 |
| 틀린 서명·다른 앱 주소·서버가 내지 않은 질문·다른 사용자의 기기 | `401 device_not_verified` | 실행 — `npm run test:device` |
| 위조·만료·다른 비밀로 만든 기기 확인 결과 | 403 | 실행 — `npm run test:device` |
| 판정기: 미등록 기기, 알 수 없는 경로, 본문 수정 경로 | `npm run decider:test` 4건, 가상 요청 1,596건 모두 형식에 맞는 응답 | 실행 |
| **괴물: 설치형 앱 서명 없이 보호 요청** | 이 앱에서는 "기기 확인 결과 없는 요청"에 해당하며 403입니다. 운영 엔진의 설치형 앱 서명 검사는 이 저장소에 없습니다 | 위 첫 줄만 실행. 운영 엔진 쪽은 **미실행** |
| **괴물: 서명 뒤 요청 경로를 변경** | 이 앱의 기기 서명은 서버의 일회용 질문에 대한 것이고, 요청마다 경로를 서명하지 않습니다 | **미실행(검증 불가)** |
| **괴물: 서명 뒤 수정 본문을 변경** | 위와 같습니다. 요청 본문을 서명하지 않습니다 | **미실행(검증 불가)** |

- **검증하지 못한 이유**: `docs/DECIDER_REQUEST.md`의 요청 계약에는 서명·경로 서명·본문 해시에 해당하는 이름이 없고(본문 관련은 없음, 쿼리는 길이와 SHA-256만), 설치형 앱의 요청 서명 형식을 정한 자료를 저장소와 원본 시작 틀에서 찾지 못했습니다. 계약 문서는 "학생 코드가 `allow`를 반환해도 엔진의 앞선 신원·기기·경로 검사를 되돌릴 수 없습니다"라고만 적고 있어, 요청 서명 검사는 운영 엔진의 몫으로 보입니다. 요구되지 않은 새 서명 체계를 만들지 않았고, 엔진 서명을 검증했다고 쓰지 않습니다.
- **필요한 계약 변경(있다면)**: 판정기나 서버가 요청 서명을 직접 확인하려면 계약에 ① 서명 검증 결과(또는 서명 값과 공개키 식별값), ② 서명에 포함된 경로·메서드, ③ 서명에 포함된 본문 해시가 있어야 합니다.
- **한계**: 승인 요청 때 인증 장치의 종류를 증명하는 값(attestation)은 검증하지 않습니다. 등록 자체는 권한을 주지 않고, 승인하는 사람이 확인 코드로 기기를 대조합니다. 기기 확인 결과(30분)는 요청 경로·본문에 묶여 있지 않습니다. 실제 브라우저의 패스키 화면과 배포본에서의 흐름은 이 세션에서 실행하지 못했습니다(아래 미실행).

### 100점 추가 조건 확인

| 항목 | 결과 |
|---|---|
| 새로 받은 저장소에서 `npm install` | 실행 — 오류 없이 끝남(패키지 10개 추가, 취약점 0건, `package-lock.json` 변화 없음). 의존성은 `@supabase/supabase-js`, `jose` 두 개 그대로이며 이번 단계에 추가한 패키지는 없습니다 |
| 판정기가 계약의 요청 이름만 읽음 | 실행 — `src/decider.mjs`의 `request.` 이름은 `deviceRegistered`·`subjectId`·`signals`·`recentEvents`·`stepUp`·`route`·`path`·`method`·`queryLength`·`service`·`requestId` 11개로 모두 계약에 있습니다. 계약 밖 값(역할·신원·기기·위치 객체)을 붙여도 결정이 바뀌지 않습니다. `import`가 없어 단독으로 실행됩니다 |
| 모든 가상 요청에 형식 맞는 응답 | 실행 — 메서드 7종 × 경로 12종 × 조건 19종 = 1,596건에서 형식 불일치·예외 0건. 요청이 객체가 아니어도(`null` 등) 예외 없이 다섯 항목의 거부 응답 |
| `ruleIds`가 모두 `RULE_IDS`에 있음 | 실행 — 위 1,596건 전부 확인. `RULE_IDS`는 6개(`starter.deny`, `device_registered`, `step_up_required`, `region_changed`, `note_zone`, `instructor_notice_only`)로 이번 단계에 바뀌지 않았습니다 |
| `aleph.config.json`의 `step` | `11` |

판정기에서 바꾼 것은 두 가지뿐입니다: 설명 주석의 문구 한 줄, 그리고 요청이 객체가 아닐 때 예외 대신 거부 응답을 돌려주는 처리. 규칙과 정상 요청의 응답은 그대로입니다.

### 실행한 시험과 미실행

- **실행(인메모리 대역·가상 요청, 심판 판정 아님)**: `npm run test:device` 5건, `npm run test:zones` 13건, `npm run test:restore` 10건, `npm run test:policy` 4건, `npm run test:r5` 2건, `npm run decider:test` 4건, `npm run detect:test` 6건, `npm run fixture:7`(정상 `allow`, 복합 이상 `step_up`). 기기 시험은 인증 장치를 흉내 낸 시험용 키로 서명을 만듭니다.
- **실행(배포본, 비로그인)**: `npm run bundle`의 직접 점검 — 아래 묶음 결과 참고.
- **미실행**: 배포본에서 실제 인증 장치로 하는 승인 요청→SQL 승인→자료실 열림, 승인 회수 뒤 닫힘, 브라우저의 설치 화면과 오프라인 안내 표시, 브라우저 개발자 도구로 저장소가 비어 있는지 보는 확인. 로그인 계정과 기기의 인증 장치가 필요해 이 세션에서는 할 수 없었습니다.

## 이전 단계 기록

1~10단계 제작 기록(8단계 구역 규칙, 9단계 탐지 규칙, 10단계 정책·메모 복원과 실제 실행 결과 포함)과 보너스 xdr-01·xdr-02의 자세한 내용은 [docs/STAGE_NOTES.md](docs/STAGE_NOTES.md)에 있습니다. 요약은 위 "지금 작동하는 기능"에 있습니다.

## 시작 틀의 자동 처리

`vercel.json`은 정적 결과물 `public`을 배포합니다. 빌드 명령 `npm run build`는 Vercel이 제공하는 GitHub 저장소 소유자·이름, 커밋 SHA, 배포 URL을 검증하고 `public/aleph.json`을 생성합니다. 이 값이 없으면 빌드가 실패하므로, 성공한 것처럼 빈 주소를 내보내지 않습니다. `aleph.json`의 내용만으로 저장소 소유권이나 방어 성공을 인정하지 않습니다. 심판이 공개 저장소의 실제 커밋과 배포된 자료를 따로 대조해야 합니다.

`aleph.config.json`의 `repoUrl`과 `publicAppUrl`은 이전 제출 묶음 방식의 자리표시자입니다. 1단계에서는 학생이 편집하지 않습니다. 2단계 이후 코딩 도구가 필요한 설정과 보호 기능을 단계별로 작성합니다. `npm run bundle`과 `bundle-notes.json`도 1단계의 세 걸음에는 포함되지 않습니다.

로컬에서 가상 화면만 확인할 때는 `npm run build -- --local`을 사용합니다. 로컬 실행은 Vercel 배포나 심판 접수를 증명하지 않습니다. 저장소의 `src/attack-check.mjs`는 2단계부터 실제 배포 주소로 `/data.json`(메모가 없어야 함)과 `/api/notes`(아직 비로그인도 허용되는 공개 주소)를 각각 요청해 결과를 기록합니다.

## 다음 단계의 코딩 도구에 전달할 규칙

[AGENTS.md](AGENTS.md)를 먼저 읽히고 한 번에 한 제작 단위만 요청하세요. 2단계부터는 자료 보호를 구현할 때 `public/data.json`을 복사하는 1단계 빌드 흐름도 함께 바꿔야 합니다. 3단계 이후의 로그인, 허용 경로, 5단계의 원본 API 주소, 6단계 이후 정책 규칙은 해당 단계 원고와 계약에 맞춰 추가합니다. 비밀번호·토큰·서버 전용 키·실제 학생 기록을 코드, Git, 제출 묶음에 넣지 않습니다.

`src/decider.mjs`와 `src/detect.mjs`의 로컬 시험은 반 엔진이나 운영 심판의 결과가 아닙니다. 1단계 이후 제출 묶음 계약 `aleph.defense.submission.v2`는 `scripts/bundle.mjs`에 남아 있으며, 코딩 도구가 해당 단계의 최신 배포 주소와 Git 원격을 맞춘 뒤 사용합니다.
