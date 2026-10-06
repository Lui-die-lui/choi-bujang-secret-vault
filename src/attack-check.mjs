// The student changes this check as each stage adds an attack to the same app.
// Never return tokens, private keys, real names, or note bodies.

// public.t03_personal_notes의 RLS/권한을 anon 키로 직접 확인하는 용도입니다.
// publishable/anon 키는 공개용이라(과거 public/index.html에도 같은 값이 있었음) 비밀값이 아닙니다.
const SUPABASE_ANON_KEY = 'sb_publishable_T6veZAYIlx2HYpfPOTJ50g_yXVERRoW';

// 공개 정적 파일·브라우저 묶음에 섞여 있으면 안 되는 서버 전용 키 패턴입니다.
const SECRET_KEY_PATTERN = /sb_secret_[A-Za-z0-9_-]{12,}/u;

export async function runAttackChecks(config) {
  if (config.step !== 5) throw new Error('이 단계의 공격 점검을 src/attack-check.mjs에 구현해 주세요.');
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

  const dataResponse = await fetch(new URL('/data.json', app), {
    redirect: 'error', signal: AbortSignal.timeout(10000),
  });
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

  async function checkAnonymousRejected(path) {
    const response = await fetch(new URL(path, app), {
      redirect: 'error', signal: AbortSignal.timeout(10000),
    });
    let isJson = false;
    try {
      const body = await response.json();
      isJson = body !== null && typeof body === 'object';
    } catch {
      // A non-JSON body fails the "JSON 오류" requirement.
    }
    const rejected = response.status === 401 || response.status === 403;
    return { status: response.status, rejected, isJson };
  }

  const notesCheck = await checkAnonymousRejected('/api/notes');
  const myNotesCheck = await checkAnonymousRejected('/api/my-notes');

  // 5단계: 원본 Supabase 자료 API(aleph.config.json의 originalApiUrl)를
  // 우리 서버를 거치지 않고 anon 키로 직접 조회·수정해도 거부되어야 합니다.
  // 심판도 anon 키로만 확인하며, 재현할 수 없는 authenticated 역할의 직접
  // 접근은 이 점검 대상이 아닙니다.
  let readCheck = { status: null, rejected: false };
  let writeCheck = { status: null, rejected: false };
  if (typeof config.originalApiUrl === 'string' && config.originalApiUrl.startsWith('https://')) {
    const readResponse = await fetch(`${config.originalApiUrl}?select=id`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
      signal: AbortSignal.timeout(10000),
    });
    readCheck = { status: readResponse.status, rejected: readResponse.status === 401 || readResponse.status === 403 };

    const writeResponse = await fetch(config.originalApiUrl, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title: 'attack-check', content: 'attack-check' }),
      signal: AbortSignal.timeout(10000),
    });
    writeCheck = { status: writeResponse.status, rejected: writeResponse.status === 401 || writeResponse.status === 403 };
  }

  // 5단계: 공개 정적 파일(첫 화면)에 서버 전용 키가 섞여 있으면 안 됩니다.
  const homeResponse = await fetch(app, { redirect: 'error', signal: AbortSignal.timeout(10000) });
  const homeText = await homeResponse.text();
  const secretKeyFound = SECRET_KEY_PATTERN.test(homeText);

  return [
    {
      attackId: 'public_data_json_note_leak',
      expected: '비로그인 /data.json 요청에 가상 메모가 보이면 안 됨',
      observed: dataLeaked
        ? `비로그인 요청에서 메모가 보임 (HTTP ${dataResponse.status}, notes 길이 ${dataNoteCount})`
        : `비로그인 요청에서 메모가 보이지 않음 (HTTP ${dataResponse.status}, notes 길이 ${dataNoteCount ?? 0})`,
    },
    {
      attackId: 'anonymous_notes_api_denied',
      expected: '비로그인 GET /api/notes는 401 또는 403과 JSON 오류로 거부되어야 함',
      observed: notesCheck.rejected && notesCheck.isJson
        ? `비로그인 요청이 거부됨 (HTTP ${notesCheck.status}, JSON 응답)`
        : `비로그인 요청이 거부되지 않음 (HTTP ${notesCheck.status}, JSON 응답 ${notesCheck.isJson})`,
    },
    {
      attackId: 'anonymous_my_notes_api_denied',
      expected: '비로그인 GET /api/my-notes는 401 또는 403과 JSON 오류로 거부되어야 함',
      observed: myNotesCheck.rejected && myNotesCheck.isJson
        ? `비로그인 요청이 거부됨 (HTTP ${myNotesCheck.status}, JSON 응답)`
        : `비로그인 요청이 거부되지 않음 (HTTP ${myNotesCheck.status}, JSON 응답 ${myNotesCheck.isJson})`,
    },
    {
      attackId: 'anon_direct_original_api_read_denied',
      expected: 'anon 키로 원본 Supabase 자료 API(originalApiUrl)를 직접 조회하면 거부되어야 함',
      observed: readCheck.rejected
        ? `anon 키 직접 조회가 거부됨 (HTTP ${readCheck.status})`
        : `anon 키 직접 조회가 거부되지 않음 (HTTP ${readCheck.status})`,
    },
    {
      attackId: 'anon_direct_original_api_write_denied',
      expected: 'anon 키로 원본 Supabase 자료 API(originalApiUrl)를 직접 수정(추가)하면 거부되어야 함',
      observed: writeCheck.rejected
        ? `anon 키 직접 추가가 거부됨 (HTTP ${writeCheck.status})`
        : `anon 키 직접 추가가 거부되지 않음 (HTTP ${writeCheck.status})`,
    },
    {
      attackId: 'static_bundle_no_secret_key',
      expected: '첫 화면 응답에 서버 전용 키(sb_secret_...) 문자열이 없어야 함',
      observed: secretKeyFound
        ? '첫 화면 응답에서 서버 전용 키 패턴이 발견됨'
        : '첫 화면 응답에서 서버 전용 키 패턴이 발견되지 않음',
    },
  ];
}
