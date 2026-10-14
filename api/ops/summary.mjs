import { createClient } from '@supabase/supabase-js';
import { RULE_IDS } from '../../src/decider.mjs';
import { DEVICE_TABLE, deviceCode, requireRegisteredDevice } from '../../src/device-registry.mjs';
import { verifyRequestLogin } from '../../src/notes-auth.mjs';
import { REVOKED_TABLE, readOwnDetection } from '../../src/ops-registry.mjs';
import { requestIdOf, traceRequest } from '../../src/request-trace.mjs';

// 12단계 탈환 작전실: GET /api/ops/summary
// 범위: 호출한 사용자 본인의 기기·회수·사건·복구 기록만 돌려줍니다. 이 앱의 권한 모델에는
// 운영자 역할을 검증해 주는 값이 없어(docs/DECIDER_REQUEST.md에 role 없음) 전체 사용자 범위의
// 조회는 제공하지 않습니다. 로그인 + 회수되지 않은 신원 + 등록 기기 확인을 다른 자료 API와
// 같은 관문으로 거칩니다. 메모 제목·본문, 토큰, 공개키, 원본 사용자 번호는 담지 않습니다.
// 각 구역의 state: defined_in_code(코드에 정의된 값) | observed(서버 조회 결과) |
// no_events/empty(조회는 됐고 기록이 0건) | query_failed(조회 실패) | not_connected(연결 안 됨).
const short = value => (typeof value === 'string' ? value.slice(0, 8) : null);

async function section(read) {
  try {
    return await read();
  } catch (error) {
    return { state: 'query_failed', reason: String(error?.message ?? 'unknown').slice(0, 80) };
  }
}

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  traceRequest(request, response);
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'method_not_allowed' });
  }
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !supabaseSecretKey) {
    console.error('ops API misconfigured: missing SUPABASE_URL or SUPABASE_SECRET_KEY');
    return response.status(500).json({ error: 'server_not_configured' });
  }
  const auth = await verifyRequestLogin(request, supabaseSecretKey);
  if (!auth.ok) {
    console.info(JSON.stringify({ event: 'ops.summary', outcome: 'unauthorized', requestId: requestIdOf(request) }));
    return response.status(auth.status).json(auth.body);
  }
  const { identity } = auth;
  const supabase = createClient(supabaseUrl, supabaseSecretKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const gate = await requireRegisteredDevice({ request, identity, supabase, secret: supabaseSecretKey });
  if (!gate.ok) return response.status(gate.status).json(gate.body);

  const owner = identity.userId;
  const detection = await readOwnDetection({ supabase, identity });

  const devices = await section(async () => {
    const { data, error } = await supabase.from(DEVICE_TABLE).select('credential_id, status').eq('owner_id', owner);
    if (error) throw new Error(error.message);
    const counts = { pending: 0, approved: 0, revoked: 0 };
    for (const row of data ?? []) counts[row.status] = (counts[row.status] ?? 0) + 1;
    return { state: 'observed', source: 'public.t11_devices', counts,
      devices: (data ?? []).map(row => ({ code: deviceCode(row.credential_id), status: row.status })) };
  });
  const identityState = await section(async () => {
    const { data, error } = await supabase.from(REVOKED_TABLE).select('reason_code, revoked_at, restored_at')
      .eq('subject_id', owner).order('revoked_at', { ascending: false }).limit(20);
    if (error) throw new Error(error.message);
    return { state: 'observed', source: `public.${REVOKED_TABLE}`, current: 'active',
      history: (data ?? []).map(row => ({ reasonCode: row.reason_code, revokedAt: row.revoked_at, restoredAt: row.restored_at })) };
  });
  const recovery = await section(async () => {
    const [backups, audit] = await Promise.all([
      supabase.from('t10_note_backups').select('note_id, content_sha256, created_at').eq('owner_id', owner)
        .order('created_at', { ascending: false }).limit(20),
      supabase.from('t10_restore_audit').select('at, note_id, outcome, reason').eq('owner_id', owner)
        .order('at', { ascending: false }).limit(20),
    ]);
    if (backups.error || audit.error) throw new Error((backups.error ?? audit.error).message);
    return { state: 'observed', source: 'public.t10_note_backups, public.t10_restore_audit',
      backups: (backups.data ?? []).map(row => ({ noteId: short(row.note_id), contentSha256: short(row.content_sha256),
        createdAt: row.created_at })),
      restoreAudit: (audit.data ?? []).map(row => ({ at: row.at, noteId: short(row.note_id), outcome: row.outcome,
        reason: row.reason })) };
  });

  return response.status(200).json({
    schema: 'aleph.ops.summary.v1', requestId: requestIdOf(request), generatedAt: new Date().toISOString(),
    scope: 'self',
    rules: { state: 'defined_in_code', source: 'src/decider.mjs RULE_IDS', ruleIds: [...RULE_IDS],
      observedGateOutcomes: detection.state === 'query_failed' ? null : detection.byOutcome ?? {},
      note: '규칙 이름은 코드 정의입니다. 관측 건수는 최근 사건 기록의 관문 결과이며 규칙별 적용 건수가 아닙니다.' },
    detection: { ...detection, source: `public.t12_access_events`, engineDelivery: 'not_connected',
      note: '저장된 본인 사건에 detect()를 읽는 시점에 적용한 결과입니다. 운영 엔진으로 전달되거나 회수를 집행하지 않습니다.' },
    identity: identityState,
    devices,
    recovery,
  });
}
