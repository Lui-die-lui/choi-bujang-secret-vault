// The student changes this check as each stage adds an attack to the same app.
// Never return tokens, private keys, real names, or note bodies.
export async function runAttackChecks(config) {
  if (config.step !== 3) throw new Error('이 단계의 공격 점검을 src/attack-check.mjs에 구현해 주세요.');
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
  ];
}
