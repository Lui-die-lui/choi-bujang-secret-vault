// 뽑은 경보를 패턴과 맞춰 본 뒤, 애매한 건만 Jev에게 확신도를 물어 action을 정합니다.
// decide(alert) 하나만 내보냅니다(인자·반환 모양은 바뀌지 않음). 시간 창의 집계
// 상태(출발 주소별 실패 목록)는 이 모듈이 관리하며, run.mjs가 호출하는
// primeWindow(records)로 배치 전체를 먼저 채워 둡니다 — 그래야 한 공격에 속한
// 경보라면 맨 처음 것부터도 같은 판단을 받습니다(아래 primeWindow 설명 참고).
import { readFileSync } from 'node:fs';
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
