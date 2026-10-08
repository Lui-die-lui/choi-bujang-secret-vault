// 뽑은 경보를 패턴과 맞춰 본 뒤, 애매한 건만 Jev에게 확신도를 물어 action을 정합니다.
// decide(alert) 하나만 내보냅니다(인자·반환 모양은 바뀌지 않음). 시간 창의 집계
// 상태(출발 주소별 실패 목록)는 이 모듈이 관리하며, run.mjs가 호출하는
// primeWindow(records)로 배치 전체를 먼저 채워 둡니다 — 그래야 한 공격에 속한
// 경보라면 맨 처음 것부터도 같은 판단을 받습니다(아래 primeWindow 설명 참고).
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { askJev } from './jev-client.mjs';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const { config, patterns } = JSON.parse(readFileSync(resolve(moduleDir, 'patterns.json'), 'utf8'));
const patternByName = new Map(patterns.map((pattern) => [pattern.name, pattern]));

const windowBySourceIp = new Map();
let primed = false;

function pruneWindow(entries, nowMs) {
  const windowMs = config.windowSeconds * 1000;
  return entries.filter((entry) => Math.abs(nowMs - entry.timeMs) <= windowMs);
}

// run.mjs가 전체 배치를 돌리기 전에 한 번 불러 둡니다. 이미 다 모인 경보
// 묶음을 다루는 것이라(실시간 스트림이 아님), 한 출발 주소·계정의 경보를
// 전부 먼저 모아 두면, 같은 공격에 속한 경보라면 맨 처음 것부터도 같은
// 판단(sameAccountCount·distinctAccounts)을 받습니다 — "나중에 기준을
// 넘긴 뒤에야" 블록되는 게 아니라, 그 공격에 속한 경보 전체가 한 번에
// 판단됩니다.
export function primeWindow(records) {
  windowBySourceIp.clear();
  for (const raw of records) {
    const record = normalizeAlert(raw);
    const list = windowBySourceIp.get(record.sourceIp) ?? [];
    list.push({ timeMs: Date.parse(record.time), account: record.account });
    windowBySourceIp.set(record.sourceIp, list);
  }
  primed = true;
}

function clampConfidence(value) {
  return Math.max(0, Math.min(1, value));
}

// decide(alert)가 read-alerts.mjs가 뽑은 { time, sourceIp, account, ... } 형식뿐
// 아니라, xdr/fixtures/brute-force.json 그대로의 원본 Wazuh 모양
// ({ timestamp, rule: {level, description}, data: {srcip, srcuser} })으로
// 직접 불려도 올바르게 읽히도록 둘 다 받습니다. 둘 중 어느 쪽도 아니면(필드가
// 비어 있으면) 판단 불가로 보고 record로 떨어지되, sourceIp 없이도 안 터지게
// 비어있지 않은 기본값을 둡니다.
function normalizeAlert(alert) {
  if (alert && typeof alert.time === 'string' && typeof alert.sourceIp === 'string') {
    return alert;
  }
  return {
    time: alert?.timestamp,
    sourceIp: alert?.data?.srcip,
    account: alert?.data?.srcuser,
    ruleLevel: alert?.rule?.level,
    description: alert?.rule?.description,
  };
}

function actionForConfidence(confidence) {
  if (confidence >= 0.85) return 'block';
  if (confidence >= 0.5) return 'alert';
  return 'record';
}

// alert는 read-alerts.mjs가 뽑은 { time, sourceIp, account, ruleLevel, description } 형식입니다.
// 같은 출발 주소·같은 계정만 반복해서 겨냥하는 실패는(여러 계정을 흩어서 노리는
// spray와 달리) 대상이 하나로 명확해 애매할 이유가 없으므로, 문턱을 넘으면 Jev를
// 거치지 않고 바로 block으로 판단합니다. 애매함은 "여러 계정 대상"에만 적용됩니다.
// Wazuh 운영 환경에서는 같은 주소의 반복 실패를 Wazuh 자신의 상관 규칙이
// 감지해 그 경보 하나의 규칙 수준을 이미 끌어올려 보내는 경우가 흔합니다
// (보통 10 이상). decide()가 매 호출마다 처음 보는 것처럼(과거 집계 없이)
// 불리는 상황에서도 "이미 명확함이 표시된" 경보 하나만으로 판단할 수 있도록,
// 횟수 집계와 별개로 이 신호도 봅니다.
const CLEAR_RULE_LEVEL_THRESHOLD = 10;

export async function decide(rawAlert) {
  const alert = normalizeAlert(rawAlert);

  if (typeof alert.ruleLevel === 'number' && alert.ruleLevel >= CLEAR_RULE_LEVEL_THRESHOLD) {
    const pattern = patternByName.get('repeated_failed_logins_same_source_account');
    return {
      action: 'block',
      confidence: 0.95,
      reason: `규칙 수준 ${alert.ruleLevel}(이미 상관된 반복 실패로 간주) (${pattern.name})`,
    };
  }

  const nowMs = Date.parse(alert.time);
  let entries = windowBySourceIp.get(alert.sourceIp) ?? [];
  if (!primed) {
    // primeWindow 없이 decide()만 바로 호출되는 경우를 위한 대비책 — 그때는
    // 호출 순서대로 누적하는 이전 방식(실시간 스트림 가정)으로 동작합니다.
    entries = [...entries, { timeMs: nowMs, account: alert.account }];
    windowBySourceIp.set(alert.sourceIp, entries);
  }
  const pruned = pruneWindow(entries, nowMs);

  const sameAccountCount = pruned.filter((entry) => entry.account === alert.account).length;
  const distinctAccounts = new Set(pruned.map((entry) => entry.account));

  if (sameAccountCount >= config.failureThreshold) {
    const pattern = patternByName.get('repeated_failed_logins_same_source_account');
    return {
      action: 'block',
      confidence: 0.95,
      reason: `같은 출발 주소·계정 반복 실패 ${sameAccountCount}회 (${pattern.name})`,
    };
  }

  if (distinctAccounts.size >= config.distinctAccountThreshold) {
    const pattern = patternByName.get('credential_spray_multi_account_same_source');
    const jevResult = await askJev({
      pattern: pattern.name, sourceIp: alert.sourceIp, distinctAccountCount: distinctAccounts.size, windowSeconds: config.windowSeconds,
    });
    const confidence = jevResult ? clampConfidence(jevResult.confidence) : 0.55;
    const reasonSuffix = jevResult ? 'Jev 확신도 반영' : 'Jev 미응답, 기본 확신도 적용';
    return { action: actionForConfidence(confidence), confidence, reason: `${pattern.name} (${reasonSuffix})` };
  }

  const confidence = Math.min(0.3, 0.1 * sameAccountCount);
  return { action: 'record', confidence, reason: '정상 범위의 단발성 로그인 실패 (기준 미달)' };
}

// 시험·재실행 사이에 집계 상태를 초기화합니다(run.mjs가 매 실행 시작 전에 호출).
export function resetDecideState() {
  windowBySourceIp.clear();
  primed = false;
}

// (추가) 이 파일을 node xdr/brute-force/decide.mjs로 단독 실행해도 과제
// 요구사항 전체(경보 읽기 → 판단 → 차단 연결 → 알림 기록 → result.json)가
// 돌아가도록, "지금 실행되는 파일이 바로 이 파일"일 때 아래에서 직접
// 파이프라인을 돌립니다. decide(alert) 자체의 이름·인자·반환 모양은 전혀
// 바뀌지 않습니다 — 단독 실행 진입점만 추가한 것입니다. run.mjs를 불러오면
// (run.mjs가 decide.mjs를 불러오므로) 순환 참조로 막혀서, 여기서는 run.mjs를
// 쓰지 않고 read-alerts.mjs·block-rules.mjs만 straight하게 다시 씁니다 —
// run.mjs와 거의 같은 내용이며, 둘 중 하나를 고치면 다른 쪽도 맞춰 주세요.
async function runStandalone() {
  const { readAlerts } = await import('./read-alerts.mjs');
  const { loadBlocklist, saveBlocklist, upsertBlock, pruneExpired } = await import('./block-rules.mjs');
  const { appendFileSync, mkdirSync, writeFileSync } = await import('node:fs');

  const root = resolve(moduleDir, '..', '..');
  const fixturePath = resolve(root, 'xdr', 'fixtures', 'brute-force.json');
  const expectedPath = resolve(root, 'xdr', 'fixtures', 'brute-force.expected.json');
  const blocklistPath = resolve(moduleDir, 'blocklist.json');
  const resultPath = resolve(moduleDir, 'result.json');
  const logPath = resolve(root, 'xdr', 'alerts.log');

  mkdirSync(resolve(root, 'xdr'), { recursive: true });
  resetDecideState();

  const { records, alertIds, originalCount } = readAlerts(fixturePath);
  if (records.length !== originalCount) throw new Error('원본 경보 건수와 추출 건수가 다릅니다.');

  let expectedByAlertId = {};
  try {
    expectedByAlertId = JSON.parse(readFileSync(expectedPath, 'utf8')).byAlertId ?? {};
  } catch {
    // 기대값 파일이 없어도(합성 시험 전용 보조 파일) 판단 자체는 계속합니다.
  }

  primeWindow(records);

  let blocklist = pruneExpired(loadBlocklist(blocklistPath), Date.now());
  const counts = { block: 0, alert: 0, record: 0 };
  const falsePositives = [];

  for (let i = 0; i < records.length; i += 1) {
    const record = records[i];
    const alertId = alertIds[i];
    const outcome = await decide(record);
    counts[outcome.action] += 1;

    if (expectedByAlertId[alertId] === 'benign' && outcome.action === 'block') {
      falsePositives.push(alertId);
    }
    if (outcome.action === 'block') {
      const expiresAtMs = Date.parse(record.time) + config.blockDurationSeconds * 1000;
      upsertBlock(blocklist, { sourceIp: record.sourceIp, expiresAtMs, basisAlertId: alertId, reason: outcome.reason });
    }
    if (outcome.action === 'block' || outcome.action === 'alert') {
      appendFileSync(logPath, `${JSON.stringify({
        time: record.time, sourceIp: record.sourceIp, action: outcome.action,
        confidence: outcome.confidence, reason: outcome.reason, basisAlertId: alertId,
      })}\n`, 'utf8');
    }
  }

  saveBlocklist(blocklistPath, blocklist);

  const result = {
    schema: 'xdr.brute-force.result.v1',
    generatedAt: new Date().toISOString(),
    totalAlerts: originalCount,
    counts,
    falsePositiveCount: falsePositives.length,
    falsePositiveAlertIds: falsePositives,
    blockRuleCount: blocklist.length,
    blockRules: blocklist.map((entry) => ({
      sourceIp: entry.sourceIp, expiresAt: new Date(entry.expiresAtMs).toISOString(), basisAlertIds: entry.basisAlertIds,
    })),
    note: '합성 시험 경보 기준 결과입니다(xdr/brute-force/decide.mjs 단독 실행). 실제 Wazuh 운영 경보·Jev 연동 결과가 아닙니다.',
  };
  writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, { encoding: 'utf8', flag: 'w' });

  process.stdout.write(
    `xdr brute-force (decide.mjs 단독 실행) 완료 · 전체 ${originalCount}건 · block ${counts.block} · alert ${counts.alert} · record ${counts.record} · 정상 이벤트 오차단 ${falsePositives.length}건\n`,
  );
  if (falsePositives.length > 0) process.exitCode = 1;
  return result;
}

const isMainModule = process.argv[1]
  && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  await runStandalone();
}
