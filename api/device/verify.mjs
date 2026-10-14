import { createClient } from '@supabase/supabase-js';
import { DEVICE_TABLE, deviceCode, issueDeviceSession, verifyDeviceAssertion } from '../../src/device-registry.mjs';
import { verifyRequestLogin } from '../../src/notes-auth.mjs';
import { requireActiveIdentity } from '../../src/ops-registry.mjs';
import { traceRequest } from '../../src/request-trace.mjs';

// 11단계: 기기 확인과 승인 상태 조회 (POST /api/device/verify).
// 기기가 일회용 질문에 서명한 값을 등록부의 공개키로 검증하고, 등록부의 지금 상태를 알려 줍니다.
// 등록부에서 "approved"인 기기만 30분짜리 기기 확인 결과를 받습니다. 대기·회수 상태의 기기는
// 서명이 맞아도 아무것도 받지 못합니다. 등록부는 바꾸지 않습니다.
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

  const body = request.body && typeof request.body === 'object' ? request.body : {};
  if (typeof body.credentialId !== 'string') return response.status(400).json({ error: 'invalid_device_request' });

  const supabase = createClient(supabaseUrl, supabaseSecretKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  // 12단계: 회수된 신원은 기기 등록·확인 경로도 쓸 수 없습니다.
  const active = await requireActiveIdentity({ supabase, identity });
  if (!active.ok) return response.status(active.status).json(active.body);
  const { data: device, error } = await supabase.from(DEVICE_TABLE)
    .select('credential_id, owner_id, public_key_spki, alg, status')
    .eq('credential_id', body.credentialId).eq('owner_id', identity.userId).maybeSingle();
  if (error) {
    console.error('device read failed:', error.message);
    return response.status(500).json({ error: 'device_registry_unavailable' });
  }
  if (!device || !verifyDeviceAssertion({ secret: supabaseSecretKey, userId: identity.userId, device, body })) {
    console.info(JSON.stringify({ event: 'device.verify', outcome: 'rejected' }));
    return response.status(401).json({ error: 'device_not_verified' });
  }
  const code = deviceCode(device.credential_id);
  console.info(JSON.stringify({ event: 'device.verify', outcome: device.status, device: code }));
  if (device.status !== 'approved') {
    return response.status(200).json({ status: device.status === 'pending' ? 'pending' : 'revoked', code });
  }
  return response.status(200).json({ status: 'approved', code,
    ...issueDeviceSession(supabaseSecretKey, identity.userId, device.credential_id) });
}
