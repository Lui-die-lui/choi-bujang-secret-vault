// decide(alert) 결과 가운데 차단 후보만 임시 거부 규칙(목적지 후보)으로 바꾸고, 모든 경보를
// xdr/alerts.log에 한 줄씩 남깁니다. decide.mjs는 판단 결과만 돌려주고, 파일 쓰기와 규칙 만들기는
// 이 파일만 합니다.
//
// 이번 차단 대상은 유출 "목적지"(data.dstip)입니다. 출발 주소(data.srcip, 전송을 시작한 PC)와
// 구분해 다루며 출발 PC를 목적지로 등록하지 않습니다. 수집 에이전트의 주소는 경보에 없습니다
// (agent에는 이름만 있음).
//
// 거부 규칙 조건(모두 만족해야 함, 하나라도 빠지면 규칙을 만들지 않고 이유를 기록)
//  - action이 block이고 경보 번호·시각이 확인됨
//  - 목적지가 있고 올바른 IPv4 주소 형식이며 출발 주소와 같지 않음(no_destination / invalid_destination /
//    destination_is_source)
//  - 같은 묶음에서 그 목적지로 정상(record) 판단이 나오지 않음(shared_with_normal_event). 공유 서비스를
//    통째로 막지 않기 위한 안전장치이며, 이 묶음 밖의 정상 사용 여부는 알 수 없습니다.
//  - alert·record는 규칙으로 올라가지 않음
// 규칙은 목적지 주소 하나당 하나이며(도메인·대역·출발 주소 전체로 넓히지 않음) 근거 경보 번호와 만료
// 시각을 가집니다. 같은 경보를 다시 흘려도 근거가 늘지 않고 만료도 연장되지 않습니다(새 근거 경보가
// 추가될 때만 만료를 새로 셈).
//
// (연결 범위) 세 단계를 구분합니다.
//  1) 규칙 파일 생성: 이 모듈이 xdr/exfiltration/blocklist.json에 만듭니다(가능, 아래 실행 결과).
//  2) 판정기 적용: 불가. src/decider.mjs의 요청 계약(docs/DECIDER_REQUEST.md)에는 목적지 필드가 없고,
//     계약에 없는 필드를 만들어 읽지 않습니다. 판정기 규칙(RULE_IDS)은 건드리지 않습니다.
//  3) 실제 네트워크 전송 차단: 불가. 이 저장소는 자료를 제공하는 인바운드 서비스이며 PC의 아웃바운드
//     전송을 중계하거나 차단하는 경로가 없습니다. 자료 API의 인바운드 거부는 아웃바운드 전송 차단과
//     같지 않습니다. 이 모듈은 실제 외부 서버로 파일이나 개인정보를 보내지 않습니다.
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decide } from './decide.mjs';
import { loadBlocklist, pruneExpired, saveBlocklist } from '../brute-force/block-rules.mjs';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(moduleDir, '..', '..');
const DEFAULT_FIXTURE_PATH = resolve(root, 'xdr', 'fixtures', 'exfiltration.json');
const DEFAULT_BLOCKLIST_PATH = resolve(moduleDir, 'blocklist.json');
const DEFAULT_LOG_PATH = resolve(root, 'xdr', 'alerts.log');
const DEFAULT_EXPECTED_PATH = resolve(root, 'xdr', 'fixtures', 'exfiltration.expected.json');

export const BLOCK_DURATION_SECONDS = 3600;
const LOG_MODULE = 'exfiltration';
const GROUP_OF_LABEL = { benign: 'normal', attack: 'clear', ambiguous: 'ambiguous' };
const IPV4 = /^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/u;

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

// 알림·규칙에 쓸 항목만 남깁니다. 전송량·파일 이름 등은 decide()에만 넘기고 꺼내 담지 않습니다.
function judgeOne(rawAlert) {
  const outcome = decide(rawAlert);
  const timeMs = Date.parse(rawAlert?.timestamp);
  const data = rawAlert?.data;
  return {
    alertId: typeof rawAlert?.id === 'string' ? rawAlert.id : null,
    time: Number.isNaN(timeMs) ? null : rawAlert.timestamp,
    timeMs: Number.isNaN(timeMs) ? null : timeMs,
    sourceIp: typeof data?.srcip === 'string' ? data.srcip : null,
    destinationIp: typeof data?.dstip === 'string' ? data.dstip : null,
    action: outcome.action,
    confidence: outcome.confidence,
    reason: outcome.reason,
  };
}

// 규칙으로 올릴 block 후보를 목적지별로 모으고, 올리지 못한 block의 이유를 남깁니다.
export function collectBlockCandidates(judged) {
  const recordDestinations = new Set(
    judged.filter((item) => item.action === 'record' && item.destinationIp).map((item) => item.destinationIp),
  );
  const byDestination = new Map();
  const unresolved = [];
  for (const item of judged) {
    if (item.action !== 'block') continue;
    let why = null;
    if (!item.alertId || item.timeMs === null) why = 'missing_alert_id_or_time';
    else if (!item.destinationIp) why = 'no_destination';
    else if (!IPV4.test(item.destinationIp)) why = 'invalid_destination';
    else if (item.destinationIp === item.sourceIp) why = 'destination_is_source';
    else if (recordDestinations.has(item.destinationIp)) why = 'shared_with_normal_event';
    if (why) {
      unresolved.push({ alertId: item.alertId, reason: why });
      continue;
    }
    const group = byDestination.get(item.destinationIp) ?? new Map();
    if (!group.has(item.alertId)) group.set(item.alertId, item);
    byDestination.set(item.destinationIp, group);
  }
  const candidates = [...byDestination].map(([destinationIp, group]) => ({ destinationIp, items: [...group.values()] }));
  return { candidates, unresolved };
}

// 같은 근거 경보만 다시 오면 아무것도 바꾸지 않고, 새 근거가 있을 때만 근거를 합치고 만료를 새로 셉니다.
export function upsertRule(list, { destinationIp, expiresAtMs, basisAlertId, reason }, nowMs) {
  const existing = list.find((entry) => entry.destinationIp === destinationIp);
  if (!existing) {
    list.push({ destinationIp, expiresAtMs, reason, basisAlertIds: [basisAlertId], createdAtMs: nowMs });
    return 'created';
  }
  if (existing.basisAlertIds.includes(basisAlertId)) return 'unchanged';
  existing.basisAlertIds.push(basisAlertId);
  existing.expiresAtMs = Math.max(existing.expiresAtMs, expiresAtMs);
  return 'extended';
}

export function isDestinationBlocked(list, destinationIp, nowMs) {
  const entry = list.find((item) => item.destinationIp === destinationIp);
  return Boolean(entry) && nowMs < entry.expiresAtMs;
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
  const { candidates, unresolved } = collectBlockCandidates(judged);
  const expiresAtMs = nowMs + BLOCK_DURATION_SECONDS * 1000;
  const ruleChanges = { created: 0, extended: 0, unchanged: 0 };
  for (const { destinationIp, items } of candidates) {
    for (const item of items) {
      ruleChanges[upsertRule(blocklist, { destinationIp, expiresAtMs, basisAlertId: item.alertId, reason: item.reason }, nowMs)] += 1;
    }
  }
  saveBlocklist(blocklistPath, blocklist);

  const ruleDestinations = new Set(candidates.map((candidate) => candidate.destinationIp));
  const unresolvedById = new Map(unresolved.map((item) => [item.alertId, item.reason]));
  const logLines = judged.map((item) => JSON.stringify({
    module: LOG_MODULE,
    time: item.time,
    sourceIp: item.sourceIp,
    destinationIp: item.destinationIp,
    action: item.action,
    confidence: item.confidence,
    reason: item.reason,
    basisAlertId: item.alertId,
    denyRule: item.action === 'block' && ruleDestinations.has(item.destinationIp) && !unresolvedById.has(item.alertId),
    ...(item.action === 'block' && unresolvedById.has(item.alertId) ? { ruleSkipped: unresolvedById.get(item.alertId) } : {}),
  }));
  // 알림 기록은 다른 모듈과 함께 쓰는 파일입니다. 이 모듈이 전에 남긴 줄만 이번 실행의 줄로 바꾸고
  // 다른 모듈의 줄은 그대로 둡니다(다시 실행해도 같은 경보가 겹쳐 쌓이지 않음).
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
    ruleDestinations: [...ruleDestinations],
    unresolvedBlocks: unresolved,
    ruleChanges,
    processedAtMs: nowMs,
    groups: loadGroups(expectedPath),
  };
}

// node xdr/exfiltration/respond.mjs 로 단독 실행하면 기본 시험 경보로 규칙과 알림을 만들고 요약합니다.
const isMainModule = process.argv[1]
  && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  const result = respond();
  const { counts, blocklist } = result;
  process.stdout.write(
    `respond 실행 완료 · 전체 ${result.totalAlerts}건 · 알림 ${result.loggedLines}줄 · block ${counts.block} · alert ${counts.alert} · record ${counts.record} · 목적지 거부 규칙 ${blocklist.length}건 (신규 ${result.ruleChanges.created} · 근거 추가 ${result.ruleChanges.extended} · 변경 없음 ${result.ruleChanges.unchanged})\n`,
  );
  for (const entry of blocklist) {
    process.stdout.write(`  규칙 · 만료 ${new Date(entry.expiresAtMs).toISOString()} · 근거 ${entry.basisAlertIds.join(',')}\n`);
  }
  if (result.loggedLines !== result.totalAlerts) process.exitCode = 1;
}
