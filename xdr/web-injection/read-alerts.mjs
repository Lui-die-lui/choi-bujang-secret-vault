// Wazuh 형식 웹 접근 경보(합성 시험 자료)에서 시각·출발 주소·계정·규칙 수준·설명만 뽑습니다.
// 원본 파일은 읽기만 하고 고치지 않습니다. 요청 주소(data.url) 같은 나머지 필드는
// 추출하지 않고, 설명 문장 안의 비밀값처럼 보이는 값은 가려서 내보냅니다.
// 확인용 모듈이라 decide.mjs가 불러오지 않습니다.
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED_FIELDS = ['id', 'timestamp', 'rule', 'data'];

// 웹 접근 로그에는 로그인 계정이 없는 요청도 있어 계정이 없으면 이 값으로 둡니다.
const NO_ACCOUNT = '(없음)';

const SECRET_KEY_VALUE = /\b(pass(?:word|wd)?|pwd|token|secret|api[_-]?key|authorization|session(?:id)?|cookie)\s*[=:]\s*[^\s&,;]+/giu;
const BEARER_VALUE = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gu;

function maskSecrets(text) {
  return text
    .replace(SECRET_KEY_VALUE, (_match, key) => `${key}=[가림]`)
    .replace(BEARER_VALUE, 'Bearer [가림]');
}

function extractOne(rawAlert) {
  for (const field of REQUIRED_FIELDS) {
    if (!(field in rawAlert)) throw new TypeError(`invalid_alert_missing_${field}`);
  }
  const { timestamp, rule, data } = rawAlert;
  if (typeof timestamp !== 'string' || Number.isNaN(Date.parse(timestamp))) {
    throw new TypeError('invalid_alert_timestamp');
  }
  if (typeof data?.srcip !== 'string') throw new TypeError('invalid_alert_data');
  if (data.srcuser !== undefined && typeof data.srcuser !== 'string') {
    throw new TypeError('invalid_alert_data');
  }
  if (typeof rule?.level !== 'number' || typeof rule?.description !== 'string') {
    throw new TypeError('invalid_alert_rule');
  }
  return {
    time: timestamp,
    sourceIp: data.srcip,
    account: data.srcuser ?? NO_ACCOUNT,
    ruleLevel: rule.level,
    description: maskSecrets(rule.description),
  };
}

// fixturePath의 Wazuh 경보를 읽어 { records, alertIds }를 돌려줍니다.
// records[i]는 알림의 공개 가능한 5개 항목만 담고, 근거 경보 번호(alertIds[i])는
// 내부 추적용으로만 별도 배열에 보존합니다(두 배열은 같은 순서·같은 길이).
export function readAlerts(fixturePath) {
  const raw = JSON.parse(readFileSync(fixturePath, 'utf8'));
  if (!Array.isArray(raw?.alerts)) throw new TypeError('invalid_fixture_shape');

  const records = raw.alerts.map(extractOne);
  const alertIds = raw.alerts.map((alert) => alert.id);

  if (records.length !== raw.alerts.length || alertIds.length !== raw.alerts.length) {
    throw new Error('alert_extraction_count_mismatch');
  }

  return { records, alertIds, originalCount: raw.alerts.length };
}

// node xdr/web-injection/read-alerts.mjs 로 단독 실행하면 경보마다 한 줄씩 표준
// 출력에 찍고, 원본 경보 건수와 찍은 줄 수를 비교한 요약은 표준 오류에 따로
// 찍습니다(표준 출력의 줄 수가 곧 뽑은 줄 수). 다른 모듈이 불러 쓸 때는 실행되지 않습니다.
const isMainModule = process.argv[1]
  && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  const defaultFixturePath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'web-injection.json');
  const { records, originalCount } = readAlerts(defaultFixturePath);
  const lines = records.map((record) => (
    `${record.time} | ${record.sourceIp} | ${record.account} | 수준 ${record.ruleLevel} | ${record.description}`
  ));
  for (const line of lines) process.stdout.write(`${line}\n`);
  process.stderr.write(
    `read-alerts 단독 실행 완료 · 원본 경보 ${originalCount}건 · 출력 ${lines.length}줄 (${lines.length === originalCount ? '건수 일치' : '건수 불일치'})\n`,
  );
  if (lines.length !== originalCount) process.exitCode = 1;
}
