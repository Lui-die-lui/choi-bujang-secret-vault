// block 판정만 임시 거부 규칙으로 바꿉니다. src/decider.mjs의 RULE_IDS·규칙과는
// 별도로 관리합니다(판정기 규칙을 대신하지 않음). 여기 함수들은 순수 로직이라
// 파일이나 DB 없이도 시험할 수 있습니다. 로컬 실행(xdr:run)은 JSON 파일에 저장하고,
// 실제 서버 요청 처리는 src/xdr-login-guard.mjs가 Supabase 테이블로 같은 모양을 확인합니다.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export function loadBlocklist(path) {
  if (!existsSync(path)) return [];
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  return Array.isArray(parsed) ? parsed : [];
}

export function saveBlocklist(path, list) {
  writeFileSync(path, `${JSON.stringify(list, null, 2)}\n`, { encoding: 'utf8', flag: 'w' });
}

// 같은 출발 주소에 다시 block이 나와도 규칙을 중복 생성하지 않습니다 — 근거 경보 번호를
// 합치고 만료 시각을 더 늦은 쪽으로만 늘립니다.
export function upsertBlock(list, { sourceIp, expiresAtMs, basisAlertId, reason }) {
  const existingIndex = list.findIndex((entry) => entry.sourceIp === sourceIp);
  if (existingIndex === -1) {
    list.push({
      sourceIp, expiresAtMs, reason,
      basisAlertIds: [basisAlertId],
      createdAtMs: Date.now(),
    });
    return list;
  }
  const existing = list[existingIndex];
  existing.expiresAtMs = Math.max(existing.expiresAtMs, expiresAtMs);
  if (!existing.basisAlertIds.includes(basisAlertId)) existing.basisAlertIds.push(basisAlertId);
  return list;
}

export function isBlocked(list, sourceIp, nowMs) {
  const entry = list.find((item) => item.sourceIp === sourceIp);
  return Boolean(entry) && nowMs < entry.expiresAtMs;
}

export function pruneExpired(list, nowMs) {
  return list.filter((entry) => entry.expiresAtMs > nowMs);
}
