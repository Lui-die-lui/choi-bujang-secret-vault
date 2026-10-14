import { createClient } from '@supabase/supabase-js';
import { DEVICE_TABLE, deviceCode, readApprovalRequest } from '../../src/device-registry.mjs';
import { verifyRequestLogin } from '../../src/notes-auth.mjs';
import { requireActiveIdentity } from '../../src/ops-registry.mjs';
import { traceRequest } from '../../src/request-trace.mjs';

const MAX_DEVICES_PER_USER = 5;

// 11단계: 기기 승인 요청 (POST /api/device/request).
// 기기가 방금 만든 공개키를 등록부에 "pending"으로만 올립니다. 이 요청은 어떤 권한도 주지
// 않습니다. 본문에 status 같은 값을 넣어도 읽지 않으며, 승인은 관리자가 DB에서 따로 합니다.
export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  traceRequest(request, response);
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ error: 'method_not_allowed' });
  }
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !supabaseSecretKey) {
    console.error('device API misconfigured: missing SUPABASE_URL or SUPABASE_SECRET_KEY');
    return response.status(500).json({ error: 'server_not_configured' });
  }
  const auth = await verifyRequestLogin(request, supabaseSecretKey);
  if (!auth.ok) return response.status(auth.status).json(auth.body);
  const { identity } = auth;

  const row = readApprovalRequest({ secret: supabaseSecretKey, userId: identity.userId, body: request.body });
  if (!row) return response.status(400).json({ error: 'invalid_device_request' });

  const supabase = createClient(supabaseUrl, supabaseSecretKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  // 12단계: 회수된 신원은 기기 등록·확인 경로도 쓸 수 없습니다.
  const active = await requireActiveIdentity({ supabase, identity });
  if (!active.ok) return response.status(active.status).json(active.body);
  const { data: existing, error: listError } = await supabase.from(DEVICE_TABLE).select('credential_id')
    .eq('owner_id', identity.userId);
  if (listError) {
    console.error('device list failed:', listError.message);
    return response.status(500).json({ error: 'device_registry_unavailable' });
  }
  if ((existing ?? []).length >= MAX_DEVICES_PER_USER) {
    return response.status(409).json({ error: 'too_many_devices' });
  }
  const { error } = await supabase.from(DEVICE_TABLE).insert(row);
  if (error) {
    console.error('device request failed:', error.message);
    return response.status(409).json({ error: 'device_request_failed' });
  }
  console.info(JSON.stringify({ event: 'device.request', outcome: 'pending', device: deviceCode(row.credential_id) }));
  return response.status(201).json({ status: 'pending', code: deviceCode(row.credential_id) });
}
