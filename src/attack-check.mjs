// The student changes this check as each stage adds an attack to the same app.
// Never return tokens, private keys, real names, or note bodies.

// public.t03_personal_notes의 RLS를 anon 키로 직접 확인하는 용도입니다.
// publishable/anon 키는 공개용이라(public/index.html에도 같은 값이 있음) 비밀값이 아닙니다.
const SUPABASE_ANON_KEY = 'sb_publishable_T6veZAYIlx2HYpfPOTJ50g_yXVERRoW';

export async function runAttackChecks(config) {
  if (config.step !== 4) throw new Error('이 단계의 공격 점검을 src/attack-check.mjs에 구현해 주세요.');
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

  // 우리 서버 API를 거치지 않고, Supabase Data API를 anon 키로 직접 호출해도
  // t03_personal_notes에 접근할 수 없어야 합니다(REVOKE + RLS). 심판이 재현할
  // 수 없는 authenticated 역할의 직접 접근은 이 점검 대상이 아닙니다.
  let directDbCheck = { status: null, rejected: false };
  if (typeof config.identityProvider?.issuer === 'string') {
    const supabaseOrigin = new URL(config.identityProvider.issuer).origin;
    const response = await fetch(`${supabaseOrigin}/rest/v1/t03_personal_notes?select=id`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
      signal: AbortSignal.timeout(10000),
    });
    directDbCheck = { status: response.status, rejected: response.status === 401 || response.status === 403 };
  }

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
      attackId: 'anonymous_direct_data_api_denied',
      expected: 'anon 키로 t03_personal_notes를 직접 조회하면 401 또는 403으로 거부되어야 함',
      observed: directDbCheck.rejected
        ? `anon 키 직접 조회가 거부됨 (HTTP ${directDbCheck.status})`
        : `anon 키 직접 조회가 거부되지 않음 (HTTP ${directDbCheck.status})`,
    },
  ];
}
