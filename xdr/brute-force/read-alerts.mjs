// Wazuh 형식 경보(합성 시험 자료)에서 시각·출발 주소·계정·규칙 수준·설명만 뽑습니다.
// 원본 파일은 읽기만 하고 고치지 않습니다. 비밀값으로 보이는 필드는 추출하지 않습니다.
import { readFileSync } from 'node:fs';

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
