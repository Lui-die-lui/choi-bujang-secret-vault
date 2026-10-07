// 뽑은 경보를 패턴과 맞춰 본 뒤, 애매한 건만 Jev에게 확신도를 물어 action을 정합니다.
// decide(alert) 하나만 내보냅니다. 이 모듈은 같은 프로세스 안에서 호출되는 순서대로
// 시간 창의 집계 상태(출발 주소별 최근 실패 목록)를 관리합니다.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { askJev } from './jev-client.mjs';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const { config, patterns } = JSON.parse(readFileSync(resolve(moduleDir, 'patterns.json'), 'utf8'));
const patternByName = new Map(patterns.map((pattern) => [pattern.name, pattern]));

const windowBySourceIp = new Map();

function pruneWindow(entries, nowMs) {
  const windowMs = config.windowSeconds * 1000;
  return entries.filter((entry) => nowMs - entry.timeMs <= windowMs);
}

function clampConfidence(value) {
  return Math.max(0, Math.min(1, value));
}

function actionForConfidence(confidence) {
  if (confidence >= 0.85) return 'block';
  if (confidence >= 0.5) return 'alert';
  return 'record';
}

// alert는 read-alerts.mjs가 뽑은 { time, sourceIp, account, ruleLevel, description } 형식입니다.
export async function decide(alert) {
  const nowMs = Date.parse(alert.time);
  const existing = windowBySourceIp.get(alert.sourceIp) ?? [];
  const pruned = pruneWindow(existing, nowMs);
  pruned.push({ timeMs: nowMs, account: alert.account });
  windowBySourceIp.set(alert.sourceIp, pruned);

  const sameAccountCount = pruned.filter((entry) => entry.account === alert.account).length;
  const distinctAccounts = new Set(pruned.map((entry) => entry.account));

  if (sameAccountCount >= config.highFailureThreshold) {
    const pattern = patternByName.get('repeated_failed_logins_same_source_account');
    return {
      action: 'block',
      confidence: 0.95,
      reason: `같은 출발 주소·계정 반복 실패 ${sameAccountCount}회 (${pattern.name})`,
    };
  }

  if (sameAccountCount >= config.mediumFailureThreshold) {
    const pattern = patternByName.get('ambiguous_repeated_failed_logins_same_source_account');
    const jevResult = await askJev({
      pattern: pattern.name, sourceIp: alert.sourceIp, sameAccountCount, windowSeconds: config.windowSeconds,
    });
    const confidence = jevResult ? clampConfidence(jevResult.confidence) : 0.6;
    const reasonSuffix = jevResult ? 'Jev 확신도 반영' : 'Jev 미응답, 기본 확신도 적용';
    return { action: actionForConfidence(confidence), confidence, reason: `${pattern.name} (${reasonSuffix})` };
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
}
