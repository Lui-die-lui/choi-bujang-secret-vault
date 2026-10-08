// npm run xdr:run -- brute-force 로 실행합니다.
// xdr/fixtures/brute-force.json(합성 시험 경보)을 읽어 decide()로 판단하고,
// block만 임시 거부 규칙으로 올리고, 알림은 xdr/alerts.log에 남기고,
// xdr/brute-force/result.json에 counts·정상 이벤트 오차단 여부·연결된 경로
// 전체의 거부/통과/만료 시험 결과를 기록합니다.
//
// 이 실행은 전부 로컬·격리된 저장소에서만 일어납니다(Supabase를 전혀
// 건드리지 않음) — 운영 DB 동기화는 별도 명령 npm run xdr:sync로 분리되어
// 있습니다(xdr/brute-force/sync.mjs).
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readAlerts } from './read-alerts.mjs';
import { decide, primeWindow, resetDecideState } from './decide.mjs';
import { loadBlocklist, saveBlocklist, upsertBlock, pruneExpired } from './block-rules.mjs';
import { createMemoryBlocklistStore, extractSourceIp, isSourceBlocked } from '../../src/xdr-login-guard.mjs';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(moduleDir, '..', '..');
const fixturePath = resolve(root, 'xdr', 'fixtures', 'brute-force.json');
const expectedPath = resolve(root, 'xdr', 'fixtures', 'brute-force.expected.json');
const blocklistPath = resolve(moduleDir, 'blocklist.json');
const resultPath = resolve(moduleDir, 'result.json');
const logPath = resolve(root, 'xdr', 'alerts.log');
// decide.mjs는 이제 import 없는 단일 파일이라 patterns.json을 안 읽습니다.
// 차단 규칙의 만료 시각은 이 오프라인 시험 스크립트(run.mjs)에서만 쓰는
// 값이라 여기 직접 둡니다 — decide.mjs의 BLOCK_AT 등 판단 기준과는 무관합니다.
const BLOCK_DURATION_SECONDS = 3600;

function fakeRequest(headers) {
  return { headers };
}

// api/auth/login.mjs가 실제로 호출하는 extractSourceIp·isSourceBlocked를
// 그대로 호출해 전체 경로(헤더 추출 → 저장소 조회 → 허용/거부)를 시험합니다.
// 저장소만 격리된 메모리 표(decide()가 이번 실행에서 만든 블록 규칙)로
// 바꿔 끼웁니다 — 실제 Supabase는 전혀 호출하지 않습니다.
async function runEndToEndChecks({ blocklist, attackIp, ambiguousIp, benignIp, unrelatedIp, nowMs, expiredCheckMs }) {
  const rows = blocklist.map((entry) => ({ source_ip: entry.sourceIp, expires_at: new Date(entry.expiresAtMs).toISOString() }));
  const store = createMemoryBlocklistStore(rows);

  const checks = [];
  const check = async (name, headers, nowForCheck, expectedBlocked) => {
    const sourceIp = extractSourceIp(fakeRequest(headers));
    const blocked = await isSourceBlocked({ store, sourceIp, nowMs: nowForCheck });
    checks.push({ name, sourceIp, expectedBlocked, actualBlocked: blocked, passed: blocked === expectedBlocked });
  };

  await check('명확한 공격 요청 거부', { 'x-vercel-forwarded-for': attackIp }, nowMs, true);
  await check('애매한 시도는 차단하지 않음', { 'x-vercel-forwarded-for': ambiguousIp }, nowMs, false);
  await check('정상 이벤트 주소는 통과', { 'x-vercel-forwarded-for': benignIp }, nowMs, false);
  await check('전혀 무관한 주소는 통과', { 'x-vercel-forwarded-for': unrelatedIp }, nowMs, false);
  await check('만료 이후에는 같은 주소도 통과', { 'x-vercel-forwarded-for': attackIp }, expiredCheckMs, false);
  // x-forwarded-for에 다른 값이 섞여 있어도 x-vercel-forwarded-for(추가 프록시가 있어도
  // 바뀌지 않는 값)를 우선해야 합니다 — 위조 시도 상황을 흉내냅니다.
  await check(
    '위조 가능한 x-forwarded-for보다 x-vercel-forwarded-for를 우선함',
    { 'x-forwarded-for': '198.51.100.250', 'x-vercel-forwarded-for': attackIp },
    nowMs,
    true,
  );

  return checks;
}

export async function run() {
  mkdirSync(resolve(root, 'xdr'), { recursive: true });
  resetDecideState();

  const { records, alertIds, originalCount } = readAlerts(fixturePath);
  if (records.length !== originalCount) {
    throw new Error('원본 경보 건수와 추출 건수가 다릅니다.');
  }

  const expectedRaw = JSON.parse(readFileSync(expectedPath, 'utf8'));
  const expectedByAlertId = expectedRaw.byAlertId ?? {};

  // 이미 다 모인 경보 묶음이므로(실시간 스트림이 아님), decide()를 호출하기
  // 전에 전체 배치를 먼저 채워 둡니다 — 한 공격에 속한 경보라면 맨 처음
  // 것부터도 같은 판단을 받게 하기 위함입니다(decide.mjs의 primeWindow 설명 참고).
  primeWindow(records);

  // 격리된 시험 저장소: 이번 실행 동안만 쓰는 로컬 블록리스트입니다. 운영
  // Supabase 표와는 완전히 분리되어 있고, 이 함수 안에서는 네트워크 호출이
  // 전혀 일어나지 않습니다.
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
      const expiresAtMs = Date.parse(record.time) + BLOCK_DURATION_SECONDS * 1000;
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

  const attackEntry = blocklist.find((entry) => entry.sourceIp === '203.0.113.10');
  const endToEndChecks = attackEntry
    ? await runEndToEndChecks({
      blocklist,
      attackIp: '203.0.113.10',
      ambiguousIp: '198.51.100.77',
      benignIp: '203.0.113.99',
      unrelatedIp: '203.0.113.254',
      nowMs: attackEntry.expiresAtMs - 1,
      expiredCheckMs: attackEntry.expiresAtMs + 1000,
    })
    : [];
  const endToEndFailures = endToEndChecks.filter((item) => !item.passed);

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
    endToEndChecks,
    endToEndAllPassed: endToEndChecks.length > 0 && endToEndFailures.length === 0,
    note: '합성 시험 경보 기준 결과이며, api/auth/login.mjs가 실제로 쓰는 src/xdr-login-guard.mjs 함수를 격리된 메모리 저장소로 호출해 전체 경로(헤더 추출→저장소 조회→허용/거부)를 시험합니다. 실제 Supabase·Wazuh 운영 경보·Jev 연동 결과가 아닙니다.',
  };

  writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, { encoding: 'utf8', flag: 'w' });

  process.stdout.write(
    `xdr brute-force 실행 완료 · 전체 ${originalCount}건 · block ${counts.block} · alert ${counts.alert} · record ${counts.record} · 정상 이벤트 오차단 ${falsePositives.length}건 · 전체 경로 시험 ${endToEndChecks.length}건 중 통과 ${endToEndChecks.length - endToEndFailures.length}건\n`,
  );
  for (const item of endToEndChecks) {
    process.stdout.write(`  ${item.passed ? '통과' : '실패'} · ${item.name} (sourceIp=${item.sourceIp}, 기대=${item.expectedBlocked}, 실제=${item.actualBlocked})\n`);
  }

  if (falsePositives.length > 0 || endToEndFailures.length > 0) {
    process.exitCode = 1;
  }
  return result;
}
