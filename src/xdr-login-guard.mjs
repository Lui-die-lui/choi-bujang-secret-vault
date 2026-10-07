// 보너스 xdr-01: 실제 로그인 요청(api/auth/login.mjs)에서 Supabase
// public.xdr_brute_force_blocklist(supabase/xdr_blocklist.local.sql, 학생이 직접 실행)를
// 확인하는 추가 검사입니다. src/decider.mjs의 RULE_IDS·규칙이나 src/verify-login.mjs는
// 바꾸지 않습니다 — 기존 접근 제어 앞에 붙는 별도 부품입니다. DB 조회가 실패하면 이 기능
// 때문에 정상 로그인이 막히지 않도록 열어 둡니다(fail-open). 그 경우 misconfigured 여부를
// 콘솔 오류로만 남깁니다.
//
// 주의(연결 범위): xdr/brute-force/run.mjs(npm run xdr:run)는 이 표에 아무것도 쓰지
// 않습니다 — 로컬 xdr/brute-force/blocklist.json·result.json만 만듭니다. 합성 시험
// 경보(RFC 5737 문서용 주소)를 자동으로 이 운영 표에 넣는 길을 일부러 만들지
// 않았습니다(시험 자료가 실제 차단 목록에 섞여 들어가는 사고를 막기 위함). 이 표는
// 지금은 학생이 SQL Editor에서 직접 넣고 지우는 수동 시험 행으로만 채워집니다.

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

// 한 토큰에서 포트/괄호/IPv4-매핑 접두사를 떼어 비교 기준을 맞춥니다.
export function normalizeIp(token) {
  let value = token.trim();
  const bracketed = /^\[(.+)\]:\d+$/u.exec(value);
  if (bracketed) {
    value = bracketed[1];
  } else if (/^(\d{1,3}\.){3}\d{1,3}:\d+$/u.test(value)) {
    value = value.slice(0, value.lastIndexOf(':'));
  }
  if (value.toLowerCase().startsWith('::ffff:') && /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/u.test(value.slice(7))) {
    value = value.slice(7);
  }
  return value;
}

// Vercel 엣지는 신뢰할 수 있는 단일 홉으로, 클라이언트가 보낸 x-forwarded-for
// 체인 맨 끝에 실제 연결 주소를 덧붙입니다. 맨 앞 값은 클라이언트가 직접 써넣은
// 값일 수 있어(위조 가능) 신뢰하지 않고, 체인의 마지막 값만 씁니다.
// 주의: 이 가정은 Vercel의 실제 요청 헤더 동작을 코드만으로 검증한 것이며, 이번
// 세션에서 실제 배포에 요청을 보내 확인하지는 않았습니다 — 배포 후 로그로 직접
// 확인해 주세요(예: 알고 있는 본인 IP와 추출값이 같은지).
export function extractSourceIp(request) {
  const forwarded = request.headers?.['x-forwarded-for'];
  if (typeof forwarded !== 'string' || !forwarded.trim()) return null;
  const hops = forwarded.split(',').map((hop) => hop.trim()).filter(Boolean);
  if (!hops.length) return null;
  return normalizeIp(hops[hops.length - 1]);
}
