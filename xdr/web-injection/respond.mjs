// decide(alert) 결과 가운데 차단 후보만 임시 거부 규칙으로 바꾸고, 모든 경보를
// xdr/alerts.log에 한 줄씩 남깁니다. decide.mjs는 판단 결과만 돌려주고, 파일 쓰기와
// 규칙 만들기는 이 파일만 합니다.
//
// 거부 규칙은 같은 출발 주소에서 서로 다른 경보 번호로 block 후보가 2건 이상 확인된
// 경우에만 만듭니다. alert·record 결과와 block 후보가 1건뿐인 주소는 규칙에 넣지 않습니다.
// 규칙의 모양·중복 방지·만료 방식은 xdr/brute-force/block-rules.mjs를 그대로 따릅니다
// (출발 주소당 규칙 하나, 근거 경보 번호 합치기, 만료 시각은 더 늦은 쪽으로만 늘림).
//
// (연결 범위) 규칙은 로컬 파일 xdr/web-injection/blocklist.json에만 저장되고, 실제 요청을
// 막는 곳에는 아직 연결되어 있지 않습니다. src/decider.mjs의 요청 계약
// (docs/DECIDER_REQUEST.md)에는 출발 주소도 쿼리 원문도 없어 이 규칙을 대조할 수 없고,
// 출발 주소로 거부하는 기존 경로는 로그인 전용(src/xdr-login-guard.mjs)뿐이라 웹 주입
// 규칙을 거기에 넣지 않았습니다. 판정기 규칙(RULE_IDS)도 건드리지 않습니다.
import { appendFileSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decide } from './decide.mjs';
import { isBlocked, loadBlocklist, pruneExpired, saveBlocklist, upsertBlock } from '../brute-force/block-rules.mjs';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(moduleDir, '..', '..');
const DEFAULT_FIXTURE_PATH = resolve(root, 'xdr', 'fixtures', 'web-injection.json');
const DEFAULT_BLOCKLIST_PATH = resolve(moduleDir, 'blocklist.json');
const DEFAULT_LOG_PATH = resolve(root, 'xdr', 'alerts.log');

// xdr/brute-force/run.mjs의 임시 거부 규칙과 같은 만료 길이입니다. 다만 만료 시각은
// 경보 시각이 아니라 respond 처리 시각(nowMs)에서 셉니다 — 경보 시각이 과거면 규칙이
// 만들어지자마자 만료되기 때문입니다.
const BLOCK_DURATION_SECONDS = 3600;
const MIN_DISTINCT_BLOCK_ALERTS = 2;

// 경보 한 건을 판단해 알림·규칙에 쓸 항목만 남깁니다. 요청 주소(data.url)와 인자는
// decide()에만 넘기고 여기서는 꺼내 담지 않습니다.
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

// block 후보를 출발 주소별로 모아, 서로 다른 경보 번호가 2건 이상인 주소만 돌려줍니다.
// 출발 주소·경보 번호·시각 중 하나라도 없는 후보는 누구를 언제까지 막을지 알 수 없어 뺍니다.
export function collectBlockCandidates(judged) {
  const bySourceIp = new Map();
  for (const item of judged) {
    if (item.action !== 'block') continue;
    if (!item.sourceIp || !item.alertId || item.timeMs === null) continue;
    const group = bySourceIp.get(item.sourceIp) ?? new Map();
    if (!group.has(item.alertId)) group.set(item.alertId, item);
    bySourceIp.set(item.sourceIp, group);
  }
  const candidates = [];
  for (const [sourceIp, group] of bySourceIp) {
    if (group.size < MIN_DISTINCT_BLOCK_ALERTS) continue;
    candidates.push({ sourceIp, items: [...group.values()] });
  }
  return candidates;
}

export function respond({
  fixturePath = DEFAULT_FIXTURE_PATH,
  blocklistPath = DEFAULT_BLOCKLIST_PATH,
  logPath = DEFAULT_LOG_PATH,
  nowMs = Date.now(),
} = {}) {
  const raw = JSON.parse(readFileSync(fixturePath, 'utf8'));
  if (!Array.isArray(raw?.alerts)) throw new TypeError('invalid_fixture_shape');

  const judged = raw.alerts.map(judgeOne);
  const counts = { block: 0, alert: 0, record: 0 };
  for (const item of judged) counts[item.action] += 1;

  let blocklist = pruneExpired(loadBlocklist(blocklistPath), nowMs);
  const candidates = collectBlockCandidates(judged);
  const expiresAtMs = nowMs + BLOCK_DURATION_SECONDS * 1000;
  for (const { sourceIp, items } of candidates) {
    for (const item of items) {
      upsertBlock(blocklist, {
        sourceIp,
        expiresAtMs,
        basisAlertId: item.alertId,
        reason: item.reason,
      });
    }
  }
  saveBlocklist(blocklistPath, blocklist);

  const ruleSourceIps = new Set(candidates.map((candidate) => candidate.sourceIp));
  for (const item of judged) {
    const logLine = JSON.stringify({
      module: 'web-injection',
      time: item.time,
      sourceIp: item.sourceIp,
      action: item.action,
      confidence: item.confidence,
      reason: item.reason,
      basisAlertId: item.alertId,
      denyRule: item.action === 'block' && ruleSourceIps.has(item.sourceIp),
    });
    appendFileSync(logPath, `${logLine}\n`, 'utf8');
  }

  return {
    totalAlerts: raw.alerts.length,
    loggedLines: judged.length,
    counts,
    decisions: judged.map(({ timeMs, ...rest }) => rest),
    blocklist,
    ruleSourceIps: [...ruleSourceIps],
    processedAtMs: nowMs,
    groups: raw._groups ?? {},
  };
}

// node xdr/web-injection/respond.mjs 로 단독 실행하면 기본 시험 경보를 흘려 규칙과 알림을
// 만들고, 명확한 공격만 막히고 정상 경보의 출발 주소는 막히지 않는지 로컬 규칙 파일
// 기준으로 확인합니다. 다른 모듈이 불러 쓸 때는 실행되지 않습니다.
const isMainModule = process.argv[1]
  && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  const result = respond();
  const { counts, blocklist, decisions, groups } = result;
  process.stdout.write(
    `respond 실행 완료 · 전체 ${result.totalAlerts}건 · 알림 ${result.loggedLines}줄 · block ${counts.block} · alert ${counts.alert} · record ${counts.record} · 거부 규칙 ${blocklist.length}건\n`,
  );
  for (const entry of blocklist) {
    process.stdout.write(`  규칙 · ${entry.sourceIp} · 만료 ${new Date(entry.expiresAtMs).toISOString()} · 근거 ${entry.basisAlertIds.join(',')}\n`);
  }

  // 처리 시각 기준으로 묶음별 출발 주소를 대조하고, 만료 뒤(처리 시각 + 1시간 + 1초)에는
  // 같은 주소가 더는 막히지 않는지도 봅니다.
  const checkAtMs = result.processedAtMs;
  const afterExpiryMs = checkAtMs + BLOCK_DURATION_SECONDS * 1000 + 1000;
  const blockedIdsOf = (group, atMs) => decisions
    .filter((item) => (groups[group] ?? []).includes(item.alertId) && isBlocked(blocklist, item.sourceIp, atMs))
    .map((item) => item.alertId);
  const normalBlocked = blockedIdsOf('normal', checkAtMs);
  const ambiguousBlocked = blockedIdsOf('ambiguous', checkAtMs);
  const clearBlocked = blockedIdsOf('clear', checkAtMs);
  const clearBlockedAfterExpiry = blockedIdsOf('clear', afterExpiryMs);
  process.stdout.write(`  처리 시각 기준 · 정상 경보 중 막힌 건 ${normalBlocked.length}건 · 애매한 경보 중 막힌 건 ${ambiguousBlocked.length}건 · 명확한 공격 중 막힌 건 ${clearBlocked.length}건(${clearBlocked.join(',')})\n`);
  process.stdout.write(`  만료 뒤 기준 · 명확한 공격 중 막힌 건 ${clearBlockedAfterExpiry.length}건\n`);
  process.stdout.write('  연결 범위 · 규칙은 로컬 blocklist.json에만 있고 실제 요청 처리에는 연결되지 않았습니다.\n');
  if (
    result.loggedLines !== result.totalAlerts
    || normalBlocked.length > 0
    || ambiguousBlocked.length > 0
    || clearBlockedAfterExpiry.length > 0
    || (blocklist.length > 0 && clearBlocked.length === 0)
  ) {
    process.exitCode = 1;
  }
}
