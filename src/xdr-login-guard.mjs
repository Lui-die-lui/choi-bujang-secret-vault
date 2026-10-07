// (버그 수정 이력) recordFailureAndMaybeBlock이 처음에는 xdr/brute-force/patterns.json을
// 런타임에 fs.readFileSync로 읽었는데, Vercel 서버 함수 배포본에서는 조용히
// ENOENT로 실패했습니다(fail-open) — Vercel의 빌드 추적기는 import 문처럼 정적으로
// 보이는 의존성만 묶어 넣고, 동적으로 계산한 경로의 readFileSync는 추적하지
// 못합니다. 실제 배포 주소에 로그인 실패를 반복해서 보내 봤는데도 차단이 전혀
// 안 걸려서(표도 비어 있었음) 알게 됐습니다. 파일을 아예 안 읽도록, 아래 상수로
// 바꿨습니다(xdr/brute-force/patterns.json의 config와 같은 값 — 그 쪽을 바꾸면
// 여기도 같이 바꿔 주세요. 이 파일은 Vercel 서버 함수에 배포되므로 배포본에
// 확실히 포함되는 값만 써야 합니다).
const LIVE_FAILURE_CONFIG = Object.freeze({
  windowSeconds: 600,
  failureThreshold: 5,
  blockDurationSeconds: 3600,
});

// 보너스 xdr-01: 실제 로그인 요청(api/auth/login.mjs)에서 차단 목록을
// 확인하는 추가 검사입니다. src/decider.mjs의 RULE_IDS·규칙이나
// src/verify-login.mjs는 바꾸지 않습니다 — 기존 접근 제어 앞에 붙는
// 별도 부품입니다. 조회가 실패하면 이 기능 때문에 정상 로그인이 막히지
// 않도록 열어 둡니다(fail-open). 그 경우 misconfigured 여부를 콘솔
// 오류로만 남깁니다.
//
// 저장소를 store 인터페이스({ isBlocked(sourceIp, nowMs) })로 주입받습니다.
// 운영에서는 createSupabaseBlocklistStore(실제 Supabase 표), 시험에서는
// createMemoryBlocklistStore(격리된 메모리 표)를 씁니다 — api/auth/login.mjs가
// 실제로 호출하는 것과 똑같은 isSourceBlocked/extractSourceIp를 시험에서도
// 그대로 호출하므로, 저장소만 바뀌고 판정 코드 경로는 같습니다.
//
// recordFailureAndMaybeBlock은 실제 로그인 실패를 xdr_brute_force_failures
// 표(supabase/xdr_login_failures.local.sql, 학생이 직접 실행)에 남기고, 같은
// 출발 주소·계정의 실패가 xdr/brute-force/patterns.json의 failureThreshold를
// 넘으면 xdr_brute_force_blocklist에 차단 규칙을 올립니다 — xdr/brute-force/
// decide.mjs가 오프라인 시험 fixture로 하는 것과 같은 기준을, 실제 로그인 요청에
// 대해서도 적용하는 길입니다. 이 함수가 실패해도(표 없음 등) 로그인 자체는 그대로
// 진행됩니다(fail-open, 콘솔 오류만 남김) — 탐지 부가 기능이 로그인을 막으면 안 되기
// 때문입니다.

// 순수 로직이라 DB 없이도 시험할 수 있습니다.
export function isRowActive(row, nowMs) {
  if (!row) return false;
  const expiresAtMs = Date.parse(row.expires_at);
  if (Number.isNaN(expiresAtMs)) return false;
  return nowMs < expiresAtMs;
}

// 격리된 시험용 저장소입니다 — 실제 Supabase를 전혀 건드리지 않습니다.
// rows: [{ source_ip, expires_at }, ...] (Supabase 표와 같은 모양).
export function createMemoryBlocklistStore(rows = []) {
  const bySourceIp = new Map(rows.map((row) => [row.source_ip, row]));
  return {
    async isBlocked(sourceIp, nowMs) {
      return isRowActive(bySourceIp.get(sourceIp), nowMs);
    },
  };
}

// 운영 저장소입니다 — 기존 서버 환경변수(SUPABASE_URL, SUPABASE_SECRET_KEY)로
// public.xdr_brute_force_blocklist(supabase/xdr_blocklist.local.sql, 학생이
// 직접 실행)를 읽습니다. 이 함수 자체는 조회를 던지기만 하고, 실패 시 어떻게
// 할지는 호출자(isSourceBlocked)가 fail-open으로 정합니다.
export function createSupabaseBlocklistStore({ supabaseUrl, supabaseSecretKey }) {
  if (!supabaseUrl || !supabaseSecretKey) return null;
  return {
    async isBlocked(sourceIp, nowMs) {
      const { createClient } = await import('@supabase/supabase-js');
      const supabase = createClient(supabaseUrl, supabaseSecretKey, {
        auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
      });
      const { data, error } = await supabase
        .from('xdr_brute_force_blocklist')
        .select('expires_at')
        .eq('source_ip', sourceIp)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return isRowActive(data, nowMs);
    },
  };
}

export async function isSourceBlocked({ store, sourceIp, nowMs = Date.now() }) {
  if (!store || !sourceIp) return false;
  try {
    return await store.isBlocked(sourceIp, nowMs);
  } catch (error) {
    console.error('xdr login guard lookup failed (fail-open):', error.message);
    return false;
  }
}

// 로그인 실패 하나를 기록하고, 같은 출발 주소·계정의 실패가 문턱을 넘으면
// xdr_brute_force_blocklist에 차단 규칙을 올립니다. sourceIp가 없으면(헤더를
// 못 읽은 경우) 아무 것도 하지 않습니다 — 누구를 차단할지 알 수 없기 때문입니다.
export async function recordFailureAndMaybeBlock({ supabaseUrl, supabaseSecretKey, sourceIp, account, nowMs = Date.now() }) {
  if (!supabaseUrl || !supabaseSecretKey || !sourceIp || !account) return;
  try {
    const config = LIVE_FAILURE_CONFIG;
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(supabaseUrl, supabaseSecretKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });

    const { error: insertError } = await supabase
      .from('xdr_brute_force_failures')
      .insert({ source_ip: sourceIp, account });
    if (insertError) throw new Error(insertError.message);

    const windowStart = new Date(nowMs - config.windowSeconds * 1000).toISOString();
    const { count, error: countError } = await supabase
      .from('xdr_brute_force_failures')
      .select('id', { count: 'exact', head: true })
      .eq('source_ip', sourceIp)
      .eq('account', account)
      .gte('created_at', windowStart);
    if (countError) throw new Error(countError.message);

    if ((count ?? 0) >= config.failureThreshold) {
      const expiresAt = new Date(nowMs + config.blockDurationSeconds * 1000).toISOString();
      const { error: upsertError } = await supabase
        .from('xdr_brute_force_blocklist')
        .upsert({
          source_ip: sourceIp,
          expires_at: expiresAt,
          basis_alert_ids: ['LIVE-CAPTURE'],
          reason: `실시간 로그인 실패 ${count}회 (repeated_failed_logins_same_source_account)`,
        });
      if (upsertError) throw new Error(upsertError.message);
    }
  } catch (error) {
    console.error('xdr failure capture failed (fail-open, login unaffected):', error.message);
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

// Vercel 공식 문서(https://vercel.com/docs/headers/request-headers, 2025-12-13
// 갱신) 기준:
// - x-forwarded-for: "클라이언트의 공개 IP ... Vercel 앞에 또 다른 프록시를 쓰면
//   이 헤더가 덮어써질 수 있다." 즉 기본값(Enterprise Trusted Proxy 미사용)은
//   Vercel이 통째로 덮어쓰고 클라이언트가 보낸 값을 그대로 전달하지 않는다
//   ("we currently overwrite the X-Forwarded-For header and do not forward
//   external IPs. This restriction is in place to prevent IP spoofing.").
// - x-vercel-forwarded-for: "x-forwarded-for와 동일하지만, x-forwarded-for는
//   Vercel 위에 다른 프록시를 쓰면 덮어써질 수 있다" — 즉 추가 프록시 앞단이
//   있어도 안 바뀌는 쪽은 이 헤더다.
// - x-real-ip: "x-forwarded-for와 동일."
// 이 프로젝트는 Vercel 앞에 별도 프록시를 두지 않지만, 앞으로 생기더라도 안전하게
// x-vercel-forwarded-for를 우선 쓰고, x-forwarded-for, x-real-ip를 차례로
// 대체값으로 둡니다. 세 값 모두 값이 쉼표로 이어진 경우를 대비해 마지막 항목만
// 씁니다(Vercel 쪽에서 덧붙인 값이 끝에 온다는 일반적인 프록시 관례를 보수적으로
// 적용한 것이며, 통상적인 단일 IP 상황에서는 결과가 같습니다).
export function extractSourceIp(request) {
  const headers = request.headers ?? {};
  const candidates = [headers['x-vercel-forwarded-for'], headers['x-forwarded-for'], headers['x-real-ip']];
  for (const raw of candidates) {
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const hops = raw.split(',').map((hop) => hop.trim()).filter(Boolean);
    if (hops.length) return normalizeIp(hops[hops.length - 1]);
  }
  return null;
}
