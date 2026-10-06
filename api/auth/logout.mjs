import { createClient } from '@supabase/supabase-js';

// 공식 SDK의 auth.admin.signOut만 사용합니다(서버가 service_role 키로
// 특정 access token의 세션을 직접 폐기). 주의: 이 호출은 해당 세션의
// refresh token을 서버에서 즉시 폐기해 "재발급"은 막지만, 이미 발급된
// access token(JWT)은 짧은 수명(기본 1시간) 동안 서명 검증상 계속 유효할
// 수 있습니다 — Supabase는 매 요청마다 로그아웃 여부를 실시간으로 대조하지
// 않기 때문입니다. "로그아웃 = 기존 access token 즉시 무효화"로 단정하지
// 않습니다.
export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ error: 'method_not_allowed' });
  }
  response.setHeader('Cache-Control', 'no-store');

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !supabaseSecretKey) {
    console.error('auth/logout misconfigured: missing SUPABASE_URL or SUPABASE_SECRET_KEY');
    return response.status(500).json({ error: 'server_not_configured' });
  }

  const match = /^Bearer (.+)$/u.exec(request.headers.authorization ?? '');
  if (!match) {
    return response.status(400).json({ error: 'invalid_body' });
  }
  const accessToken = match[1];

  const supabase = createClient(supabaseUrl, supabaseSecretKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });

  const { error } = await supabase.auth.admin.signOut(accessToken, 'local');
  if (error) {
    // 세션이 이미 만료·폐기된 경우에도 브라우저는 자기 쪽 토큰을 지우면
    // 되므로, 이 실패를 치명적 오류로 다루지 않습니다.
    console.error('auth/logout failed:', error.message);
  }

  return response.status(204).end();
}
