import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLoginVerifier } from './verify-login.mjs';

let config;
let configError;
try {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  config = JSON.parse(readFileSync(resolve(moduleDir, '..', 'aleph.config.json'), 'utf8'));
} catch (error) {
  configError = error;
}

let verifyLoginAuthorization;

// 자료 API 공통 진입점: Authorization 헤더를 src/verify-login.mjs(미수정)로
// 검증합니다. 브라우저가 보낸 userId·role은 쓰지 않고, 서버가 검증한
// identity만 호출자에게 돌려줍니다.
export async function verifyRequestLogin(request, supabaseSecretKey) {
  if (configError) {
    console.error('notes auth misconfigured: aleph.config.json load failed:', configError.message);
    return { ok: false, status: 500, body: { error: 'server_not_configured' } };
  }
  if (!verifyLoginAuthorization) {
    try {
      verifyLoginAuthorization = createLoginVerifier({ config, supabaseSecretKey });
    } catch (error) {
      console.error('login verifier misconfigured:', error.message);
      return { ok: false, status: 500, body: { error: 'server_not_configured' } };
    }
  }
  const identity = await verifyLoginAuthorization(request.headers.authorization);
  if (!identity) return { ok: false, status: 401, body: { error: 'unauthorized' } };
  return { ok: true, identity };
}
