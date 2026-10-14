// The student changes this check as each stage adds an attack to the same app.
// Never return tokens, private keys, real names, or note bodies.

// public.t03_personal_notes의 RLS/권한을 anon 키로 직접 확인하는 용도입니다.
// publishable/anon 키는 공개용이라(과거 public/index.html에도 같은 값이 있었음) 비밀값이 아닙니다.
const SUPABASE_ANON_KEY = 'sb_publishable_T6veZAYIlx2HYpfPOTJ50g_yXVERRoW';

// 공개 정적 파일·브라우저 묶음에 섞여 있으면 안 되는 서버 전용 키 패턴입니다.
const SECRET_KEY_PATTERN = /sb_secret_[A-Za-z0-9_-]{12,}/u;

export async function runAttackChecks(config) {
  // 6단계: src/decider.mjs의 기기 등록 규칙은 반 엔진만 호출하고 이 앱의
  // api/*.mjs 어디서도 decide()를 부르지 않아(이전 단계부터 동일), 실제 HTTP
  // 요청으로 새로 점검할 길이 없습니다. 5단계부터의 보호(로그인·소유자·직접
  // 접근 차단)는 이번 단계에서 안 바뀌었으니 같은 점검을 그대로 재사용합니다.
  // 8단계: 자원 구역 규칙(note_zone, instructor_notice_only)도 판정기 가상 요청과
  // test/zones.test.mjs의 인메모리 대역으로만 확인합니다(실제 A/B 계정 API 실측은 미실행).
  // 7단계: 복합 이상 접속 규칙(step_up_required)도 같은 이유로 실제 HTTP로 점검할
  // 길이 없어 가상 사건 연습(npm run decider:test, fixture:7)으로만 확인합니다.
  // 9단계: 탐지 규칙(burst_read)과 회수 제안은 src/detect.mjs가 결과만 돌려주고 이 앱의
  // api/*.mjs가 호출하지 않아 실제 HTTP로 점검할 길이 없습니다(npm run detect:test 가상
  // 사건 연습만 실행, 운영 엔진의 사건 전달·회수는 미실행).
  // 12단계 보완: 심판의 격리 환경은 제출 묶음이 GET·HEAD 요청만 보내도록 허용합니다
  // (S12_BUNDLE_UNSUPPORTED). 그래서 이 점검은 POST·PUT 등 쓰기 요청을 보내지 않습니다.
  // 쓰기 요청이 필요한 점검(복원 실행, 원본 API 직접 추가)은 observed를 not_run으로 남깁니다.
  // 10단계: 복원 경로(GET /api/note-restore/:id 미리보기)는 비로그인 거부만 실제 HTTP로
  // 점검합니다. 시험 계정 B의 변조·삭제 뒤 복원은 이 점검에 계정 토큰을 넣지 않으므로
  // 미실행입니다(npm run test:restore 인메모리 대역으로만 확인).
  // 11단계: 기기 승인 등록부 경로(GET /api/device/challenge)는 비로그인 거부만 실제 HTTP로
  // 점검합니다. 로그인한 요청의 기기 확인(승인 전 403, 승인 뒤 정상)은 이 점검에 계정 토큰과
  // 기기의 인증 장치가 없어 미실행입니다(npm run test:device 인메모리 대역으로만 확인).
  if (![5, 6, 7, 8, 9, 10, 11, 12].includes(config.step)) throw new Error('이 단계의 공격 점검을 src/attack-check.mjs에 구현해 주세요.');
  let app;
  try {
    app = new URL(config.publicAppUrl);
  } catch {
    throw new Error('aleph.config.json의 실제 배포 주소를 먼저 넣어 주세요.');
  }
  if (app.protocol !== 'https:' || app.username || app.password || app.search || app.hash
      || app.pathname !== '/' || app.hostname.endsWith('.example')) {
    throw new Error('aleph.config.json의 실제 배포 주소를 먼저 넣어 주세요.');
  }

  // 12단계 보완(S12_ATTACK_RECORD): 점검 하나당 요청 하나를 이 순서대로 보내고, 그 요청의 결과만으로
  // 같은 순서의 attackId 결과를 만듭니다. 요청을 보내지 않은 점검(not_run)은 마지막에 둡니다.
  // 요청은 모두 GET이며, 응답 본문은 메모가 있는지 여부만 보고 기록하지 않습니다.
  const attempts = [];
  const get = (url, init = {}) => fetch(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(10000), ...init });

  // 1) 공개 정적 파일에 가상 메모가 보이는지
  const dataResponse = await get(new URL('/data.json', app));
  let dataNoteCount = null;
  if (dataResponse.ok) {
    try {
      const data = await dataResponse.json();
      dataNoteCount = Array.isArray(data?.notes) ? data.notes.length : null;
    } catch {
      // A non-JSON response carries no notes either.
    }
  }
  const dataLeaked = (dataNoteCount ?? 0) > 0;
  attempts.push({
    attackId: 'public_data_json_note_leak',
    expected: '비로그인 /data.json 요청에 가상 메모가 보이면 안 됨',
    observed: dataLeaked
      ? `비로그인 요청에서 메모가 보임 (HTTP ${dataResponse.status}, notes 길이 ${dataNoteCount})`
      : `비로그인 요청에서 메모가 보이지 않음 (HTTP ${dataResponse.status}, notes 길이 ${dataNoteCount ?? 0})`,
  });

  // 2~6) 비로그인 보호 경로 요청: 401 또는 403과 JSON 오류로 거부되어야 합니다.
  async function anonymousDenied({ attackId, path, label, expectedPath }) {
    const response = await get(new URL(path, app));
    let isJson = false;
    try {
      const body = await response.json();
      isJson = body !== null && typeof body === 'object';
    } catch {
      // A non-JSON body fails the "JSON 오류" requirement.
    }
    const rejected = (response.status === 401 || response.status === 403) && isJson;
    attempts.push({
      attackId,
      expected: `비로그인 GET ${expectedPath}는 401 또는 403과 JSON 오류로 거부되어야 함`,
      observed: rejected
        ? `비로그인 ${label} 요청이 거부됨 (HTTP ${response.status}, JSON 응답)`
        : `비로그인 ${label} 요청이 기대대로 거부되지 않음 (HTTP ${response.status}, JSON 응답 ${isJson})`,
    });
  }
  await anonymousDenied({ attackId: 'anonymous_notes_api_denied', path: '/api/notes', label: '공용 자료', expectedPath: '/api/notes' });
  await anonymousDenied({ attackId: 'anonymous_my_notes_api_denied', path: '/api/my-notes', label: '내 메모', expectedPath: '/api/my-notes' });
  // 10단계: 실제 자료가 아닌 고정 가상 ID로 비로그인 복원 미리보기(GET)를 보냅니다.
  if (config.step >= 10) {
    await anonymousDenied({ attackId: 'anonymous_note_restore_denied', label: '복원 미리보기',
      path: '/api/note-restore/00000000-0000-4000-8000-000000000000', expectedPath: '/api/note-restore/:id(복원 미리보기)' });
  }
  if (config.step >= 11) {
    await anonymousDenied({ attackId: 'anonymous_device_challenge_denied', path: '/api/device/challenge',
      label: '기기 등록부', expectedPath: '/api/device/challenge' });
  }
  if (config.step >= 12) {
    await anonymousDenied({ attackId: 'anonymous_ops_summary_denied', path: '/api/ops/summary',
      label: '작전실', expectedPath: '/api/ops/summary' });
  }

  // 7) 5단계: 원본 Supabase 자료 API(originalApiUrl)를 anon 키로 우리 서버를 거치지 않고 직접
  // 조회해도 거부되어야 합니다. 심판도 anon 키로만 확인하며 authenticated 역할은 대상이 아닙니다.
  if (typeof config.originalApiUrl === 'string' && config.originalApiUrl.startsWith('https://')) {
    const readResponse = await get(`${config.originalApiUrl}?select=id`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    });
    const rejected = readResponse.status === 401 || readResponse.status === 403;
    attempts.push({
      attackId: 'anon_direct_original_api_read_denied',
      expected: 'anon 키로 원본 Supabase 자료 API(originalApiUrl)를 직접 조회하면 거부되어야 함',
      observed: rejected
        ? `anon 키 직접 조회가 거부됨 (HTTP ${readResponse.status})`
        : `anon 키 직접 조회가 거부되지 않음 (HTTP ${readResponse.status})`,
    });
  }

  // 8) 5단계: 공개 첫 화면에 서버 전용 키가 섞여 있으면 안 됩니다.
  const homeResponse = await get(app);
  const homeText = await homeResponse.text();
  attempts.push({
    attackId: 'static_bundle_no_secret_key',
    expected: '첫 화면 응답에 서버 전용 키(sb_secret_...) 문자열이 없어야 함',
    observed: SECRET_KEY_PATTERN.test(homeText)
      ? '첫 화면 응답에서 서버 전용 키 패턴이 발견됨'
      : '첫 화면 응답에서 서버 전용 키 패턴이 발견되지 않음',
  });

  // 9) 요청을 보내지 않은 점검: 제출 묶음은 GET·HEAD만 보낼 수 있습니다(S12_BUNDLE_UNSUPPORTED).
  attempts.push({
    attackId: 'anon_direct_original_api_write_denied',
    expected: 'anon 키로 원본 Supabase 자료 API(originalApiUrl)를 직접 수정(추가)하면 거부되어야 함',
    observed: 'not_run: 제출 묶음은 GET·HEAD만 보낼 수 있어 쓰기(POST) 요청은 보내지 않았습니다. 이 항목은 확인하지 않았습니다.',
  });

  return attempts;
}
