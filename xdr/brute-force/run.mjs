// npm run xdr:run -- brute-force 로 실행합니다.
// xdr/fixtures/brute-force.json(합성 시험 경보)을 읽어 decide()로 판단하고,
// block만 임시 거부 규칙으로 올리고, 알림은 xdr/alerts.log에 남기고,
// xdr/brute-force/result.json에 counts와 정상 이벤트 오차단 여부를 기록합니다.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readAlerts } from './read-alerts.mjs';
import { decide, resetDecideState } from './decide.mjs';
import { loadBlocklist, saveBlocklist, upsertBlock, isBlocked, pruneExpired } from './block-rules.mjs';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(moduleDir, '..', '..');
const fixturePath = resolve(root, 'xdr', 'fixtures', 'brute-force.json');
const expectedPath = resolve(root, 'xdr', 'fixtures', 'brute-force.expected.json');
const blocklistPath = resolve(moduleDir, 'blocklist.json');
const resultPath = resolve(moduleDir, 'result.json');
const logPath = resolve(root, 'xdr', 'alerts.log');
const { config } = JSON.parse(readFileSync(resolve(moduleDir, 'patterns.json'), 'utf8'));

export async function run() {
  mkdirSync(resolve(root, 'xdr'), { recursive: true });
  resetDecideState();

  const { records, alertIds, originalCount } = readAlerts(fixturePath);
  if (records.length !== originalCount) {
    throw new Error('원본 경보 건수와 추출 건수가 다릅니다.');
  }

  const expectedRaw = JSON.parse(readFileSync(expectedPath, 'utf8'));
  const expectedByAlertId = expectedRaw.byAlertId ?? {};

  let blocklist = loadBlocklist(blocklistPath);
  const nowRunMs = Date.now();
  blocklist = pruneExpired(blocklist, nowRunMs);

  const counts = { block: 0, alert: 0, record: 0 };
  const falsePositives = [];
  const decisions = [];

  for (let i = 0; i < records.length; i += 1) {
    const record = records[i];
    const alertId = alertIds[i];
    const outcome = await decide(record);
    counts[outcome.action] += 1;
    decisions.push({ alertId, sourceIp: record.sourceIp, action: outcome.action, confidence: outcome.confidence, reason: outcome.reason });

    const expectedLabel = expectedByAlertId[alertId];
    if (expectedLabel === 'benign' && outcome.action === 'block') {
      falsePositives.push(alertId);
    }

    if (outcome.action === 'block') {
      const expiresAtMs = Date.parse(record.time) + config.blockDurationSeconds * 1000;
      upsertBlock(blocklist, { sourceIp: record.sourceIp, expiresAtMs, basisAlertId: alertId, reason: outcome.reason });
    }

    if (outcome.action === 'block' || outcome.action === 'alert') {
      const logLine = JSON.stringify({
        time: record.time, sourceIp: record.sourceIp, action: outcome.action,
        confidence: outcome.confidence, reason: outcome.reason, basisAlertId: alertId,
      });
      appendFileSync(logPath, `${logLine}\n`, 'utf8');
    }
  }

  saveBlocklist(blocklistPath, blocklist);

  // 차단 만료 자체 검증: 방금 만든 규칙 중 하나를 만료 이후 시각으로 다시 확인합니다.
  let expiryVerified = null;
  const sampleBlockedIp = blocklist[0]?.sourceIp ?? null;
  if (sampleBlockedIp) {
    const entry = blocklist.find((item) => item.sourceIp === sampleBlockedIp);
    const stillBlockedNow = isBlocked(blocklist, sampleBlockedIp, entry.expiresAtMs - 1);
    const blockedAfterExpiry = isBlocked(blocklist, sampleBlockedIp, entry.expiresAtMs + 1000);
    expiryVerified = stillBlockedNow === true && blockedAfterExpiry === false;
  }

  // 정상 요청 통과 자체 검증: 공격자 주소와 전혀 다른 주소는 차단되지 않아야 합니다.
  const unrelatedIpPassed = !isBlocked(blocklist, '203.0.113.254', nowRunMs);

  const result = {
    schema: 'xdr.brute-force.result.v1',
    generatedAt: new Date().toISOString(),
    totalAlerts: originalCount,
    counts,
    falsePositiveCount: falsePositives.length,
    falsePositiveAlertIds: falsePositives,
    blockRuleCount: blocklist.length,
    blockRules: blocklist.map((entry) => ({
      sourceIp: entry.sourceIp,
      expiresAt: new Date(entry.expiresAtMs).toISOString(),
      basisAlertIds: entry.basisAlertIds,
    })),
    expiryVerified,
    unrelatedIpPassed,
    note: '합성 시험 경보 기준 결과입니다. 실제 Wazuh 운영 경보·Jev 연동 결과가 아닙니다.',
  };

  writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, { encoding: 'utf8', flag: 'w' });

  process.stdout.write(
    `xdr brute-force 실행 완료 · 전체 ${originalCount}건 · block ${counts.block} · alert ${counts.alert} · record ${counts.record} · 정상 이벤트 오차단 ${falsePositives.length}건 · 만료 검증 ${expiryVerified} · 무관 주소 통과 ${unrelatedIpPassed}\n`,
  );

  if (falsePositives.length > 0) {
    process.exitCode = 1;
  }
  return result;
}
