// Wazuh 형식 경보(합성 시험 자료)에서 시각·출발 주소·계정·규칙 수준·설명만 뽑습니다.
// 원본 파일은 읽기만 하고 고치지 않습니다. 비밀값으로 보이는 필드는 추출하지 않습니다.
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED_FIELDS = ['id', 'timestamp', 'rule', 'data'];

function extractOne(rawAlert) {
  for (const field of REQUIRED_FIELDS) {
    if (!(field in rawAlert)) throw new TypeError(`invalid_alert_missing_${field}`);
  }
  const { timestamp, rule, data } = rawAlert;
  if (typeof timestamp !== 'string' || Number.isNaN(Date.parse(timestamp))) {
    throw new TypeError('invalid_alert_timestamp');
  }
  if (typeof data?.srcip !== 'string' || typeof data?.srcuser !== 'string') {
    throw new TypeError('invalid_alert_data');
  }
  if (typeof rule?.level !== 'number' || typeof rule?.description !== 'string') {
    throw new TypeError('invalid_alert_rule');
  }
  return {
    time: timestamp,
    sourceIp: data.srcip,
    account: data.srcuser,
    ruleLevel: rule.level,
    description: rule.description,
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

// node xdr/brute-force/read-alerts.mjs 로 단독 실행해도 "경보 건수와 뽑은 줄
// 수가 같아야 합니다"를 바로 확인할 수 있도록, 기본 fixture를 읽어 두 건수를
// 찍습니다. npm run xdr:run 등 다른 모듈이 이 파일을 불러 쓸 때는(메인 모듈이
// 아닐 때는) 실행되지 않습니다.
const isMainModule = process.argv[1]
  && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  const defaultFixturePath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'brute-force.json');
  const { records, alertIds, originalCount } = readAlerts(defaultFixturePath);
  process.stdout.write(
    `read-alerts 단독 실행 완료 · 원본 경보 ${originalCount}건 · 추출 ${records.length}건 · 근거 경보 번호 ${alertIds.length}건 (${records.length === originalCount ? '건수 일치' : '건수 불일치'})\n`,
  );
  if (records.length !== originalCount) process.exitCode = 1;
}
