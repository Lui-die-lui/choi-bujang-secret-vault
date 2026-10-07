// 보너스 xdr-01: xdr/brute-force/decide.mjs가 block으로 판단해 Supabase
// public.xdr_brute_force_blocklist(supabase/xdr_blocklist.local.sql, 학생이 직접 실행)에
// 쌓은 출발 주소를, 실제 로그인 요청(api/auth/login.mjs)에서 확인하는 추가 검사입니다.
// src/decider.mjs의 RULE_IDS·규칙이나 src/verify-login.mjs는 바꾸지 않습니다 — 기존 접근
// 제어 앞에 붙는 별도 부품입니다. DB 조회가 실패하면 이 기능 때문에 정상 로그인이 막히지
// 않도록 열어 둡니다(fail-open). 그 경우 misconfigured 여부를 콘솔 오류로만 남깁니다.

// 순수 로직이라 DB 없이도 시험할 수 있습니다.
export function isRowActive(row, nowMs) {
  if (!row) return false;
  const expiresAtMs = Date.parse(row.expires_at);
  if (Number.isNaN(expiresAtMs)) return false;
  return nowMs < expiresAtMs;
}

export async function isSourceBlocked({ supabaseUrl, supabaseSecretKey, sourceIp, nowMs = Date.now() }) {
  if (!supabaseUrl || !supabaseSecretKey || !sourceIp) return false;
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(supabaseUrl, supabaseSecretKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
    const { data, error } = await supabase
      .from('xdr_brute_force_blocklist')
      .select('expires_at')
      .eq('source_ip', sourceIp)
      .maybeSingle();
    if (error) {
      console.error('xdr login guard lookup failed (fail-open):', error.message);
      return false;
    }
    return isRowActive(data, nowMs);
  } catch (error) {
    console.error('xdr login guard misconfigured (fail-open):', error.message);
    return false;
  }
}

// Vercel 함수 요청에서 가장 왼쪽 출발 주소 하나를 뽑습니다. 헤더가 없으면 null입니다.
export function extractSourceIp(request) {
  const forwarded = request.headers?.['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return null;
}
