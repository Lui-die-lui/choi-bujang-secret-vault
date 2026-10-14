import { createHash } from 'node:crypto';
import { detect } from './detect.mjs';
import { platformIdOf, requestIdOf } from './request-trace.mjs';

// 12단계: 신원 회수 등록부와 접근 사건 기록(docs/sql/t12_ops.sql).
//  - 회수된 신원은 로그인 토큰이 유효해도 보호 API와 기기 API가 모두 403으로 닫힙니다.
//    회수·복권은 관리자가 DB에서 직접 하며 이 앱의 API에는 회수 상태를 바꾸는 경로가 없습니다.
//  - 사건 기록에는 메서드·경로 모양·결과·상태·요청 ID와 사용자 번호의 SHA-256 지문 앞 16자리만
//    남깁니다. 메모 제목·본문, 토큰, 기기 키, 원본 사용자 번호는 기록하지 않습니다.
export const REVOKED_TABLE = 't12_revoked_identities';
export const EVENTS_TABLE = 't12_access_events';
export const DETECT_WINDOW_SECONDS = 600;
const MAX_EVENTS = 1000;

export const subjectFingerprint = userId => createHash('sha256').update(String(userId)).digest('hex').slice(0, 16);

// 반환: { ok: true } 또는 { ok: false, status, body }. 조회 실패는 열어 주지 않습니다(fail-closed).
export async function requireActiveIdentity({ supabase, identity }) {
  try {
    const { data, error } = await supabase.from(REVOKED_TABLE).select('subject_id')
      .eq('subject_id', identity.userId).is('restored_at', null).limit(1);
    if (error) throw new Error(error.message);
    if (Array.isArray(data) && data.length > 0) {
      console.warn(JSON.stringify({ event: 'identity.revoked', subject: subjectFingerprint(identity.userId) }));
      return { ok: false, status: 403, body: { error: 'identity_revoked' } };
    }
    return { ok: true };
  } catch (error) {
    console.error('revocation registry unavailable:', error.message);
    return { ok: false, status: 503, body: { error: 'revocation_registry_unavailable' } };
  }
}

// 접근 사건 한 줄 기록. 실패해도 요청 처리를 바꾸지 않습니다(관측 실패는 로그에만).
export async function recordAccess({ supabase, identity, request, route, outcome, status }) {
  const row = { subject_hash: subjectFingerprint(identity.userId), method: String(request.method ?? '').slice(0, 8),
    route, outcome, status, request_id: requestIdOf(request), platform_id: platformIdOf(request) };
  try {
    const { error } = await supabase.from(EVENTS_TABLE).insert(row);
    if (error) throw new Error(error.message);
    return true;
  } catch (error) {
    console.error('access event not recorded:', error.message);
    return false;
  }
}

// 본인 사건만 읽어 detect()에 넘깁니다. 반환 state: observed | no_events | query_failed
export async function readOwnDetection({ supabase, identity, now = Date.now() }) {
  const since = new Date(now - DETECT_WINDOW_SECONDS * 1000).toISOString();
  const subject = subjectFingerprint(identity.userId);
  try {
    const { data, error } = await supabase.from(EVENTS_TABLE).select('at, method, route, outcome')
      .eq('subject_hash', subject).gte('at', since).order('at', { ascending: false }).limit(MAX_EVENTS);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    // 시각을 읽을 수 없는 행은 탐지에 넣지 않고 건수만 따로 알립니다(0건으로 감추지 않음).
    const readable = rows.filter(row => Number.isFinite(Date.parse(row.at)));
    const events = readable.map(row => ({ at: new Date(row.at).toISOString(), method: row.method, identity: { sub: subject } }));
    const byOutcome = {};
    for (const row of rows) byOutcome[row.outcome] = (byOutcome[row.outcome] ?? 0) + 1;
    return { state: rows.length ? 'observed' : 'no_events', windowSeconds: DETECT_WINDOW_SECONDS,
      eventCount: rows.length, unreadableCount: rows.length - readable.length, truncated: rows.length >= MAX_EVENTS, byOutcome, result: detect(events) };
  } catch (error) {
    return { state: 'query_failed', windowSeconds: DETECT_WINDOW_SECONDS, reason: String(error.message).slice(0, 80) };
  }
}
