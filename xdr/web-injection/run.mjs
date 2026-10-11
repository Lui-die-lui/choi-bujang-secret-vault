// npm run xdr:run -- web-injection 으로 실행합니다.
// xdr/fixtures/web-injection.json(합성 시험 경보)을 respond()로 한 번 흘려 판단·알림·
// 로컬 거부 규칙을 만들고, xdr/web-injection/result.json에 counts와 정상 이벤트가
// block 판정을 받았거나 거부 규칙에 들어갔는지를 기록합니다.
//
// 이 실행은 전부 로컬 파일에서만 일어납니다. 거부 규칙은 xdr/web-injection/blocklist.json
// 에만 있고 실제 요청 처리 경로에는 연결되어 있지 않습니다(respond.mjs의 연결 범위 설명 참고).
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { respond } from './respond.mjs';
import { isBlocked } from '../brute-force/block-rules.mjs';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const resultPath = resolve(moduleDir, 'result.json');

export async function run() {
  const { totalAlerts, loggedLines, counts, decisions, blocklist, ruleSourceIps, processedAtMs, groups } = respond();
  if (loggedLines !== totalAlerts) {
    throw new Error('원본 경보 건수와 이번 실행의 알림 줄 수가 다릅니다.');
  }

  const normalIds = new Set(groups.normal ?? []);
  const normalDecisions = decisions.filter((item) => normalIds.has(item.alertId));
  // 정상 이벤트가 block 판정을 받은 경우와, 정상 이벤트의 출발 주소가 거부 규칙에
  // 들어간 경우를 따로 셉니다(판정 결과와 규칙은 다른 것입니다).
  const falsePositives = normalDecisions.filter((item) => item.action === 'block').map((item) => item.alertId);
  const normalInDenyRules = normalDecisions
    .filter((item) => isBlocked(blocklist, item.sourceIp, processedAtMs))
    .map((item) => item.alertId);

  const rulesThisRun = blocklist.filter((entry) => ruleSourceIps.includes(entry.sourceIp));

  const result = {
    schema: 'xdr.web-injection.result.v1',
    generatedAt: new Date(processedAtMs).toISOString(),
    totalAlerts,
    loggedLinesThisRun: loggedLines,
    counts,
    falsePositiveCount: falsePositives.length,
    falsePositiveAlertIds: falsePositives,
    normalInDenyRuleCount: normalInDenyRules.length,
    normalInDenyRuleAlertIds: normalInDenyRules,
    blockRuleCount: rulesThisRun.length,
    blockRules: rulesThisRun.map((entry) => ({
      sourceIp: entry.sourceIp,
      expiresAt: new Date(entry.expiresAtMs).toISOString(),
      basisAlertIds: entry.basisAlertIds,
    })),
    decisions,
    note: '합성 시험 경보 기준의 로컬 결과입니다. counts.block은 판정 건수이고 blockRuleCount는 같은 출발 주소에서 block 후보가 2건 이상일 때만 만들어지는 로컬 거부 규칙 수입니다. 규칙은 xdr/web-injection/blocklist.json에만 있고 실제 요청 처리 경로에는 연결되지 않았습니다. 실제 Wazuh 운영 경보나 심판 판정 결과가 아닙니다.',
  };

  writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, { encoding: 'utf8', flag: 'w' });

  process.stdout.write(
    `xdr web-injection 실행 완료 · 전체 ${totalAlerts}건 · block ${counts.block} · alert ${counts.alert} · record ${counts.record} · 정상 이벤트 block 판정 ${falsePositives.length}건 · 정상 이벤트 거부 규칙 포함 ${normalInDenyRules.length}건 · 로컬 거부 규칙 ${rulesThisRun.length}건 · 이번 실행 알림 ${loggedLines}줄\n`,
  );

  if (falsePositives.length > 0 || normalInDenyRules.length > 0) {
    process.exitCode = 1;
  }
  return result;
}
