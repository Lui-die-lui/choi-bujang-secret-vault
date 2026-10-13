import {
  createHash, createHmac, createPublicKey, randomBytes, randomUUID, timingSafeEqual, verify as verifySignature,
} from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decide } from './decider.mjs';

// 11단계: 기기 승인 등록부와 기기 확인의 공통 규칙입니다.
//  - 기기 키는 브라우저 저장소가 아니라 기기의 인증 장치(패스키, WebAuthn) 안에 있습니다.
//    서버는 공개키만 등록부(public.t11_devices)에 두고, 기기가 서버의 일회용 질문에 서명한
//    값을 그 공개키로 검증합니다.
//  - 승인 요청은 등록부에 "pending"으로만 남습니다. "approved"로 바꾸는 것은 관리자가
//    DB에서 직접 하는 일이며, 이 코드에는 상태를 승인으로 바꾸는 요청이 없습니다.
//  - 자료 API는 요청마다 등록부를 다시 조회하고, 그 결과를 판정기(src/decider.mjs)의
//    기기 등록 규칙에 넣어 허용 여부를 받습니다. 허용이 아니면 자료를 조회하지 않습니다.
//  - 공개키·서명·토큰 값은 로그에 남기지 않습니다.
export const DEVICE_TABLE = 't11_devices';
export const DEVICE_SESSION_HEADER = 'x-device-session';
const CHALLENGE_SECONDS = 120;
const SESSION_SECONDS = 30 * 60;
const SUPPORTED_ALGS = new Map([[-7, 'ec'], [-257, 'rsa']]); // ES256, RS256
const CREDENTIAL_ID = /^[A-Za-z0-9_-]{16,1024}$/u;

let appUrl;
try {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  appUrl = new URL(JSON.parse(readFileSync(resolve(moduleDir, '..', 'aleph.config.json'), 'utf8')).publicAppUrl);
} catch {
  appUrl = null;
}
// 서명에 묶이는 앱 주소는 요청 헤더가 아니라 저장소 설정(aleph.config.json)에서만 정합니다.
export const relyingParty = () => (appUrl ? { id: appUrl.hostname, origin: appUrl.origin } : null);

const b64u = data => Buffer.from(data).toString('base64url');
const fromB64u = text => Buffer.from(String(text), 'base64url');
const sha256 = data => createHash('sha256').update(data).digest();
const nowSeconds = () => Math.floor(Date.now() / 1000);
const purposeKey = (secret, purpose) => createHmac('sha256', secret).update(`choi-vault.device.v1.${purpose}`).digest();

// 서버만 만들 수 있는 짧은 수명의 값(일회용 질문, 기기 확인 결과)을 HMAC으로 봉합니다.
function seal(secret, purpose, payload) {
  const body = b64u(JSON.stringify(payload));
  return `${body}.${b64u(createHmac('sha256', purposeKey(secret, purpose)).update(body).digest())}`;
}
function unseal(secret, purpose, token, now) {
  if (typeof token !== 'string' || token.length > 4096) return null;
  const [body, mac, extra] = token.split('.');
  if (!body || !mac || extra !== undefined) return null;
  const expected = createHmac('sha256', purposeKey(secret, purpose)).update(body).digest();
  const given = fromB64u(mac);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let payload;
  try { payload = JSON.parse(fromB64u(body).toString('utf8')); } catch { return null; }
  if (!payload || typeof payload !== 'object' || !Number.isInteger(payload.exp) || payload.exp <= now) return null;
  return payload;
}

export const deviceCode = credentialId => sha256(String(credentialId)).toString('hex').slice(0, 8);
export const userHandle = userId => b64u(sha256(`choi-vault.user.${userId}`).subarray(0, 16));

export function issueChallenge(secret, userId, now = nowSeconds()) {
  const challenge = b64u(randomBytes(32));
  return { challenge, challengeToken: seal(secret, 'challenge', { c: challenge, u: userId, exp: now + CHALLENGE_SECONDS }) };
}
function openChallenge(secret, token, userId, now) {
  const payload = unseal(secret, 'challenge', token, now);
  return payload && payload.u === userId && typeof payload.c === 'string' ? payload.c : null;
}

// 브라우저가 서명에 넣은 내용(종류·질문·앱 주소)이 서버가 기대한 값과 같은지 봅니다.
function readClientData(clientDataJSON, { type, challenge, origin }) {
  let raw;
  let data;
  try {
    raw = fromB64u(clientDataJSON);
    data = JSON.parse(raw.toString('utf8'));
  } catch { return null; }
  if (!data || data.type !== type || data.challenge !== challenge || data.origin !== origin) return null;
  return raw;
}

function importPublicKey(spki, alg) {
  if (!SUPPORTED_ALGS.has(alg) || typeof spki !== 'string' || spki.length > 2048) return null;
  try {
    const key = createPublicKey({ key: fromB64u(spki), format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== SUPPORTED_ALGS.get(alg)) return null;
    if (alg === -7 && key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') return null;
    return key;
  } catch { return null; }
}

// 승인 요청: 기기가 새로 만든 공개키를 등록부에 "pending"으로 올릴 값을 만듭니다.
// 반환: 등록할 행 또는 null(검증 실패). 이 단계는 아무 권한도 주지 않습니다.
export function readApprovalRequest({ secret, userId, body, now = nowSeconds() }) {
  const party = relyingParty();
  if (!party || !body || typeof body !== 'object') return null;
  const challenge = openChallenge(secret, body.challengeToken, userId, now);
  if (!challenge) return null;
  if (!readClientData(body.clientDataJSON, { type: 'webauthn.create', challenge, origin: party.origin })) return null;
  if (typeof body.credentialId !== 'string' || !CREDENTIAL_ID.test(body.credentialId)) return null;
  if (!importPublicKey(body.publicKey, body.alg)) return null;
  return { credential_id: body.credentialId, owner_id: userId, public_key_spki: body.publicKey,
    alg: body.alg, status: 'pending' };
}

// 기기 확인: 등록부의 공개키로 기기의 서명을 검증합니다. 반환: 맞으면 true.
export function verifyDeviceAssertion({ secret, userId, device, body, now = nowSeconds() }) {
  const party = relyingParty();
  if (!party || !device || !body || typeof body !== 'object') return false;
  const challenge = openChallenge(secret, body.challengeToken, userId, now);
  if (!challenge) return false;
  const clientData = readClientData(body.clientDataJSON, { type: 'webauthn.get', challenge, origin: party.origin });
  const key = importPublicKey(device.public_key_spki, device.alg);
  if (!clientData || !key) return false;
  let authenticatorData;
  let signature;
  try {
    authenticatorData = fromB64u(body.authenticatorData);
    signature = fromB64u(body.signature);
  } catch { return false; }
  // 인증 장치 자료: 앞 32바이트는 앱 주소의 해시, 다음 1바이트의 첫 비트는 "사용자가 그 자리에 있음".
  if (authenticatorData.length < 37 || !authenticatorData.subarray(0, 32).equals(sha256(party.id))
      || (authenticatorData[32] & 0x01) !== 0x01) return false;
  try {
    return verifySignature('sha256', Buffer.concat([authenticatorData, sha256(clientData)]), key, signature);
  } catch { return false; }
}

export function issueDeviceSession(secret, userId, credentialId, now = nowSeconds()) {
  const expiresAt = now + SESSION_SECONDS;
  return { deviceSession: seal(secret, 'session', { u: userId, d: credentialId, exp: expiresAt }), expiresAt };
}

// 판정기에 넘기는 요청: docs/DECIDER_REQUEST.md의 18개 이름만 채웁니다. 기기 등록 여부는
// 브라우저가 보낸 값이 아니라 서버가 등록부에서 방금 조회한 결과입니다.
function deviceDecisionRequest({ userId, credentialId, registered }) {
  return {
    schema: 'aleph.decision.v1', requestId: randomUUID(), classId: 'local', projectId: 'choi-bujang-secret-vault',
    subjectId: `u_${sha256(String(userId)).toString('hex').slice(0, 16)}`,
    deviceId: sha256(String(credentialId ?? 'none')).toString('hex').slice(0, 16),
    service: 'notes', method: 'GET', path: '/notes/device-check', route: 'GET /notes/:id',
    queryLength: 0, querySha256: sha256('').toString('hex'), at: new Date().toISOString(), policyRevision: 1,
    deviceRegistered: registered, stepUp: { verified: false, authAgeSeconds: null }, recentEvents: [],
    signals: { source: 'none', region: 'unknown', network: 'unknown', hour: new Date().getUTCHours() },
  };
}

// 자료 API 공통 관문: 로그인 확인 뒤, 자료를 조회하기 전에 부릅니다.
// 기기 확인 결과(헤더)가 없거나, 다른 사용자의 것이거나, 만료됐거나, 등록부에서 승인 상태가
// 아니면 판정기가 거부하고 403을 돌려줍니다. 심판·학생 구분 없이 같은 규칙입니다.
export async function requireRegisteredDevice({ request, identity, supabase, secret, now = nowSeconds() }) {
  const session = unseal(secret, 'session', request.headers?.[DEVICE_SESSION_HEADER], now);
  let registered = false;
  let credentialId = null;
  if (session && session.u === identity.userId && typeof session.d === 'string') {
    credentialId = session.d;
    try {
      const { data, error } = await supabase.from(DEVICE_TABLE).select('credential_id, status')
        .eq('credential_id', credentialId).eq('owner_id', identity.userId).maybeSingle();
      registered = !error && data?.status === 'approved';
    } catch {
      registered = false;
    }
  }
  const verdict = await decide(deviceDecisionRequest({ userId: identity.userId, credentialId, registered }));
  if (verdict.decision === 'allow') return { ok: true };
  console.warn(`device gate denied: reason=${verdict.reasonCode} device=${credentialId ? deviceCode(credentialId) : 'none'}`);
  return { ok: false, status: 403, body: { error: 'device_not_registered' } };
}
