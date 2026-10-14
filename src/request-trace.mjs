import { randomUUID } from 'node:crypto';

// 12단계: 요청 추적 ID. 서버가 요청마다 새로 만든 UUID이며 응답 헤더 X-Request-Id와
// 구조화 로그에 같이 남습니다. 검증 스크립트의 시험 ID와는 별개입니다. 브라우저가 보낸
// x-request-id는 믿지 않고 쓰지 않습니다. Vercel이 붙인 x-vercel-id는 있으면 함께 기록합니다.
const ids = new WeakMap();

export function traceRequest(request, response) {
  let requestId = ids.get(request);
  if (!requestId) {
    requestId = randomUUID();
    ids.set(request, requestId);
  }
  try { response.setHeader('X-Request-Id', requestId); } catch { /* 헤더를 못 붙여도 요청은 계속 */ }
  return requestId;
}

export const requestIdOf = request => ids.get(request) ?? null;
export const platformIdOf = request => {
  const value = request?.headers?.['x-vercel-id'];
  return typeof value === 'string' && value.length <= 128 ? value : null;
};
