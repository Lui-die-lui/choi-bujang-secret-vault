import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { describeAuthorization } from '../../src/auth-diagnostics.mjs';
import { requireRegisteredDevice } from '../../src/device-registry.mjs';
import { verifyRequestLogin } from '../../src/notes-auth.mjs';
import { traceRequest } from '../../src/request-trace.mjs';

const TABLE = 't03_personal_notes';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function serialize(row) {
  return { id: row.id, title: row.title, body: row.content };
}

// 8단계: 자원 ID는 note:<uuid>입니다(src/decider.mjs의 classifyResource와 같은 표기).
// 거부(404) 때 소유자 불일치인지 없는 메모인지 서버 로그에만 짧게 남깁니다. 응답은
// 둘 다 같은 404라 다른 사용자의 자료 존재 여부가 드러나지 않습니다. 토큰·본문은
// 기록하지 않습니다.
async function logDenied(supabase, id, method) {
  let reason = 'not_found';
  try {
    const { data } = await supabase.from(TABLE).select('id').eq('id', id).maybeSingle();
    if (data) reason = 'owner_mismatch';
  } catch {
    reason = 'lookup_failed';
  }
  console.warn(`my-notes denied: resource=note:${id} method=${method} reason=${reason}`);
}

// 8단계 진단: GET 상세 조회의 처리 결과를 구조화해 기록합니다. 응답·권한 판정은
// 바꾸지 않습니다. 사용자 ID는 SHA-256 지문 앞 12자리만, 자료 ID는 검증을 통과한
// UUID만 남기며 토큰·원본 사용자 ID·본문·환경 변수는 기록하지 않습니다.
const fingerprint = userId => createHash('sha256').update(String(userId)).digest('hex').slice(0, 12);
function logRead(fields) {
  console.info(JSON.stringify({ event: 'my-notes.get', ...fields }));
}

// 3단계: 메모 한 건 조회·수정·삭제.
// 4단계: id 조건과 함께 owner_id = 서버가 검증한 사용자 ID 조건을 쿼리에
// 같이 넣습니다. 남의 메모는 쿼리 결과가 아예 없으므로 "없는 메모"와 구분
// 없이 404로 거부합니다(존재 여부를 알려주지 않음). 요청 본문의 owner_id는
// 애초에 읽지 않으므로 소유자 변경 자체가 불가능합니다.
export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  traceRequest(request, response);

  const { id } = request.query;
  if (typeof id !== 'string' || !UUID.test(id)) {
    if (request.method === 'GET') {
      logRead({ outcome: 'invalid_id', idLength: typeof id === 'string' ? id.length : null });
    }
    return response.status(400).json({ error: 'invalid_id' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !supabaseSecretKey) {
    console.error('my-notes API misconfigured: missing SUPABASE_URL or SUPABASE_SECRET_KEY');
    return response.status(500).json({ error: 'server_not_configured' });
  }

  const auth = await verifyRequestLogin(request, supabaseSecretKey);
  if (!auth.ok) {
    if (request.method === 'GET') {
      logRead({ outcome: 'unauthorized', status: auth.status, resource: `note:${id}`,
        auth: describeAuthorization(request.headers.authorization) });
    }
    return response.status(auth.status).json(auth.body);
  }
  const { identity } = auth;
  const readLog = outcome => logRead({
    outcome, kind: identity.kind, identity: identity.identity ?? null,
    uid: fingerprint(identity.userId), resource: `note:${id}`,
  });

  const supabase = createClient(supabaseUrl, supabaseSecretKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });

  // 11단계: 서버가 이 기기를 등록 기기로 확인하기 전에는 자료를 조회하거나 바꾸지 않습니다.
  const device = await requireRegisteredDevice({ request, identity, supabase, secret: supabaseSecretKey });
  if (!device.ok) {
    if (request.method === 'GET') readLog('device_not_registered');
    return response.status(device.status).json(device.body);
  }

  if (request.method === 'GET') {
    const { data, error } = await supabase
      .from(TABLE)
      .select('id, title, content')
      .eq('id', id)
      .eq('owner_id', identity.userId)
      .maybeSingle();
    if (error) {
      console.error('my-notes read failed:', error.message);
      readLog('db_error');
      return response.status(500).json({ error: 'notes_read_failed' });
    }
    if (!data) {
      await logDenied(supabase, id, 'GET');
      readLog('not_found');
      return response.status(404).json({ error: 'not_found' });
    }
    readLog('found');
    return response.status(200).json(serialize(data));
  }

  if (request.method === 'PUT') {
    const body = request.body && typeof request.body === 'object' ? request.body : {};
    const { title, body: content } = body;
    if (typeof title !== 'string' || !title.trim() || typeof content !== 'string') {
      return response.status(400).json({ error: 'invalid_body' });
    }
    const { data, error } = await supabase
      .from(TABLE)
      .update({ title, content })
      .eq('id', id)
      .eq('owner_id', identity.userId)
      .select('id, title, content')
      .maybeSingle();
    if (error) {
      console.error('my-notes update failed:', error.message);
      return response.status(500).json({ error: 'notes_write_failed' });
    }
    if (!data) {
      await logDenied(supabase, id, 'PUT');
      return response.status(404).json({ error: 'not_found' });
    }
    return response.status(200).json(serialize(data));
  }

  if (request.method === 'DELETE') {
    const { data, error } = await supabase
      .from(TABLE)
      .delete()
      .eq('id', id)
      .eq('owner_id', identity.userId)
      .select('id')
      .maybeSingle();
    if (error) {
      console.error('my-notes delete failed:', error.message);
      return response.status(500).json({ error: 'notes_write_failed' });
    }
    if (!data) {
      await logDenied(supabase, id, 'DELETE');
      return response.status(404).json({ error: 'not_found' });
    }
    return response.status(204).end();
  }

  response.setHeader('Allow', 'GET, PUT, DELETE');
  return response.status(405).json({ error: 'method_not_allowed' });
}
