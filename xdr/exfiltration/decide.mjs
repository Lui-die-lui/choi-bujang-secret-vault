// 외부 전송(자료 빼돌리기) 경보 한 건을 패턴과 맞춰 { action, confidence, reason }을 돌려줍니다.
// 심판은 인터넷 없이 이 파일 하나만 불러와 경보마다 바로 답을 받으므로, import 문을 쓰지 않고
// 파일을 읽거나 쓰지도 않으며 바깥에 묻지 않습니다. 호출 간 상태도 없고, 입력이 비었거나 자료형이
// 달라도 예외 없이 형식에 맞는 응답을 돌려줍니다.
//
// 아래 패턴은 xdr/exfiltration/patterns.json을 그대로 옮겨 적은 것입니다. patterns.json을 고치면
// 여기도 같이 고쳐 주세요(npm run xdr:run -- exfiltration 이 두 파일의 일치를 확인합니다).
//
// 판단 원칙
//  - 경보 하나만 봅니다. 과거 전송 기록이나 다른 경보와의 관계는 추측하지 않습니다.
//  - 기준 없음: 평소 전송량·기존 목적지 목록·업무 시간·승인된 백업 정보는 제공되지 않습니다. 그래서
//    "처음 보는 목적지"·"업무 시간 밖"을 임의의 목록으로 확정하지 않고 설명이 밝힌 사실만 증거로 씁니다.
//  - 큰 전송 기준(50,000,000 바이트)은 과제가 제공한 기준이 아니라 이 연습 경보를 보고 정한 구현상
//    휴리스틱입니다. 전송량이 없거나 숫자가 아니면 0이 아니라 "알 수 없음"으로 다루며 큰 전송으로
//    치지 않습니다.
//  - block: 외부 전송이 일어났고 큰 전송이며 설명이 밝힌 보강 증거가 하나 이상 있을 때만. 대용량·압축
//    파일·새 목적지·업무 시간 밖·높은 규칙 수준 중 어느 하나만으로는 block하지 않습니다.
//  - T1041(명령 통로)·T1048(다른 프로토콜)은 설명이 직접 밝힌 경우에만 근거로 연결하고, 일반적인 외부
//    전송을 특정 기법으로 단정하지 않습니다. rule.mitre·계정·주소·경보 ID·묶음 표시는 읽지 않습니다.
//  - reason에는 패턴 이름과 고정 문장만 넣고 주소·파일 이름·전송량을 복사하지 않습니다.
const BLOCK_THRESHOLD = 0.85;
const ALERT_THRESHOLD = 0.5;
const ATTENTION_RULE_LEVEL = 5;
const LARGE_TRANSFER_BYTES = 50000000;
const REPEATED_COUNT = 3;
const BULK_FILES = 50;
const BOOST = 0.02;
const CAP = 0.99;

const PATTERNS = Object.freeze([
  {
    name: 'large_transfer_multi_signal',
    confidence: 0.93,
    reference: 'T1041·T1048: 큰 전송에 서로 다른 보강 증거가 겹치면 정상 업무 전송과 구분되는 자료 반출입니다.',
  },
  {
    name: 'large_transfer_unusual_channel',
    confidence: 0.9,
    reference: 'T1048·T1041: 평소 쓰지 않던 통로나 명령 통로로 나가는 큰 전송은 대체 프로토콜·C2 통로 유출의 알려진 형태입니다(설명이 직접 밝힌 경우만).',
  },
  {
    name: 'large_transfer_new_destination',
    confidence: 0.89,
    reference: 'T1048: 처음 보는 목적지로 나가는 큰 전송은 평소 전송과 구분되는 반출 후보입니다. 목적지 목록이 제공되지 않아 설명이 밝힌 경우에만 씁니다.',
  },
  {
    name: 'large_repeated_transfer',
    confidence: 0.88,
    reference: 'T1048: 큰 전송이 반복되면 일회성 업무 전송보다 지속적인 반출에 가깝습니다.',
  },
  {
    name: 'large_bulk_file_transfer',
    confidence: 0.88,
    reference: 'T1048: 한꺼번에 많은 파일이 나가는 것은 자료 수집 뒤 일괄 반출의 알려진 형태입니다.',
  },
  {
    name: 'large_off_hours_transfer',
    confidence: 0.87,
    reference: 'T1048: 업무 시간 밖의 큰 전송은 정상 업무와 구분되는 보강 증거입니다.',
  },
  {
    name: 'large_archive_transfer',
    confidence: 0.87,
    reference: 'T1048: 자료를 압축 파일로 묶어 내보내는 것은 반출 전 준비의 알려진 형태입니다.',
  },
  {
    name: 'transfer_with_context_below_volume',
    confidence: 0.6,
    reference: 'T1048: 보강 증거는 있으나 전송량이 작아 반출로 단정하지 않고 알림으로만 남깁니다.',
  },
  {
    name: 'large_transfer_without_context',
    confidence: 0.6,
    reference: '대용량 하나만으로는 정상 백업·업무 전송과 구분할 수 없어 알림으로만 남깁니다.',
  },
  {
    name: 'routine_looking_transfer',
    confidence: 0.55,
    reference: '정상 업무 전송처럼 보이지만 규모가 달라 사람이 볼 수 있게 알림으로만 남깁니다(승인 정보는 제공되지 않음).',
  },
  {
    name: 'archive_or_bulk_without_confirmed_send',
    confidence: 0.55,
    reference: 'T1048 준비 단계일 수 있으나 외부 전송이 확인되지 않아 알림으로만 남깁니다.',
  },
  {
    name: 'exfil_wording_attention',
    confidence: 0.5,
    reference: 'T1048: 전송 관련 사건이지만 반출 증거가 부족해 알림으로만 남깁니다.',
  },
]);

const DEFAULTS = Object.freeze({
  no_known_exfiltration_pattern: { confidence: 0.05, reference: '알려진 자료 반출 패턴과 맞지 않는 사건입니다.' },
  below_attention_level: { confidence: 0.2, reference: '전송 관련 낱말은 있으나 규칙 수준이 5 미만이라 기록만 남깁니다.' },
});

// 전송이 일어났다는 설명과, 일어나지 않았다는 설명(실패·아직 없음·없음)
const SENT = /나갔|올라갔|복사됐|전송됐|전송이|전송은\s*\d+\s*건/u;
const NOT_SENT = /전송은\s*(?:아직\s*)?없|실패|외부\s*전송은\s*아직/u;
const NEW_DESTINATION = /처음\s*(?:보는|봅니다)|평소와\s*다른\s*주소/u;
const OFF_HOURS = /(?:수업|업무)\s*시간\s*밖/u;
const ARCHIVE = /압축\s*파일/u;
const UNUSUAL_PORT = /쓰지\s*않던\s*포트/u;
const COMMAND_CHANNEL = /명령\s*통로/u;
const BULK_WORDING = /자료실\s*전체|\d+\s*건이\s*한\s*번에\s*읽/u;
const ROUTINE_WORDING = /수업\s*자료\s*주소|평소\s*목적지|백업처럼/u;
const WEAK_WORD = /전송|목적지|주소로|통로|압축|포트|복사|읽힌|나갔|올라갔/u;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function result(action, confidence, reason) {
  return { action, confidence, reason };
}

function byName(name) {
  return PATTERNS.find((pattern) => pattern.name === name);
}

function fromPattern(name, corroborations = 0) {
  const pattern = byName(name);
  const boosted = pattern.confidence >= BLOCK_THRESHOLD
    ? Math.min(CAP, Math.round((pattern.confidence + BOOST * corroborations) * 100) / 100)
    : pattern.confidence;
  const action = boosted >= BLOCK_THRESHOLD ? 'block' : (boosted >= ALERT_THRESHOLD ? 'alert' : 'record');
  return result(action, boosted, `패턴 ${pattern.name}: ${pattern.reference}`);
}

function fromDefault(key) {
  return result('record', DEFAULTS[key].confidence, `일치 패턴 없음(${key}): ${DEFAULTS[key].reference}`);
}

// 전송량을 바이트 숫자로 바꿉니다. 단위가 없으면 바이트, KB·MB·GB는 1024 단위. 읽을 수 없으면 null.
function readBytes(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== 'string') return null;
  const match = /^\s*(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|바이트)?\s*$/iu.exec(value);
  if (!match) return null;
  const factor = { kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 }[(match[2] ?? '').toLowerCase()] ?? 1;
  const bytes = Number(match[1]) * factor;
  return Number.isFinite(bytes) ? bytes : null;
}

function readCount(value) {
  const number = typeof value === 'number' ? value : (typeof value === 'string' ? Number(value) : NaN);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

export function decide(alert) {
  try {
    if (!isObject(alert)) return result('record', 0, '일치 패턴 없음(invalid_alert): 경보 형식을 읽지 못해 기록만 남깁니다.');
    const data = isObject(alert.data) ? alert.data : {};
    const rule = isObject(alert.rule) ? alert.rule : {};
    const level = typeof rule.level === 'number' && Number.isFinite(rule.level) ? rule.level : 0;
    const text = typeof rule.description === 'string' ? rule.description.slice(0, 2000) : '';
    const bytes = readBytes(data.bytes);
    const files = readCount(data.files);
    const count = readCount(data.count);

    const sentences = text.split(/[.。]/u).map((part) => part.trim()).filter(Boolean);
    const facts = {
      sent: false, newDestination: false, offHours: false, archive: false, unusualPort: false,
      commandChannel: false, bulkWording: false,
    };
    for (const sentence of sentences) {
      if (NOT_SENT.test(sentence)) {
        // 전송이 없었거나 실패했다고 밝힌 문장입니다. 압축 파일 같은 준비 단계 사실은 아래에서 세지만
        // 전송이 일어났다고 보지 않습니다.
        if (ARCHIVE.test(sentence)) facts.archive = true;
        if (NEW_DESTINATION.test(sentence)) facts.newDestination = true;
        continue;
      }
      if (SENT.test(sentence)) facts.sent = true;
      if (NEW_DESTINATION.test(sentence)) facts.newDestination = true;
      if (OFF_HOURS.test(sentence)) facts.offHours = true;
      if (ARCHIVE.test(sentence)) facts.archive = true;
      if (UNUSUAL_PORT.test(sentence)) facts.unusualPort = true;
      if (COMMAND_CHANNEL.test(sentence)) facts.commandChannel = true;
      if (BULK_WORDING.test(sentence)) facts.bulkWording = true;
    }
    const large = bytes !== null && bytes >= LARGE_TRANSFER_BYTES;
    const repeated = count >= REPEATED_COUNT;
    const bulk = files >= BULK_FILES || facts.bulkWording;
    const unusualChannel = facts.unusualPort || facts.commandChannel;
    const contexts = [facts.newDestination, facts.offHours, facts.archive, unusualChannel, repeated, bulk];
    const contextCount = contexts.filter(Boolean).length;
    const attention = level >= ATTENTION_RULE_LEVEL;
    const routine = ROUTINE_WORDING.test(text);

    // 1) 명확한 반출: 외부 전송 + 큰 전송 + 설명이 밝힌 보강 증거
    if (facts.sent && large && contextCount >= 2) return fromPattern('large_transfer_multi_signal', contextCount - 2);
    if (facts.sent && large && unusualChannel) return fromPattern('large_transfer_unusual_channel');
    if (facts.sent && large && facts.newDestination) return fromPattern('large_transfer_new_destination');
    if (facts.sent && large && repeated) return fromPattern('large_repeated_transfer');
    if (facts.sent && large && bulk) return fromPattern('large_bulk_file_transfer');
    if (facts.sent && large && facts.offHours) return fromPattern('large_off_hours_transfer');
    if (facts.sent && large && facts.archive) return fromPattern('large_archive_transfer');

    // 2) 애매한 시도: 증거 하나만 있거나 규모가 작음
    if (facts.sent && contextCount >= 1 && attention) return fromPattern('transfer_with_context_below_volume');
    if (facts.sent && large && attention) return fromPattern('large_transfer_without_context');
    if (routine && attention) return fromPattern('routine_looking_transfer');
    if (!facts.sent && (facts.archive || bulk) && attention) return fromPattern('archive_or_bulk_without_confirmed_send');
    if (WEAK_WORD.test(text)) {
      return attention ? fromPattern('exfil_wording_attention') : fromDefault('below_attention_level');
    }
    return fromDefault('no_known_exfiltration_pattern');
  } catch {
    return result('record', 0, '일치 패턴 없음(decide_error): 판단 중 오류가 나 기록만 남깁니다.');
  }
}
