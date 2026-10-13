import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { BACKUP_TABLE, contentHash, verifyBackup } from '../../src/note-backup.mjs';
import { verifyRequestLogin } from '../../src/notes-auth.mjs';

const TABLE = 't03_personal_notes';
const AUDIT_TABLE = 't10_restore_audit';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

const fingerprint = userId => createHash('sha256').update(String(userId)).digest('hex').slice(0, 12);

// 10단계 진단(S10_BACKUP_UNVERIFIED): 복원 요청이 어떤 모양으로 오는지 확인하려고 본문·쿼리의
// 항목 이름과 값의 종류·길이만 기록합니다. 값 자체는 기록하지 않고, 이름은 영문·숫자·_·-만
// 32자까지 남깁니다.
const safeName = name => String(name).replace(/[^A-Za-z0-9_-]/gu, '?').slice(0, 32);
function describeFields(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { type: Array.isArray(value) ? 'array' : typeof value, length: value.length ?? null };
  }
  return Object.fromEntries(Object.keys(value).slice(0, 12).map(key => {
    const item = value[key];
    const type = item === null ? 'null' : Array.isArray(item) ? 'array' : typeof item;
    return [safeName(key), typeof item === 'string' || Array.isArray(item) ? `${type}:${item.length}` : type];
  }));
}
function requestShape(request) {
  const { id: _id, ...query } = request.query ?? {};
  const contentType = request.headers?.['content-type'];
  return { body: describeFields(request.body), query: describeFields(query),
    contentType: typeof contentType === 'string' ? safeName(contentType.split(';')[0]) : null };
}

// 사본 한 건을 저장소에서 읽어 메모 ID·소유자·내용 해시를 검증합니다. 부를 때마다 새로 읽습니다.
// 반환: { copy } 또는 { stop: { status, error, reason } } (멈출 때는 아무것도 쓰지 않습니다).
async function readVerifiedBackup(supabase, id, ownerId) {
  const { data: copy, error } = await supabase
    .from(BACKUP_TABLE)
    .select('note_id, owner_id, title, content, content_sha256, created_at')
    .eq('note_id', id)
    .eq('owner_id', ownerId)
    .maybeSingle();
  if (error) return { stop: { status: 500, error: 'backup_unavailable', reason: 'backup_read_failed' } };
  if (!copy) return { stop: { status: 404, error: 'not_found', reason: 'backup_not_found' } };
  const mismatch = verifyBackup(copy, { id, ownerId });
  if (mismatch) return { stop: { status: 409, error: 'backup_verification_failed', reason: mismatch } };
  return { copy };
}

// 실행 전에 보여 줄 내용: 복원할 사본 버전(만든 시각·내용 해시)과 바뀔 항목 이름.
// 제목·본문 자체는 넣지 않습니다.
function planOf(copy, current) {
  const changes = !current ? ['recreate_deleted_note']
    : [current.title !== copy.title && 'title', current.content !== copy.content && 'body'].filter(Boolean);
  return { backupVersion: { createdAt: copy.created_at ?? null, contentSha256: copy.content_sha256 }, changes };
}

// 감사 기록: 복원(POST) 시도를 결과와 상관없이 한 줄씩 덧붙입니다. 고치거나 지우지 않습니다.
// 메모 제목·본문은 담지 않고 ID·결과·내용 해시만 남깁니다. 반환: 기록했으면 true.
async function appendAudit(supabase, row) {
  try {
    const { error } = await supabase.from(AUDIT_TABLE).insert(row);
    if (error) console.error('note-restore audit failed:', error.message);
    return !error;
  } catch {
    console.error('note-restore audit failed: unexpected_error');
    return false;
  }
}

// 10단계: 비공개 사본에서 지정한 메모 한 건만 되살립니다.
//   GET  /api/note-restore/:id  미리보기 — 사본을 읽어 검증하고, 복원할 사본 버전과 바뀔 항목만
//                               보여 줍니다. 아무것도 쓰지 않습니다.
//   POST /api/note-restore/:id  복원 — 같은 미리보기를 만든 뒤, 쓰기 직전에 사본을 다시 읽어
//                               검증하고 그 한 행만 되돌립니다. 시도마다 감사 기록을 덧붙이며,
//                               쓰기 전에 감사 기록을 남기지 못하면 복원하지 않습니다.
// 로그인은 다른 자료 API와 같은 verifyRequestLogin으로 확인합니다. 요청 본문의 id는 경로의 ID와
// 같은지만 보고, 그 밖의 본문 값(소유자·내용 등)은 읽지 않습니다. 사본이 없거나 메모 ID·소유자·
// 내용 해시가 하나라도 맞지 않으면 아무것도 바꾸지 않고 중단합니다. 바꾸는 것은 검증된 사용자
// 본인의 그 메모 한 행뿐이며, 다른 메모·사본·로그는 건드리지 않습니다. 응답과 로그에는 메모
// 제목·본문·토큰을 넣지 않습니다.
export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');

  const { id } = request.query;
  if (typeof id !== 'string' || !UUID.test(id)) {
    return response.status(400).json({ error: 'invalid_id' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !supabaseSecretKey) {
    console.error('note-restore API misconfigured: missing SUPABASE_URL or SUPABASE_SECRET_KEY');
    return response.status(500).json({ error: 'server_not_configured' });
  }

  const auth = await verifyRequestLogin(request, supabaseSecretKey);
  if (!auth.ok) return response.status(auth.status).json(auth.body);
  const { identity } = auth;

  if (request.method !== 'GET' && request.method !== 'POST') {
    response.setHeader('Allow', 'GET, POST');
    return response.status(405).json({ error: 'method_not_allowed' });
  }
  const preview = request.method === 'GET';

  const shape = requestShape(request);
  const log = (outcome, extra = {}) => console.info(JSON.stringify({
    event: preview ? 'note-restore.preview' : 'note-restore.restore', outcome, kind: identity.kind,
    identity: identity.identity ?? null, uid: fingerprint(identity.userId), resource: `note:${id}`,
    ...extra, request: shape,
  }));
  const audit = extra => ({ note_id: id, owner_id: identity.userId, ...extra });
  let supabase = null;
  const stopWith = async ({ status, error, reason }) => {
    const outcome = error === 'not_found' ? 'backup_not_found' : error;
    log(outcome, { reason });
    // 멈춘 복원 시도도 감사 기록에 남깁니다(미리보기는 아무것도 쓰지 않음).
    if (!preview && supabase) await appendAudit(supabase, audit({ outcome, reason }));
    return response.status(status).json({ error });
  };

  // 본문에 id를 함께 보냈다면 경로의 ID와 같아야 합니다(다른 메모를 가리키면 중단).
  const bodyId = request.body && typeof request.body === 'object' ? request.body.id : undefined;
  if (bodyId !== undefined && bodyId !== id) {
    return stopWith({ status: 400, error: 'invalid_id', reason: 'body_id_mismatch' });
  }

  supabase = createClient(supabaseUrl, supabaseSecretKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });

  // 1) 사본을 읽어 검증합니다: 본인 소유 사본만, ID·소유자·내용 해시가 모두 맞아야 합니다.
  const first = await readVerifiedBackup(supabase, id, identity.userId);
  if (first.stop) return stopWith(first.stop);

  // 2) 지금의 메모를 읽습니다. 같은 ID가 다른 소유자의 행이면 덮어쓰지 않고 중단합니다.
  const { data: current, error: currentError } = await supabase
    .from(TABLE).select('id, owner_id, title, content').eq('id', id).maybeSingle();
  if (currentError) {
    console.error('note-restore read failed:', currentError.message);
    return stopWith({ status: 500, error: 'notes_read_failed', reason: 'db_error' });
  }
  if (current && current.owner_id !== identity.userId) {
    return stopWith({ status: 409, error: 'backup_verification_failed', reason: 'current_owner_mismatch' });
  }

  // 3) 실행 전에 보여 줄 내용: 복원할 사본 버전과 바뀔 항목. 미리보기는 여기서 끝납니다.
  const plan = planOf(first.copy, current);
  if (preview) {
    log('previewed', { changes: plan.changes });
    return response.status(200).json({ id, backupVerified: true, ...plan, restored: false });
  }

  // 4) 쓰기 직전에 사본을 다시 읽어 다시 검증합니다. 없어졌거나, 검증에 실패하거나,
  //    미리보기에서 본 버전과 달라졌으면 아무것도 쓰지 않고 중단합니다.
  const second = await readVerifiedBackup(supabase, id, identity.userId);
  if (second.stop) {
    return stopWith({ ...second.stop, status: 409, error: 'backup_verification_failed' });
  }
  const { copy } = second;
  if (copy.content_sha256 !== first.copy.content_sha256
      || (copy.created_at ?? null) !== (first.copy.created_at ?? null)) {
    return stopWith({ status: 409, error: 'backup_verification_failed', reason: 'backup_changed' });
  }

  // 5) 쓰기 전에 감사 기록을 먼저 덧붙입니다. 남기지 못하면 복원하지 않습니다.
  const hashes = { backup_sha256: copy.content_sha256,
    before_sha256: current ? contentHash(current.title, current.content) : null };
  if (!await appendAudit(supabase, audit({ outcome: 'restore_started', ...hashes }))) {
    log('restore_audit_failed');
    return response.status(500).json({ error: 'restore_audit_failed' });
  }

  // 6) 그 한 행만 되돌립니다: 있으면 내용만 고치고, 지워졌으면 같은 ID·소유자로 다시 넣습니다.
  const action = current ? 'updated' : 'inserted';
  const { error: writeError } = current
    ? await supabase.from(TABLE).update({ title: copy.title, content: copy.content })
      .eq('id', id).eq('owner_id', identity.userId)
    : await supabase.from(TABLE)
      .insert({ id, owner_id: identity.userId, title: copy.title, content: copy.content });
  if (writeError) {
    console.error('note-restore write failed:', writeError.message);
    return stopWith({ status: 500, error: 'notes_write_failed', reason: 'db_error' });
  }

  // 7) 되살린 행을 다시 읽어 사본과 같은지 확인합니다.
  const { data: restored, error: checkError } = await supabase
    .from(TABLE).select('id, owner_id, title, content')
    .eq('id', id).eq('owner_id', identity.userId).maybeSingle();
  if (checkError || !restored || restored.id !== id || restored.owner_id !== identity.userId
      || contentHash(restored.title, restored.content) !== copy.content_sha256) {
    return stopWith({ status: 500, error: 'restore_verification_failed', reason: 'readback_mismatch' });
  }

  // 8) 결과를 감사 기록에 덧붙입니다. 남기지 못하면 성공으로 답하지 않습니다.
  if (!await appendAudit(supabase, audit({ outcome: 'restored', ...hashes,
    after_sha256: contentHash(restored.title, restored.content) }))) {
    log('restore_audit_failed', { action });
    return response.status(500).json({ error: 'restore_audit_failed' });
  }

  log('restored', { action, changes: plan.changes });
  return response.status(200).json({ id, restored: true, backupVerified: true, ...plan,
    contentSha256: copy.content_sha256, auditRecorded: true });
}
