import { createClient } from '@supabase/supabase-js';
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
  if (!auth.ok) return response.status(auth.status).json(auth.body);

  const supabase = createClient(supabaseUrl, supabaseSecretKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });

  const { data, error } = await supabase
    .from('t02_vault_notes')
    .select('title, content')
    .order('id', { ascending: true });

  if (error) {
    console.error('notes API read failed:', error.message);
    return response.status(500).json({ error: 'notes_read_failed' });
  }

  return response.status(200).json({ notes: data ?? [] });
}
