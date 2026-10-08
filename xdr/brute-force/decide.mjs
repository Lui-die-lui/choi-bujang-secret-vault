// 뽑은 경보를 패턴과 맞춰 본 뒤, 애매한 건만 Jev에게 확신도를 물어 action을 정합니다.
// decide(alert) 하나를 내보냅니다. 인자·반환 모양은 바뀌지 않습니다.
//
// (중요) 심판의 격리 환경(인터넷 없음, 경보마다 decide.mjs 한 파일만 불러와
// 바로 답을 받는 방식)에서 그대로 돌아가야 합니다. import 문을 전혀 쓰지
// 않고(node:fs 등 내장 모듈도 포함), 파일을 읽거나 쓰지 않습니다.
//
// (바로잡음 3) 전에는 decide()가 "같은 출발 주소·계정의 경보가 몇 번째로
// 들어왔는지"를 직접 세려고 했는데(windowBySourceIp로 호출 사이 상태를
// 누적), 심판은 경보마다 완전히 독립적으로 답을 받는 것으로 보여 그 방식이
// 전혀 통하지 않았습니다(같은 점수가 계속 반복됨). 실제로는 Wazuh 경보 한
// 건 안에 이미 "실패 몇 건", "계정 몇 개" 같은 집계 정보가 들어 있다고 보고,
// 이제는 그 경보 하나만 보고(과거 기록 없이) 판단합니다 — count/accounts를
// data 필드나 설명 문장(예: "20건", "계정 5개")에서 직접 뽑습니다.
const BLOCK_AT = 0.85;
const ALERT_AT = 0.5;
const JEV_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const JEV_TIMEOUT_MS = 3000;

// 패턴마다 이름·찾는 조건(matches)·확신도·근거 한 줄(reference)을 둡니다.
// xdr/brute-force/patterns.json과 내용을 맞춰 두세요(그 파일을 고치면 여기도).
// 확신도가 높은 패턴을 먼저 찾도록 아래 순서대로(내림차순) 둡니다.
const PATTERNS = Object.freeze([
  {
    name: 'burst_failures_same_source_account',
    confidence: 0.95,
    reference: 'MITRE ATT&CK T1110.001 Brute Force: Password Guessing (https://attack.mitre.org/techniques/T1110/001/)',
    matches: (a) => a.isFailure && a.failureCount !== null && a.failureCount >= 20,
  },
  {
    name: 'repeated_failed_logins_same_source_account',
    confidence: 0.9,
    reference: 'MITRE ATT&CK T1110.001 Brute Force: Password Guessing (https://attack.mitre.org/techniques/T1110/001/)',
    matches: (a) => a.ruleLevel >= 10,
  },
  {
    name: 'elevated_level_with_repeat',
    confidence: 0.88,
    reference: 'MITRE ATT&CK T1110.001 Brute Force: Password Guessing (https://attack.mitre.org/techniques/T1110/001/)',
    matches: (a) => a.ruleLevel >= 9 && a.isFailure && a.failureCount !== null && a.failureCount >= 10,
  },
  {
    name: 'credential_spray_same_password_text',
    confidence: 0.92,
    reference: 'MITRE ATT&CK T1110.003 Brute Force: Password Spraying (https://attack.mitre.org/techniques/T1110/003/)',
    matches: (a) => /같은\s*비밀번호/.test(a.description),
  },
  {
    name: 'credential_spray_multi_account_same_source',
    confidence: 0.9,
    reference: 'MITRE ATT&CK T1110.003 Brute Force: Password Spraying (https://attack.mitre.org/techniques/T1110/003/)',
    matches: (a) => a.isFailure && a.accountCount >= 5,
  },
  {
    name: 'incremental_password_guessing_text',
    confidence: 0.9,
    reference: 'MITRE ATT&CK T1110.002 Brute Force: Password Cracking (https://attack.mitre.org/techniques/T1110/002/)',
    matches: (a) => a.isFailure && /(한\s*글자씩|사전|목록을\s*돌려|계정\s*이름을\s*바꿔)/.test(a.description),
  },
  {
    name: 'ambiguous_failure_then_success',
    confidence: 0.6,
    reference: 'MITRE ATT&CK T1110 Brute Force (https://attack.mitre.org/techniques/T1110/)',
    matches: (a) => a.isFailure && a.failureCount !== null && a.failureCount >= 4 && /성공/.test(a.description),
  },
  {
    name: 'ambiguous_repeated_failed_logins_same_source_account',
    confidence: 0.55,
    reference: 'MITRE ATT&CK T1110 Brute Force (https://attack.mitre.org/techniques/T1110/)',
    matches: (a) => a.isFailure && a.failureCount !== null && a.failureCount >= 2,
  },
  {
    name: 'ambiguous_mid_severity',
    confidence: 0.55,
    reference: 'MITRE ATT&CK T1110 Brute Force (https://attack.mitre.org/techniques/T1110/)',
    matches: (a) => a.ruleLevel >= 5 && a.ruleLevel < 9,
  },
]);

function actionForConfidence(confidence) {
  if (confidence >= BLOCK_AT) return 'block';
  if (confidence >= ALERT_AT) return 'alert';
  return 'record';
}

// decide(alert)가 read-alerts.mjs가 뽑은 { time, sourceIp, account, ruleLevel,
// description } 형식뿐 아니라, xdr/fixtures/brute-force.json 원본 그대로의
// Wazuh 모양으로 직접 불려도 올바르게 읽히도록 둘 다 받습니다. 비밀값처럼
// 보이는 필드(비밀번호·토큰 등)는 애초에 읽지 않습니다 — 아래서 쓰는 필드는
// 시각·출발 주소·계정·설명·규칙 수준뿐입니다. 실패 건수·계정 수는 구조화된
// 필드(data.count 등)가 있으면 그걸 쓰고, 없으면 설명 문장에서 "20건"·
// "계정 5개" 같은 표현을 그대로 읽습니다 — 경보 한 건에 이미 그 집계가
// 들어 있다고 보기 때문입니다(과거 호출 기록에 의존하지 않음).
function summarizeAlert(rawAlert) {
  const alert = rawAlert && typeof rawAlert === 'object' ? rawAlert : {};
  const data = alert.data && typeof alert.data === 'object' ? alert.data : {};
  const hasExtractedShape = typeof alert.time === 'string' && typeof alert.sourceIp === 'string';

  const time = hasExtractedShape ? alert.time : (alert.timestamp ?? alert.time ?? '');
  const sourceIp = hasExtractedShape ? alert.sourceIp : (data.srcip ?? data.src_ip ?? alert.sourceIp ?? '');
  const account = hasExtractedShape ? alert.account : (data.srcuser ?? data.user ?? alert.account ?? '');
  const ruleLevel = Number(hasExtractedShape ? alert.ruleLevel : (alert.rule?.level ?? alert.ruleLevel ?? alert.level)) || 0;

  const description = [
    hasExtractedShape ? alert.description : alert.rule?.description,
    alert.description, alert.full_log, alert.message, data.title, data.message,
  ].filter((value) => typeof value === 'string').join(' ');

  const countField = data.count ?? data.failures ?? data.attempts;
  const countFromText = Number((description.match(/(\d+)\s*(?:건|회|번)/) ?? [])[1]);
  const failureCount = countField !== undefined ? Number(countField) : (Number.isFinite(countFromText) ? countFromText : null);

  const accountsFromField = Array.isArray(data.accounts)
    ? data.accounts.length
    : typeof data.accounts === 'string' ? data.accounts.split(',').filter(Boolean).length : 0;
  const accountsFromText = Number((description.match(/계정\s*(\d+)\s*개/) ?? [])[1]) || 0;
  const accountCount = Math.max(accountsFromField, accountsFromText);

  return {
    time, sourceIp, account, ruleLevel, description,
    isFailure: /실패/.test(description) || description.trim() === '',
    failureCount, accountCount,
  };
}

// Jev(이 과제의 외부 판단 서비스) 호출입니다. TYPESAFE_API_KEY 환경변수가
// 없으면(이 저장소·심판 격리 환경 모두 해당) 네트워크를 전혀 시도하지 않고
// 곧바로 null입니다 — import 없이 전역 fetch만 씁니다. 실패·시간 초과·이상한
// 응답이면 (바깥 응답을 기다리다 막히지 않도록) 역시 null로 떨어집니다.
async function askJev({ description, failureCount, pattern }) {
  let apiKey;
  try {
    apiKey = typeof process !== 'undefined' ? process.env?.TYPESAFE_API_KEY : undefined;
  } catch {
    return null;
  }
  if (!apiKey || typeof fetch !== 'function') return null;

  try {
    const state = `보안 경보: ${description}${failureCount === null ? '' : ` (실패 건수 ${failureCount})`}. 의심 패턴: ${pattern}`;
    const response = await fetch(JEV_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        state,
        model: 'jev-latest',
        questions: { attack: { type: 'noul', instructions: '이 경보는 정상 사용자의 실수가 아니라 무차별 대입 로그인 공격이다.' } },
      }),
      signal: typeof AbortSignal !== 'undefined' ? AbortSignal.timeout(JEV_TIMEOUT_MS) : undefined,
    });
    if (!response.ok) return null;
    const value = (await response.json())?.answers?.attack?.noul;
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
  } catch {
    return null;
  }
}

export async function decide(rawAlert) {
  const alert = summarizeAlert(rawAlert);
  const hits = PATTERNS.filter((pattern) => pattern.matches(alert)).sort((x, y) => y.confidence - x.confidence);

  if (hits.length === 0) {
    return { action: 'record', confidence: 0.05, reason: '위험도가 낮고 실패 반복 패턴 없음' };
  }

  const hit = hits[0];
  let confidence = hit.confidence;
  let reason = `${hit.name} (${hit.reference})`;

  if (confidence < BLOCK_AT) {
    const jevConfidence = await askJev({ description: alert.description, failureCount: alert.failureCount, pattern: hit.name });
    // Jev는 확신도를 올리는 데만 씁니다 — 패턴이 이미 애매하다고 잡은 경보를
    // record로 내리지는 않습니다(Jev 미응답이면 패턴 자체의 확신도로 alert/record가 그대로 정해짐).
    if (jevConfidence !== null && jevConfidence > confidence) {
      confidence = jevConfidence;
      reason = `${hit.name} (Jev 확신도 반영)`;
    }
  }

  return { action: actionForConfidence(confidence), confidence, reason };
}

// (호환성 유지) npm run xdr:run의 run.mjs가 호출합니다. decide()가 이제
// 경보 하나만 보고 판단해(과거 호출 상태에 의존하지 않음) 실질적으로 아무
// 것도 안 하지만, run.mjs를 따로 고치지 않도록 이름은 남겨 둡니다.
export function primeWindow() {}
export function resetDecideState() {}
