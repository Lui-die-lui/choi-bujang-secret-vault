import { createClient } from '@supabase/supabase-js';

// 공식 SDK의 refreshSession만 사용합니다. JWT를 직접 만들지 않고, 토큰 값은
// 로그에 남기지 않습니다.
export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ error: 'method_not_allowed' });
  }
  response.setHeader('Cache-Control', 'no-store');

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !supabaseSecretKey) {
    console.error('auth/refresh misconfigured: missing SUPABASE_URL or SUPABASE_SECRET_KEY');
    return response.status(500).json({ error: 'server_not_configured' });
  }

  const body = request.body && typeof request.body === 'object' ? request.body : {};
  const { refreshToken } = body;
  if (typeof refreshToken !== 'string' || !refreshToken) {
    return response.status(400).json({ error: 'invalid_body' });
  }

  const supabase = createClient(supabaseUrl, supabaseSecretKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });

  const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
  if (error || !data.session) {
    console.error('auth/refresh failed:', error?.message);
    return response.status(401).json({ error: 'refresh_failed' });
  }

  const { access_token, refresh_token, expires_at } = data.session;
  return response.status(200).json({
    accessToken: access_token,
    refreshToken: refresh_token,
    expiresAt: expires_at,
    email: data.user?.email ?? null,
  });
}
