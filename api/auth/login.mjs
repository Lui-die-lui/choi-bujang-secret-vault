import { createClient } from '@supabase/supabase-js';
import { createSupabaseBlocklistStore, extractSourceIp, isSourceBlocked, recordFailureAndMaybeBlock } from '../../src/xdr-login-guard.mjs';

// 5단계: 로그인을 서버 함수가 대신 처리해, 화면 코드에는 Supabase 공개 키가
// 전혀 없습니다. 공식 SDK의 signInWithPassword만 쓰고 JWT를 직접 만들지
// 않습니다. 이메일·비밀번호·토큰 값은 로그에 남기지 않습니다(에러 사유
// 문자열만 기록하며, 이는 Supabase가 주는 일반적인 안내 문구입니다).
// 보너스 xdr-01: xdr/brute-force가 block으로 판단한 출발 주소만 여기서 추가로
// 거부합니다(src/xdr-login-guard.mjs, 기존 로그인 로직 앞에 붙는 새 부품).
export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ error: 'method_not_allowed' });
  }
  response.setHeader('Cache-Control', 'no-store');

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !supabaseSecretKey) {
    console.error('auth/login misconfigured: missing SUPABASE_URL or SUPABASE_SECRET_KEY');
    return response.status(500).json({ error: 'server_not_configured' });
  }

  const sourceIp = extractSourceIp(request);
  const blocklistStore = createSupabaseBlocklistStore({ supabaseUrl, supabaseSecretKey });
  if (await isSourceBlocked({ store: blocklistStore, sourceIp })) {
    return response.status(403).json({ error: 'temporarily_blocked' });
  }

  const body = request.body && typeof request.body === 'object' ? request.body : {};
  const { email, password } = body;
  if (typeof email !== 'string' || !email.trim() || typeof password !== 'string' || !password) {
    return response.status(400).json({ error: 'invalid_body' });
  }

  const supabase = createClient(supabaseUrl, supabaseSecretKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    console.error('auth/login failed:', error?.message);
    await recordFailureAndMaybeBlock({ supabaseUrl, supabaseSecretKey, sourceIp, account: email });
    return response.status(401).json({ error: error?.message ?? 'login_failed' });
  }

  const { access_token, refresh_token, expires_at } = data.session;
  return response.status(200).json({
    accessToken: access_token,
    refreshToken: refresh_token,
    expiresAt: expires_at,
    email: data.user?.email ?? email,
  });
}
