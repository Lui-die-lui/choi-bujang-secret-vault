import { createClient } from '@supabase/supabase-js';
import { describeAuthorization } from '../src/auth-diagnostics.mjs';
import { requireRegisteredDevice } from '../src/device-registry.mjs';
import { verifyRequestLogin } from '../src/notes-auth.mjs';

// 2단계: 가상 메모를 코드 밖(Supabase, t02_vault_notes)으로 옮기고
// 서버 전용 환경변수로만 읽습니다.
// 3단계: 요청마다 src/notes-auth.mjs(src/verify-login.mjs를 그대로 사용)로
// Authorization 헤더의 Supabase 로그인 토큰을 검증합니다.
// 브라우저가 보낸 userId·role은 쓰지 않습니다.
export default async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'method_not_allowed' });
  }
  response.setHeader('Cache-Control', 'no-store');

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !supabaseSecretKey) {
    console.error('notes API misconfigured: missing SUPABASE_URL or SUPABASE_SECRET_KEY');
    return response.status(500).json({ error: 'server_not_configured' });
  }

  const auth = await verifyRequestLogin(request, supabaseSecretKey);
  if (!auth.ok) {
    // 8단계 진단: 401 원인(토큰 없음/검증 실패) 구분용. 응답은 그대로입니다.
    console.info(JSON.stringify({ event: 'notes.list', outcome: 'unauthorized',
      status: auth.status, auth: describeAuthorization(request.headers.authorization) }));
    return response.status(auth.status).json(auth.body);
  }

  const supabase = createClient(supabaseUrl, supabaseSecretKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });

  // 11단계: 서버가 이 기기를 등록 기기로 확인하기 전에는 자료를 조회하지 않습니다.
  const device = await requireRegisteredDevice({ request, identity: auth.identity, supabase, secret: supabaseSecretKey });
  if (!device.ok) return response.status(device.status).json(device.body);

  // 8단계: "공용 자료"를 데이터로 정의합니다 — owner_id가 비어 있는 행만 돌려줍니다.
  // t02_vault_notes에 소유자가 있는 행이 생겨도 이 공용 경로로는 나가지 않습니다.
  // 개인 메모는 별도 테이블(t03_personal_notes)이며 이 경로는 읽지 않습니다.
  const { data, error } = await supabase
    .from('t02_vault_notes')
    .select('title, content')
    .is('owner_id', null)
    .order('id', { ascending: true });

  if (error) {
    console.error('notes API read failed:', error.message);
    return response.status(500).json({ error: 'notes_read_failed' });
  }

  return response.status(200).json({ notes: data ?? [] });
}
