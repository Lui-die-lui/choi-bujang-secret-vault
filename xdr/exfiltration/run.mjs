// npm run xdr:run -- exfiltration 로 실행합니다.
// xdr/fixtures/exfiltration.json(운영 측 연습 경보)을 respond()로 한 번 흘려 판단·알림·로컬 목적지
// 거부 규칙을 만들고 xdr/exfiltration/result.json에 경보별 판단과 counts, 확인 결과를 씁니다.
// schema·moduleKey·decisions·counts는 운영 측 실행기(scripts/xdr-run.mjs)의 aleph.xdr.result.v1 모양을
// 따르고, 나머지 항목은 로컬 확인용입니다. 이 실행은 전부 로컬 파일에서만 일어나며 네트워크를 쓰지
// 않고 실제 외부 서버로 아무것도 보내지 않습니다.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { respond, BLOCK_DURATION_SECONDS, isDestinationBlocked } from './respond.mjs';
import { readAlerts } from './read-alerts.mjs';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(moduleDir, '..', '..');
const resultPath = resolve(moduleDir, 'result.json');
const fixturePath = resolve(root, 'xdr', 'fixtures', 'exfiltration.json');
const EXPECTED_ACTION = { normal: 'record', clear: 'block', ambiguous: 'alert' };

// decide.mjs 맨 위의 PATTERNS 상수와 patterns.json이 같은 이름·확신도를 가지는지 확인합니다.
function checkPatternSync() {
  const source = readFileSync(resolve(moduleDir, 'decide.mjs'), 'utf8');
  const inSource = [...source.matchAll(/name:\s*'([a-z_]+)',\s*confidence:\s*([0-9.]+),/gu)]
    .map((m) => `${m[1]}=${Number(m[2])}`);
  const patterns = JSON.parse(readFileSync(resolve(moduleDir, 'patterns.json'), 'utf8')).patterns;
  const inJson = patterns.map((p) => `${p.name}=${p.confidence}`);
  const missingReference = patterns
    .filter((p) => typeof p.reference !== 'string' || p.reference.trim() === '')
    .map((p) => p.name);
  return {
    inSync: inSource.length === inJson.length && inSource.every((value, i) => value === inJson[i]),
    patternCount: inJson.length,
    missingReference,
  };
}

export async function run() {
  const patternSync = checkPatternSync();
  const reader = readAlerts(fixturePath);
  const {
    totalAlerts, loggedLines, counts, decisions, blocklist, ruleDestinations, unresolvedBlocks, ruleChanges,
    processedAtMs, groups,
  } = respond();
  if (loggedLines !== totalAlerts || reader.originalCount !== totalAlerts) {
    throw new Error('원본 경보 건수와 읽기·알림 줄 수가 다릅니다.');
  }
  if (!patternSync.inSync || patternSync.missingReference.length) {
    throw new Error('decide.mjs의 PATTERNS와 patterns.json이 다르거나 근거가 비어 있는 패턴이 있습니다.');
  }

  const groupOf = (alertId) => Object.keys(EXPECTED_ACTION).find((group) => (groups[group] ?? []).includes(alertId));
  const hasLabels = ['normal', 'clear', 'ambiguous'].some((group) => (groups[group] ?? []).length > 0);
  const normalDecisions = decisions.filter((item) => groupOf(item.alertId) === 'normal');
  const falsePositives = normalDecisions.filter((item) => item.action === 'block').map((item) => item.alertId);
  // 정상 이벤트(목적지가 있는 것)의 목적지가 거부 규칙에 들어갔는지, 출발 주소가 목적지로 등록됐는지 봅니다.
  const normalInDenyRules = normalDecisions
    .filter((item) => item.destinationIp && isDestinationBlocked(blocklist, item.destinationIp, processedAtMs))
    .map((item) => item.alertId);
  const sourceRegisteredAsDestination = decisions
    .filter((item) => item.sourceIp && isDestinationBlocked(blocklist, item.sourceIp, processedAtMs))
    .map((item) => item.alertId);
  const labelMismatches = decisions
    .filter((item) => groupOf(item.alertId) && EXPECTED_ACTION[groupOf(item.alertId)] !== item.action)
    .map((item) => item.alertId);

  const blockAlertIds = new Set(decisions.filter((item) => item.action === 'block').map((item) => item.alertId));
  const nonBlockInRules = blocklist.flatMap((entry) => entry.basisAlertIds).filter((id) => !blockAlertIds.has(id));
  const afterExpiryMs = processedAtMs + BLOCK_DURATION_SECONDS * 1000 + 1000;
  const blockedAfterExpiry = decisions.filter(
    (item) => item.destinationIp && isDestinationBlocked(blocklist, item.destinationIp, afterExpiryMs),
  ).length;

  const rulesThisRun = blocklist.filter((entry) => ruleDestinations.includes(entry.destinationIp));
  const result = {
    schema: 'aleph.xdr.result.v1',
    moduleKey: 'exfiltration',
    decisions: decisions.map(({ alertId, action, confidence, reason }) => ({ alertId, action, confidence, reason })),
    counts,
    generatedAt: new Date(processedAtMs).toISOString(),
    totalAlerts,
    readAlertsRows: reader.originalCount,
    loggedLinesThisRun: loggedLines,
    countsSum: counts.block + counts.alert + counts.record,
    patternsInSyncWithDecide: patternSync.inSync,
    patternCount: patternSync.patternCount,
    labelsAvailable: hasLabels,
    falsePositiveCount: falsePositives.length,
    falsePositiveAlertIds: falsePositives,
    normalInDenyRuleCount: normalInDenyRules.length,
    normalInDenyRuleAlertIds: normalInDenyRules,
    sourceRegisteredAsDestinationCount: sourceRegisteredAsDestination.length,
    labelMismatchAlertIds: labelMismatches,
    nonBlockBasisInRulesCount: nonBlockInRules.length,
    activeRuleCountAfterExpiry: blockedAfterExpiry,
    unresolvedBlocks,
    ruleChangesThisRun: ruleChanges,
    blockRuleCount: rulesThisRun.length,
    blockRules: rulesThisRun.map((entry) => ({
      expiresAt: new Date(entry.expiresAtMs).toISOString(),
      basisAlertIds: entry.basisAlertIds,
    })),
    connection: {
      ruleFile: { state: 'created', path: 'xdr/exfiltration/blocklist.json', ruleCount: blocklist.length },
      judgeApplied: {
        state: 'not_possible',
        reason: '판정기 요청 계약(docs/DECIDER_REQUEST.md)에 목적지 필드가 없고 계약에 없는 필드는 만들어 읽지 않습니다.',
      },
      networkBlock: {
        state: 'not_possible',
        reason: '이 저장소는 자료를 제공하는 인바운드 서비스이며 PC의 아웃바운드 전송을 중계하거나 차단하는 경로가 없습니다. 자료 API의 인바운드 거부는 아웃바운드 전송 차단과 같지 않습니다.',
      },
    },
    note: '운영 측 연습 경보 기준의 로컬 결과입니다. 정상 오차단은 직접 붙인 묶음 표시(exfiltration.expected.json, 심판의 정답표가 아님) 기준으로만 셉니다. 큰 전송 기준(50,000,000 바이트)은 과제 제공 기준이 아니라 구현상 휴리스틱입니다. 규칙은 xdr/exfiltration/blocklist.json(목적지 후보)에만 있고 학생 판정기(src/decider.mjs)나 실제 네트워크 전송 경로에는 연결되지 않았습니다. 심판 판정 결과가 아닙니다.',
  };
  writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, { encoding: 'utf8', flag: 'w' });

  process.stdout.write(
    `xdr exfiltration 실행 완료 · 전체 ${totalAlerts}건 · block ${counts.block} · alert ${counts.alert} · record ${counts.record} · 정상 이벤트 block 판정 ${falsePositives.length}건 · 정상 이벤트 목적지 규칙 포함 ${normalInDenyRules.length}건 · 묶음 표시와 다른 판단 ${labelMismatches.length}건 · 목적지 거부 규칙 ${rulesThisRun.length}건 · 규칙 미생성 block ${unresolvedBlocks.length}건 · 이번 실행 알림 ${loggedLines}줄\n`,
  );
  if (falsePositives.length > 0 || normalInDenyRules.length > 0 || nonBlockInRules.length > 0
      || blockedAfterExpiry > 0 || sourceRegisteredAsDestination.length > 0) {
    process.exitCode = 1;
  }
  return result;
}
