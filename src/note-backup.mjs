import { createHash } from 'node:crypto';

// 10단계: 비공개 가상 메모 사본(public.t10_note_backups)의 공통 규칙입니다.
// 사본은 메모가 처음 만들어질 때 서버가 한 번만 남기며(이후 수정으로 덮어쓰지 않음),
// service_role(=서버 함수)만 읽고 쓸 수 있습니다. 메모 본문·해시 입력은 로그에 남기지 않습니다.
export const BACKUP_TABLE = 't10_note_backups';

// 내용 해시: 제목 바이트 길이를 앞에 붙여 제목·본문 경계를 고정한 문자열의 SHA-256입니다.
// supabase/t10_note_backups.local.sql의 기존 메모 사본 만들기 식과 같은 모양이어야 합니다.
export function contentHash(title, content) {
  return createHash('sha256')
    .update(`${Buffer.byteLength(title, 'utf8')}:${title}${content}`, 'utf8').digest('hex');
}

export function backupRow({ id, ownerId, title, content }) {
  return { note_id: id, owner_id: ownerId, title, content, content_sha256: contentHash(title, content) };
}

// 사본 한 건을 요청된 메모 ID·검증된 소유자·내용 해시와 대조합니다.
// 반환: 맞으면 null, 아니면 값이 없는 짧은 사유 코드.
export function verifyBackup(copy, { id, ownerId }) {
  if (!copy || typeof copy !== 'object' || typeof copy.title !== 'string'
      || typeof copy.content !== 'string' || typeof copy.content_sha256 !== 'string') {
    return 'backup_malformed';
  }
  if (copy.note_id !== id) return 'id_mismatch';
  if (copy.owner_id !== ownerId) return 'owner_mismatch';
  if (contentHash(copy.title, copy.content) !== copy.content_sha256) return 'hash_mismatch';
  return null;
}
