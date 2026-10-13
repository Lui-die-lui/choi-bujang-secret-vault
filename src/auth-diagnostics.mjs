import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeJwt, decodeProtectedHeader } from 'jose';

// 8단계 진단 전용: 401이 "토큰 없음"인지 "토큰은 있는데 검증 실패"인지 구분하기 위해
// Authorization 헤더의 모양만 분류합니다. 서명을 검증하거나 권한을 판단하지 않으며
// (그 일은 src/verify-login.mjs가 합니다), 응답에도 쓰지 않습니다. 토큰 원문과
// 클레임 값은 반환하지 않고 참/거짓·분류 이름만 돌려줍니다.
let config = null;
try {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  config = JSON.parse(readFileSync(resolve(moduleDir, '..', 'aleph.config.json'), 'utf8'));
} catch {
  config = null;
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const BEARER = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/u;

function appHostname() {
  try { return new URL(config.publicAppUrl).hostname; } catch { return null; }
}

export function describeAuthorization(authorization) {
  const result = { present: typeof authorization === 'string' && authorization.length > 0,
    bearer: false, issuer: 'none' };
  if (!result.present) return result;
  const match = typeof authorization === 'string' ? BEARER.exec(authorization) : null;
  if (!match) return { ...result, issuer: 'unparseable' };
  result.bearer = true;

  let payload;
  let header;
  try {
    payload = decodeJwt(match[1]);
    header = decodeProtectedHeader(match[1]);
  } catch {
    return { ...result, issuer: 'unparseable' };
  }
  const now = Math.floor(Date.now() / 1000);
  const expired = Number.isSafeInteger(payload.exp) ? payload.exp <= now : null;
  if (!config) return { ...result, issuer: 'unknown_config', expired };

  if (payload.iss === config.judgeIssuer) {
    // verify-login.mjs는 aud가 이 앱의 호스트명과 문자열로 정확히 같아야 통과시킵니다.
    return { ...result, issuer: 'judge', expired,
      algEs256: header.alg === 'ES256',
      audOk: appHostname() !== null && payload.aud === appHostname(),
      roleJudge: payload.aleph_role === 'judge',
      identityAB: ['a', 'b'].includes(payload.aleph_identity),
      subV4: UUID_V4.test(payload.sub ?? ''),
      runV4: UUID_V4.test(payload.aleph_run ?? ''),
      lifetimeOk: Number.isSafeInteger(payload.iat) && Number.isSafeInteger(payload.exp)
        && payload.exp > payload.iat && payload.exp - payload.iat <= 900 };
  }
  if (payload.iss === config.identityProvider?.issuer) {
    const audiences = [].concat(payload.aud ?? []);
    return { ...result, issuer: 'student', expired,
      audOk: audiences.includes(config.identityProvider.audience),
      roleAuthenticated: payload.role === 'authenticated' };
  }
  return { ...result, issuer: 'other', expired };
}
