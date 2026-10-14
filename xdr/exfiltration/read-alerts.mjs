// Wazuh 형식 경보(운영 측 합성 시험 자료, exfiltration)에서 시각·출발 주소·계정·규칙 수준·설명만
// 뽑습니다. 원본 파일은 읽기만 하고 고치지 않습니다. 목적지(data.dstip)·전송량(data.bytes)·파일 수
// 같은 나머지 필드는 꺼내지 않고, 설명 문장 안의 비밀값처럼 보이는 값은 가려서 내보냅니다.
// 주의: 출발 주소(srcip)는 PC 쪽, 목적지(dstip)는 바깥 쪽이며 이 모듈은 둘을 섞지 않습니다.
// 확인용 모듈이라 decide.mjs가 불러오지 않습니다.
//
// 누락된 필드 때문에 경보를 조용히 버리지 않습니다. 시각·출발 주소·규칙 수준·설명이 읽히지
// 않으면 그 경보의 줄은 표시값으로 만들고 어떤 필드가 못 읽혔는지 missingByAlert에 남깁니다.
// 계정은 없을 수 있어 표시값 (없음)으로 둡니다. 그래서 원본 경보 건수와 추출 행 수가 같습니다.
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const NO_ACCOUNT = '(없음)';
const NO_VALUE = '(읽지 못함)';

const SECRET_KEY_VALUE = /\b(pass(?:word|wd)?|pwd|token|secret|api[_-]?key|authorization|session(?:id)?|cookie)\s*[=:]\s*[^\s&,;]+/giu;
const BEARER_VALUE = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gu;

function mask(text) {
  return text
    .replace(SECRET_KEY_VALUE, (_match, key) => `${key}=[가림]`)
    .replace(BEARER_VALUE, 'Bearer [가림]');
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function extractOne(rawAlert) {
  const missing = [];
  const alert = isObject(rawAlert) ? rawAlert : {};
  const rule = isObject(alert.rule) ? alert.rule : {};
  const data = isObject(alert.data) ? alert.data : {};

  const timeOk = typeof alert.timestamp === 'string' && !Number.isNaN(Date.parse(alert.timestamp));
  if (!timeOk) missing.push('timestamp');
  if (typeof data.srcip !== 'string') missing.push('data.srcip');
  if (typeof rule.level !== 'number') missing.push('rule.level');
  if (typeof rule.description !== 'string') missing.push('rule.description');

  return {
    alertId: typeof alert.id === 'string' ? alert.id : null,
    record: {
      time: timeOk ? alert.timestamp : NO_VALUE,
      sourceIp: typeof data.srcip === 'string' ? data.srcip : NO_VALUE,
      account: typeof data.srcuser === 'string' ? data.srcuser : NO_ACCOUNT,
      ruleLevel: typeof rule.level === 'number' ? rule.level : null,
      description: typeof rule.description === 'string' ? mask(rule.description) : NO_VALUE,
    },
    missing,
  };
}

// fixturePath의 경보를 읽어 { records, alertIds, missingByAlert, originalCount }를 돌려줍니다.
export function readAlerts(fixturePath) {
  const raw = JSON.parse(readFileSync(fixturePath, 'utf8'));
  if (!Array.isArray(raw?.alerts)) throw new TypeError('invalid_fixture_shape');

  const extracted = raw.alerts.map(extractOne);
  const records = extracted.map((item) => item.record);
  const alertIds = extracted.map((item) => item.alertId);
  const missingByAlert = extracted
    .map((item, index) => ({ alertId: item.alertId ?? `#${index + 1}`, missing: item.missing }))
    .filter((item) => item.missing.length > 0);

  if (records.length !== raw.alerts.length || alertIds.length !== raw.alerts.length) {
    throw new Error('alert_extraction_count_mismatch');
  }
  return { records, alertIds, missingByAlert, originalCount: raw.alerts.length };
}

// node xdr/exfiltration/read-alerts.mjs 로 단독 실행하면 경보마다 한 줄을 표준 출력에 찍고, 원본
// 건수와 줄 수의 비교 요약은 표준 오류에 따로 찍습니다. 다른 모듈이 불러 쓸 때는 실행되지 않습니다.
const isMainModule = process.argv[1]
  && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  const defaultFixturePath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'exfiltration.json');
  const { records, originalCount, missingByAlert } = readAlerts(defaultFixturePath);
  const lines = records.map((record) => (
    `${record.time} | ${record.sourceIp} | ${record.account} | 수준 ${record.ruleLevel ?? NO_VALUE} | ${record.description}`
  ));
  for (const line of lines) process.stdout.write(`${line}\n`);
  process.stderr.write(
    `read-alerts 단독 실행 완료 · 원본 경보 ${originalCount}건 · 출력 ${lines.length}줄 (${lines.length === originalCount ? '건수 일치' : '건수 불일치'}) · 필드 누락 경보 ${missingByAlert.length}건\n`,
  );
  if (lines.length !== originalCount) process.exitCode = 1;
}
