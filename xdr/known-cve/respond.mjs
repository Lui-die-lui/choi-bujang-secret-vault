// decide(alert) 결과 가운데 차단 후보만 임시 거부 규칙으로 바꾸고, 모든 경보를 xdr/alerts.log에
// 한 줄씩 남깁니다. decide.mjs는 판단 결과만 돌려주고, 파일 쓰기와 규칙 만들기는 이 파일만 합니다.
//
// 거부 규칙 조건(모두 만족해야 함)
//  - action이 block이고 출발 주소·경보 번호·시각이 모두 확인됨(누구를 어떤 근거로 막는지 모르면 제외)
//  - 같은 묶음에서 같은 출발 주소로 record(정상 기록) 판단이 나온 주소는 제외하고 알림만 남김
//    (여러 사용자가 한 주소를 공유하는 경우 정상 사용자를 막지 않기 위한 안전장치)
//  - alert·record는 규칙으로 올라가지 않음
// 규칙은 출발 주소당 하나이며 근거 경보 번호와 만료 시각을 가집니다. 같은 경보를 다시 흘려도
// 근거가 늘지 않고 만료도 연장되지 않습니다(새 근거 경보가 추가될 때만 만료를 새로 셈).
//
// (연결 범위) 규칙은 로컬 파일 xdr/known-cve/blocklist.json에만 저장됩니다. src/decider.mjs의
// 요청 계약(docs/DECIDER_REQUEST.md)에는 출발 주소도 요청 머리글·쿼리 원문도 없어 이 규칙을 판정기
// 규칙으로 대조할 수 없습니다. 출발 주소로 거부하는 기존 경로는 로그인 전용(src/xdr-login-guard.mjs,
// 무차별 로그인 보너스의 표)뿐이며 이 모듈은 거기에 연결하지 않았습니다. 판정기 규칙(RULE_IDS)은
// 건드리지 않습니다.
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decide } from './decide.mjs';
import { loadBlocklist, pruneExpired, saveBlocklist } from '../brute-force/block-rules.mjs';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(moduleDir, '..', '..');
const DEFAULT_FIXTURE_PATH = resolve(root, 'xdr', 'fixtures', 'known-cve.json');
const DEFAULT_BLOCKLIST_PATH = resolve(moduleDir, 'blocklist.json');
const DEFAULT_LOG_PATH = resolve(root, 'xdr', 'alerts.log');
const DEFAULT_EXPECTED_PATH = resolve(root, 'xdr', 'fixtures', 'known-cve.expected.json');

export const BLOCK_DURATION_SECONDS = 3600;
const LOG_MODULE = 'known-cve';
const GROUP_OF_LABEL = { benign: 'normal', attack: 'clear', ambiguous: 'ambiguous' };

function loadGroups(expectedPath) {
  const groups = { normal: [], clear: [], ambiguous: [] };
  if (!existsSync(expectedPath)) return groups;
  const byAlertId = JSON.parse(readFileSync(expectedPath, 'utf8')).byAlertId ?? {};
  for (const [alertId, label] of Object.entries(byAlertId)) {
    const group = GROUP_OF_LABEL[label];
    if (group) groups[group].push(alertId);
  }
  return groups;
}

function isOwnLogLine(line) {
  try {
    return JSON.parse(line)?.module === LOG_MODULE;
  } catch {
    return false;
  }
}

// 알림·규칙에 쓸 항목만 남깁니다. 요청 머리글·주소는 decide()에만 넘기고 꺼내 담지 않습니다.
function judgeOne(rawAlert) {
  const outcome = decide(rawAlert);
  const timeMs = Date.parse(rawAlert?.timestamp);
  return {
    alertId: typeof rawAlert?.id === 'string' ? rawAlert.id : null,
    time: Number.isNaN(timeMs) ? null : rawAlert.timestamp,
    timeMs: Number.isNaN(timeMs) ? null : timeMs,
    sourceIp: typeof rawAlert?.data?.srcip === 'string' ? rawAlert.data.srcip : null,
    action: outcome.action,
    confidence: outcome.confidence,
    reason: outcome.reason,
  };
}

// 규칙으로 올릴 block 후보를 출발 주소별로 모읍니다.
export function collectBlockCandidates(judged) {
  const recordIps = new Set(judged.filter((item) => item.action === 'record' && item.sourceIp).map((item) => item.sourceIp));
  const bySourceIp = new Map();
  const heldBackAlertIds = [];
  for (const item of judged) {
    if (item.action !== 'block') continue;
    if (!item.sourceIp || !item.alertId || item.timeMs === null) continue;
    if (recordIps.has(item.sourceIp)) {
      heldBackAlertIds.push(item.alertId);
      continue;
    }
    const group = bySourceIp.get(item.sourceIp) ?? new Map();
    if (!group.has(item.alertId)) group.set(item.alertId, item);
    bySourceIp.set(item.sourceIp, group);
  }
  const candidates = [...bySourceIp].map(([sourceIp, group]) => ({ sourceIp, items: [...group.values()] }));
  return { candidates, heldBackAlertIds };
}

// 같은 근거 경보만 다시 오면 아무것도 바꾸지 않고, 새 근거가 있을 때만 근거를 합치고 만료를 새로 셉니다.
export function upsertRule(list, { sourceIp, expiresAtMs, basisAlertId, reason }, nowMs) {
  const existing = list.find((entry) => entry.sourceIp === sourceIp);
  if (!existing) {
    list.push({ sourceIp, expiresAtMs, reason, basisAlertIds: [basisAlertId], createdAtMs: nowMs });
    return 'created';
  }
  if (existing.basisAlertIds.includes(basisAlertId)) return 'unchanged';
  existing.basisAlertIds.push(basisAlertId);
  existing.expiresAtMs = Math.max(existing.expiresAtMs, expiresAtMs);
  return 'extended';
}

export function respond({
  fixturePath = DEFAULT_FIXTURE_PATH,
  blocklistPath = DEFAULT_BLOCKLIST_PATH,
  logPath = DEFAULT_LOG_PATH,
  expectedPath = DEFAULT_EXPECTED_PATH,
  nowMs = Date.now(),
} = {}) {
  const raw = JSON.parse(readFileSync(fixturePath, 'utf8'));
  if (!Array.isArray(raw?.alerts)) throw new TypeError('invalid_fixture_shape');

  const judged = raw.alerts.map(judgeOne);
  const counts = { block: 0, alert: 0, record: 0 };
  for (const item of judged) counts[item.action] += 1;

  const blocklist = pruneExpired(loadBlocklist(blocklistPath), nowMs);
  const { candidates, heldBackAlertIds } = collectBlockCandidates(judged);
  const expiresAtMs = nowMs + BLOCK_DURATION_SECONDS * 1000;
  const ruleChanges = { created: 0, extended: 0, unchanged: 0 };
  for (const { sourceIp, items } of candidates) {
    for (const item of items) {
      ruleChanges[upsertRule(blocklist, { sourceIp, expiresAtMs, basisAlertId: item.alertId, reason: item.reason }, nowMs)] += 1;
    }
  }
  saveBlocklist(blocklistPath, blocklist);

  const ruleSourceIps = new Set(candidates.map((candidate) => candidate.sourceIp));
  const logLines = judged.map((item) => JSON.stringify({
    module: LOG_MODULE,
    time: item.time,
    sourceIp: item.sourceIp,
    action: item.action,
    confidence: item.confidence,
    reason: item.reason,
    basisAlertId: item.alertId,
    denyRule: item.action === 'block' && ruleSourceIps.has(item.sourceIp),
  }));
  // 알림 기록은 다른 모듈과 함께 쓰는 파일입니다. 이 모듈이 전에 남긴 줄만 이번 실행의 줄로
  // 바꾸고 다른 모듈의 줄은 그대로 둡니다(다시 실행해도 같은 경보가 겹쳐 쌓이지 않음).
  const otherLines = existsSync(logPath)
    ? readFileSync(logPath, 'utf8').split(/\r?\n/u).filter((line) => line !== '' && !isOwnLogLine(line))
    : [];
  writeFileSync(logPath, `${[...otherLines, ...logLines].join('\n')}\n`, 'utf8');

  return {
    totalAlerts: raw.alerts.length,
    loggedLines: judged.length,
    counts,
    decisions: judged.map(({ timeMs, ...rest }) => rest),
    blocklist,
    ruleSourceIps: [...ruleSourceIps],
    heldBackAlertIds,
    ruleChanges,
    processedAtMs: nowMs,
    groups: loadGroups(expectedPath),
  };
}

// node xdr/known-cve/respond.mjs 로 단독 실행하면 기본 시험 경보로 규칙과 알림을 만들고 결과를 요약합니다.
const isMainModule = process.argv[1]
  && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  const result = respond();
  const { counts, blocklist } = result;
  process.stdout.write(
    `respond 실행 완료 · 전체 ${result.totalAlerts}건 · 알림 ${result.loggedLines}줄 · block ${counts.block} · alert ${counts.alert} · record ${counts.record} · 거부 규칙 ${blocklist.length}건 (신규 ${result.ruleChanges.created} · 근거 추가 ${result.ruleChanges.extended} · 변경 없음 ${result.ruleChanges.unchanged})\n`,
  );
  for (const entry of blocklist) {
    process.stdout.write(`  규칙 · ${entry.sourceIp} · 만료 ${new Date(entry.expiresAtMs).toISOString()} · 근거 ${entry.basisAlertIds.join(',')}\n`);
  }
  if (result.loggedLines !== result.totalAlerts) process.exitCode = 1;
}
