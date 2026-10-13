import { createClient } from '@supabase/supabase-js';
import { DEVICE_TABLE, deviceCode, issueChallenge, relyingParty, userHandle } from '../../src/device-registry.mjs';
import { verifyRequestLogin } from '../../src/notes-auth.mjs';

// 11단계: 기기 확인을 시작할 때 부릅니다 (GET /api/device/challenge).
// 로그인한 사용자에게 일회용 질문과, 그 사용자가 등록부에 올린 기기 목록(식별값·상태)을 줍니다.
// 보호 자료는 돌려주지 않으며 등록부를 바꾸지 않습니다.
export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'method_not_allowed' });
  }
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
  const party = relyingParty();
  if (!supabaseUrl || !supabaseSecretKey || !party) {
    console.error('device API misconfigured: missing SUPABASE_URL, SUPABASE_SECRET_KEY or app address');
    return response.status(500).json({ error: 'server_not_configured' });
  }
  const auth = await verifyRequestLogin(request, supabaseSecretKey);
  if (!auth.ok) return response.status(auth.status).json(auth.body);
  const { identity } = auth;

  const supabase = createClient(supabaseUrl, supabaseSecretKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const { data, error } = await supabase.from(DEVICE_TABLE).select('credential_id, status')
    .eq('owner_id', identity.userId).order('created_at', { ascending: true });
  if (error) {
    console.error('device list failed:', error.message);
    return response.status(500).json({ error: 'device_registry_unavailable' });
  }
  return response.status(200).json({
    ...issueChallenge(supabaseSecretKey, identity.userId),
    rpId: party.id,
    userHandle: userHandle(identity.userId),
    devices: (data ?? []).map(row => ({ credentialId: row.credential_id, status: row.status,
      code: deviceCode(row.credential_id) })),
  });
}
