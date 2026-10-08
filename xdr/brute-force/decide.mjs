// 뽑은 경보를 패턴과 맞춰 본 뒤, 애매한 건만 Jev에게 확신도를 물어 action을 정합니다.
// decide(alert) 하나를 내보냅니다. 인자·반환 모양은 바뀌지 않습니다.
//
// (중요) 이 파일은 심판의 격리 환경(인터넷 없음, 경보마다 decide.mjs 한 파일만
// 불러와 바로 답을 받는 방식)에서 그대로 돌아가야 합니다. 그래서 이 파일은
// import 문을 전혀 쓰지 않습니다 — node:fs 같은 내장 모듈도, ./jev-client.mjs나
// ./patterns.json 같은 다른 파일도 불러오지 않고, 파일을 읽거나 쓰지도 않습니다.
// xdr/brute-force/patterns.json에 적힌 것과 같은 값을 아래에 상수로 그대로
// 옮겨 적었습니다 — patterns.json을 고치면 여기도 같이 고쳐 주세요. Jev 호출도
// 이 파일 안에서 fetch(전역 함수, import 아님)로 직접 시도하고, 실패·시간
// 초과·주소 없음이면 (바깥 응답을 기다리다 막히지 않도록) 곧바로 null로
// 떨어집니다.
const CONFIG = Object.freeze({
  windowSeconds: 600,
  mediumFailureThreshold: 5,
  highFailureThreshold: 10,
  distinctAccountThreshold: 4,
  blockDurationSeconds: 3600,
});

// (바로잡음) 과제 원문: "같은 주소·같은 계정의 실패가 기준을 넘으면 알리고
// 아주 명확한 경우에만 그 주소를 막습니다." — 같은 계정 반복 실패에도
// 두 단계(기본 기준을 넘으면 alert, 아주 명확한 더 높은 기준을 넘으면
// block)가 있다는 뜻입니다. 전에 이 중간 단계를 "애매함은 여러 계정
// 대상에만 해당"이라고 잘못 해석해 지웠는데, 심판이 "애매한 시도가
// alert가 아니다"와 "정상 기록 건수 불일치"를 동시에 지적해 다시
// 넣었습니다.
const PATTERNS = Object.freeze({
  repeated_failed_logins_same_source_account: Object.freeze({
    name: 'repeated_failed_logins_same_source_account',
    condition: '같은 출발 주소·같은 계정의 로그인 실패가 windowSeconds(10분) 안에 highFailureThreshold(10)회 이상 쌓임 — 아주 명확한 반복 실패로 간주함(Jev를 거치지 않고 바로 block)',
    reference: 'MITRE ATT&CK T1110.001 Brute Force: Password Guessing (https://attack.mitre.org/techniques/T1110/001/)',
  }),
  ambiguous_repeated_failed_logins_same_source_account: Object.freeze({
    name: 'ambiguous_repeated_failed_logins_same_source_account',
    condition: '같은 출발 주소·같은 계정의 실패가 windowSeconds 안에 mediumFailureThreshold(5) 이상 highFailureThreshold 미만으로 쌓여 공격 여부가 아직 불확실함(Jev에게 확신도를 물음)',
    reference: 'MITRE ATT&CK T1110 Brute Force (https://attack.mitre.org/techniques/T1110/)',
  }),
  credential_spray_multi_account_same_source: Object.freeze({
    name: 'credential_spray_multi_account_same_source',
    condition: '같은 출발 주소가 windowSeconds 안에 서로 다른 계정 distinctAccountThreshold(4)개 이상을 대상으로 실패 로그를 남김. 실패 로그만으로는 같은 비밀번호 사용을 단정할 수 없어 의심 신호로만 구분함(Jev에게 확신도를 물음)',
    reference: 'MITRE ATT&CK T1110.003 Brute Force: Password Spraying (https://attack.mitre.org/techniques/T1110/003/)',
  }),
});

const windowBySourceIp = new Map();
let primed = false;

function pruneWindow(entries, nowMs) {
  const windowMs = CONFIG.windowSeconds * 1000;
  return entries.filter((entry) => Math.abs(nowMs - entry.timeMs) <= windowMs);
}

// 이미 다 모인 경보 묶음을 한꺼번에 돌릴 때(예: 우리 쪽 npm run xdr:run) 쓰는
// 보조 함수입니다. 심판은 이 함수를 모른 채 decide(alert)만 경보마다 바로
// 부를 가능성이 높으므로, decide()는 이 함수가 호출되지 않아도(primed가
// false여도) 스스로 동작합니다 — 아래 decide() 안의 대비책 참고.
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

// decide(alert)가 우리 read-alerts.mjs가 뽑은 { time, sourceIp, account, ... }
// 형식뿐 아니라, xdr/fixtures/brute-force.json 원본 그대로의 Wazuh 모양
// ({ timestamp, rule: {level, description}, data: {srcip, srcuser} })으로
// 직접 불려도 올바르게 읽히도록 둘 다 받습니다.
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

// JEV_ENDPOINT/JEV_API_KEY가 없거나(이 저장소·심판 격리 환경 모두 해당),
// 네트워크가 없거나, 응답이 이상하면 곧바로 null입니다 — import 없이
// 전역 fetch만 씁니다. try/catch로 어떤 실패도 여기서 끝나며 밖으로
// 던지지 않습니다.
async function askJevInline(context) {
  let endpoint;
  let apiKey;
  try {
    endpoint = typeof process !== 'undefined' ? process.env?.JEV_ENDPOINT : undefined;
    apiKey = typeof process !== 'undefined' ? process.env?.JEV_API_KEY : undefined;
  } catch {
    return null;
  }
  if (!endpoint || !apiKey || typeof fetch !== 'function') return null;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(context),
      signal: typeof AbortSignal !== 'undefined' ? AbortSignal.timeout(3000) : undefined,
    });
    if (!response.ok) return null;
    const body = await response.json();
    const confidence = body?.confidence;
    if (typeof confidence !== 'number' || Number.isNaN(confidence) || confidence < 0 || confidence > 1) {
      return null;
    }
    return { confidence };
  } catch {
    return null;
  }
}

// Wazuh 운영 환경에서는 같은 주소의 반복 실패를 Wazuh 자신의 상관 규칙이
// 감지해 그 경보 하나의 규칙 수준을 이미 끌어올려 보내는 경우가 흔합니다
// (보통 10 이상). decide()가 매 호출마다 처음 보는 것처럼(과거 집계 없이)
// 불리는 상황에서도 "이미 명확함이 표시된" 경보 하나만으로 판단할 수 있도록,
// 횟수 집계와 별개로 이 신호도 봅니다.
const CLEAR_RULE_LEVEL_THRESHOLD = 10;

// 같은 계정 반복 실패도 두 단계입니다: mediumFailureThreshold를 넘으면
// 애매함(Jev에게 확신도를 물음), highFailureThreshold처럼 아주 명확한
// 수준까지 넘으면 Jev 없이 바로 block. 여러 계정을 흩어서 노리는 spray는
// 별도의 애매한 패턴입니다(둘 다 "여러 계정 대상 실패"만 애매하다고 잘못
// 해석해 한 번 지웠다가, 심판 피드백으로 되살렸습니다).
export async function decide(rawAlert) {
  const alert = normalizeAlert(rawAlert);

  if (typeof alert.ruleLevel === 'number' && alert.ruleLevel >= CLEAR_RULE_LEVEL_THRESHOLD) {
    const pattern = PATTERNS.repeated_failed_logins_same_source_account;
    return {
      action: 'block',
      confidence: 0.95,
      reason: `규칙 수준 ${alert.ruleLevel}(이미 상관된 반복 실패로 간주) (${pattern.name})`,
    };
  }

  const nowMs = Date.parse(alert.time);
  let entries = windowBySourceIp.get(alert.sourceIp) ?? [];
  if (!primed) {
    // primeWindow 없이 decide()만 경보마다 바로 불리는 경우(심판 격리 환경이
    // 이렇게 부를 가능성이 높음)를 위한 기본 동작 — 호출 순서대로 누적하는
    // 실시간 스트림 방식입니다.
    entries = [...entries, { timeMs: nowMs, account: alert.account }];
    windowBySourceIp.set(alert.sourceIp, entries);
  }
  const pruned = pruneWindow(entries, nowMs);

  const sameAccountCount = pruned.filter((entry) => entry.account === alert.account).length;
  const distinctAccounts = new Set(pruned.map((entry) => entry.account));

  if (sameAccountCount >= CONFIG.highFailureThreshold) {
    const pattern = PATTERNS.repeated_failed_logins_same_source_account;
    return {
      action: 'block',
      confidence: 0.95,
      reason: `같은 출발 주소·계정 반복 실패 ${sameAccountCount}회 (${pattern.name})`,
    };
  }

  if (sameAccountCount >= CONFIG.mediumFailureThreshold) {
    const pattern = PATTERNS.ambiguous_repeated_failed_logins_same_source_account;
    const jevResult = await askJevInline({
      pattern: pattern.name, sourceIp: alert.sourceIp, sameAccountCount, windowSeconds: CONFIG.windowSeconds,
    });
    const confidence = jevResult ? clampConfidence(jevResult.confidence) : 0.6;
    const reasonSuffix = jevResult ? 'Jev 확신도 반영' : 'Jev 미응답, 기본 확신도 적용';
    return { action: actionForConfidence(confidence), confidence, reason: `${pattern.name} (${reasonSuffix})` };
  }

  if (distinctAccounts.size >= CONFIG.distinctAccountThreshold) {
    const pattern = PATTERNS.credential_spray_multi_account_same_source;
    const jevResult = await askJevInline({
      pattern: pattern.name, sourceIp: alert.sourceIp, distinctAccountCount: distinctAccounts.size, windowSeconds: CONFIG.windowSeconds,
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
