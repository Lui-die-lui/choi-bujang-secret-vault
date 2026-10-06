// The student changes this check as each stage adds an attack to the same app.
// Never return tokens, private keys, real names, or note bodies.
export async function runAttackChecks(config) {
  if (config.step !== 2) throw new Error('이 단계의 공격 점검을 src/attack-check.mjs에 구현해 주세요.');
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

  const apiResponse = await fetch(new URL('/api/notes', app), {
    redirect: 'error', signal: AbortSignal.timeout(10000),
  });
  let apiNoteCount = null;
  if (apiResponse.ok) {
    try {
      const body = await apiResponse.json();
      apiNoteCount = Array.isArray(body?.notes) ? body.notes.length : null;
    } catch {
      // A non-JSON response carries no notes either.
    }
  }

  return [
    {
      attackId: 'public_data_json_note_leak',
      expected: '비로그인 /data.json 요청에 가상 메모가 보이면 안 됨(코드 밖 Supabase로 이전됨)',
      observed: dataLeaked
        ? `비로그인 요청에서 메모가 보임 (HTTP ${dataResponse.status}, notes 길이 ${dataNoteCount})`
        : `비로그인 요청에서 메모가 보이지 않음 (HTTP ${dataResponse.status}, notes 길이 ${dataNoteCount ?? 0})`,
    },
    {
      attackId: 'anonymous_notes_api_read',
      expected: '3단계 로그인 전까지는 비로그인 /api/notes 호출도 허용되는 알려진 약점(아직 거부 대상 아님)',
      observed: apiResponse.ok
        ? `비로그인 요청으로 /api/notes 응답 받음 (HTTP ${apiResponse.status}, notes 길이 ${apiNoteCount ?? '알수없음'})`
        : `비로그인 요청에서 /api/notes 응답 실패 (HTTP ${apiResponse.status})`,
    },
  ];
}
