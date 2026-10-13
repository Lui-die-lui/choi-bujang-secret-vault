import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { BACKUP_TABLE, contentHash, verifyBackup } from '../../../src/note-backup.mjs';
import { verifyRequestLogin } from '../../../src/notes-auth.mjs';

const TABLE = 't03_personal_notes';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

const fingerprint = userId => createHash('sha256').update(String(userId)).digest('hex').slice(0, 12);

// 10단계: 비공개 사본에서 지정한 메모 한 건만 되살립니다 (POST /api/my-notes/:id/restore).
// 로그인은 다른 자료 API와 같은 verifyRequestLogin으로 확인하고, 요청 본문은 읽지 않습니다.
// 사본의 메모 ID·소유자·내용 해시가 하나라도 맞지 않으면 아무것도 바꾸지 않고 중단합니다.
// 바꾸는 것은 검증된 사용자 본인의 그 메모 한 행뿐이며, 다른 메모·사본·로그는 건드리지 않습니다.
// 응답과 로그에는 메모 제목·본문·토큰을 넣지 않습니다(ID와 내용 해시만).
export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');

  const { id } = request.query;
  if (typeof id !== 'string' || !UUID.test(id)) {
    return response.status(400).json({ error: 'invalid_id' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !supabaseSecretKey) {
    console.error('my-notes API misconfigured: missing SUPABASE_URL or SUPABASE_SECRET_KEY');
    return response.status(500).json({ error: 'server_not_configured' });
  }

  const auth = await verifyRequestLogin(request, supabaseSecretKey);
  if (!auth.ok) return response.status(auth.status).json(auth.body);
  const { identity } = auth;

  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ error: 'method_not_allowed' });
  }

  const log = (outcome, extra = {}) => console.info(JSON.stringify({
    event: 'my-notes.restore', outcome, uid: fingerprint(identity.userId), resource: `note:${id}`, ...extra,
  }));
  const supabase = createClient(supabaseUrl, supabaseSecretKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });

  // 1) 사본 읽기: 본인 소유 사본만. 없거나 남의 사본이면 구분 없이 404입니다.
  const { data: copy, error: copyError } = await supabase
    .from(BACKUP_TABLE)
    .select('note_id, owner_id, title, content, content_sha256')
    .eq('note_id', id)
    .eq('owner_id', identity.userId)
    .maybeSingle();
  if (copyError) {
    console.error('my-notes restore backup read failed:', copyError.message);
    log('backup_unavailable');
    return response.status(500).json({ error: 'backup_unavailable' });
  }
  if (!copy) {
    log('backup_not_found');
    return response.status(404).json({ error: 'not_found' });
  }

  // 2) 사본 검증: ID·소유자·내용 해시가 모두 맞아야 합니다.
  const mismatch = verifyBackup(copy, { id, ownerId: identity.userId });
  if (mismatch) {
    log('backup_verification_failed', { reason: mismatch });
    return response.status(409).json({ error: 'backup_verification_failed' });
  }

  // 3) 같은 ID가 다른 소유자의 행이면 덮어쓰지 않고 중단합니다.
  const { data: current, error: currentError } = await supabase
    .from(TABLE).select('id, owner_id').eq('id', id).maybeSingle();
  if (currentError) {
    console.error('my-notes restore read failed:', currentError.message);
    log('db_error');
    return response.status(500).json({ error: 'notes_read_failed' });
  }
  if (current && current.owner_id !== identity.userId) {
    log('backup_verification_failed', { reason: 'current_owner_mismatch' });
    return response.status(409).json({ error: 'backup_verification_failed' });
  }

  // 4) 그 한 행만 되돌립니다: 있으면 내용만 고치고, 지워졌으면 같은 ID·소유자로 다시 넣습니다.
  const action = current ? 'updated' : 'inserted';
  const { error: writeError } = current
    ? await supabase.from(TABLE).update({ title: copy.title, content: copy.content })
      .eq('id', id).eq('owner_id', identity.userId)
    : await supabase.from(TABLE)
      .insert({ id, owner_id: identity.userId, title: copy.title, content: copy.content });
  if (writeError) {
    console.error('my-notes restore write failed:', writeError.message);
    log('db_error');
    return response.status(500).json({ error: 'notes_write_failed' });
  }

  // 5) 되살린 행을 다시 읽어 사본과 같은지 확인합니다.
  const { data: restored, error: checkError } = await supabase
    .from(TABLE).select('id, owner_id, title, content')
    .eq('id', id).eq('owner_id', identity.userId).maybeSingle();
  if (checkError || !restored || restored.id !== id || restored.owner_id !== identity.userId
      || contentHash(restored.title, restored.content) !== copy.content_sha256) {
    log('restore_verification_failed');
    return response.status(500).json({ error: 'restore_verification_failed' });
  }

  log('restored', { action });
  return response.status(200).json({ id, restored: true, contentSha256: copy.content_sha256 });
}
