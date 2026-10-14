// 지속성(서비스·예약 작업·시작 폴더) 악용 경보 한 건을 패턴과 맞춰 { action, confidence, reason }을
// 돌려줍니다. 심판은 인터넷 없이 이 파일 하나만 불러와 경보마다 바로 답을 받으므로, import 문을
// 쓰지 않고 파일을 읽거나 쓰지도 않으며 바깥에 묻지 않습니다. 호출 간 상태도 없고, 입력이 비었거나
// 자료형이 달라도 예외 없이 형식에 맞는 응답을 돌려줍니다.
//
// 아래 패턴은 xdr/persistence/patterns.json을 그대로 옮겨 적은 것입니다. patterns.json을 고치면
// 여기도 같이 고쳐 주세요(npm run xdr:run -- persistence 가 두 파일의 일치를 확인합니다).
//
// 판단 원칙
//  - 기준 목록 없음: 평소 서비스·예약 작업·시작 항목 목록과 서명 승인 목록은 제공되지 않습니다. 그래서
//    "목록 밖"을 직접 판정하지 않고, 경보 설명이 스스로 밝힌 사실(처음 보는, 평소 목록에 없는, 서명 없음,
//    실행 파일이 바뀜)과 경로·반복·규칙 수준의 조합만 증거로 씁니다.
//  - block: 지속 수단(서비스·예약 작업·시작 항목)이 확인되고 서로 다른 보강 증거가 조합으로 맞을 때만.
//    서명 없음·새 항목·높은 규칙 수준·임시 폴더 경로 중 어느 하나만으로는 block하지 않습니다.
//  - 서명이 있다는 이유만으로 정상으로 확정하지 않습니다(다른 증거 조합은 그대로 평가).
//  - rule.mitre는 기법 분류라 읽지 않고, 경보 ID·출발 주소·묶음 표시도 쓰지 않습니다.
//  - reason에는 근거 패턴 이름과 고정 문장만 넣고 경로·명령 원문을 복사하지 않습니다.
const BLOCK_THRESHOLD = 0.85;
const ALERT_THRESHOLD = 0.5;
const ATTENTION_RULE_LEVEL = 5;
const STARTUP_BLOCK_RULE_LEVEL = 10;
const REPEATED_COUNT = 3;
const BOOST = 0.02;
const CAP = 0.99;

const PATTERNS = Object.freeze([
  {
    name: 'unsigned_persistence_temp_path',
    confidence: 0.95,
    reference: 'T1543·T1053·T1547.001: 서명 없는 프로그램이 임시 폴더에서 서비스·예약 작업·시작 항목으로 걸리는 것은 지속성 설치의 전형적인 조합입니다.',
  },
  {
    name: 'persistence_multi_vector_temp_file',
    confidence: 0.93,
    reference: 'T1543·T1053·T1547.001: 같은 임시 파일을 여러 지속 수단이 함께 가리키면 다시 켜도 살아남게 겹겹이 심은 것입니다.',
  },
  {
    name: 'unsigned_service_repeated_or_remote',
    confidence: 0.92,
    reference: 'T1543: 서명 없는 서비스 등록이 반복되거나 원격에서 오면 관리 작업보다 자동화된 설치에 가깝습니다.',
  },
  {
    name: 'new_persistence_temp_path',
    confidence: 0.9,
    reference: 'T1543·T1053: 평소에 없던 항목이 임시 폴더의 프로그램을 가리키는 것은 새로 심은 프로그램의 전형입니다.',
  },
  {
    name: 'random_task_name_temp_path',
    confidence: 0.88,
    reference: 'T1053: 임의 문자열 이름의 작업이 임시 폴더 프로그램을 실행하는 것은 자동 생성된 악성 작업의 흔적입니다.',
  },
  {
    name: 'startup_folder_new_entry',
    confidence: 0.86,
    reference: 'T1547.001: 시작 폴더에 평소 목록에 없는 실행 항목이 추가되면 로그온 때 자동 실행되는 지속 수단일 수 있습니다. 새 항목·시작 폴더 경로·높은 규칙 수준이 함께 있을 때만 block합니다.',
  },
  {
    name: 'persistence_unknown_signature',
    confidence: 0.6,
    reference: 'T1543·T1053·T1547.001: 서명 여부를 모르는 새 지속 항목은 수업 도구일 수도 있어 단정하지 않고 알림으로만 남깁니다.',
  },
  {
    name: 'temp_executable_without_registration',
    confidence: 0.6,
    reference: 'T1543: 임시 폴더의 실행 파일만으로는 지속성이 확인되지 않아 알림으로만 남깁니다.',
  },
  {
    name: 'persistence_event_attention',
    confidence: 0.5,
    reference: 'T1543·T1053·T1547.001: 지속 수단 관련 사건이지만 악용 증거가 부족해 사람이 볼 수 있게 알림으로만 남깁니다.',
  },
]);

const DEFAULTS = Object.freeze({
  no_known_persistence_pattern: { confidence: 0.05, reference: '알려진 지속성 악용 패턴과 맞지 않는 사건입니다.' },
  below_attention_level: { confidence: 0.2, reference: '관련 낱말은 있으나 규칙 수준이 5 미만이라 기록만 남깁니다.' },
});

// 지속 수단 낱말(설명 문장 안). 한 문장에서 부정되면(없습니다·그대로입니다) 세지 않습니다.
const KIND_WORDS = Object.freeze({
  service: /서비스/u,
  scheduled: /예약\s*작업|작업\s*예약|예약이/u,
  startup: /시작\s*(?:폴더|프로그램|항목)/u,
});
const NEGATED_SENTENCE = /(?:등록|기록|변경|실행|항목)[은는이가]\s*없습니다\s*$|그대로입니다\s*$/u;
const UNSIGNED = /서명\s*(?:이|은)?\s*없/u;
const UNKNOWN_SIGNATURE = /서명은\s*(?:아직\s*)?(?:확인되지|모릅|모른)/u;
const NEW_ITEM = /처음\s*보는|새\s*서비스|새로\s*(?:등록|생성|추가)|평소\s*목록에\s*없|목록에\s*없|목록\s*밖/u;
const RANDOM_NAME = /임의\s*문자열/u;
const CHANGED_BINARY = /실행\s*파일이\s*바뀌|파일이\s*교체|변조/u;
const OFF_HOURS = /(?:수업|업무)\s*시간\s*밖|시간\s*밖/u;
const PERSISTS = /다시\s*켜도\s*남|재부팅\s*(?:뒤|후)|부팅\s*(?:뒤|후)에도/u;
const REMOTE = /원격\s*주소|원격에서/u;
const REPEAT_IN_TEXT = /연속으로\s*(\d+)\s*건|(\d+)\s*(?:번|회)\s*반복/u;
const TEMP_PATH = /\\(?:appdata\\local\\)?temp\\|\\tmp\\|%temp%|\/tmp\//u;
const STARTUP_PATH = /\\start menu\\programs\\startup\\|\\startup\\/u;

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

// 설명 문장을 나눠 부정되지 않은 지속 수단과 증거를 읽습니다.
function readDescription(text) {
  const sentences = text.split(/[.。]/u).map((part) => part.trim()).filter(Boolean);
  const kinds = new Set();
  const facts = {
    unsigned: false, unknownSignature: false, isNew: false, randomName: false, changedBinary: false,
    offHours: false, persists: false, remote: false, repeatedInText: 0,
  };
  for (const sentence of sentences) {
    if (NEGATED_SENTENCE.test(sentence)) continue; // "서비스 등록은 없습니다" 같은 문장은 증거가 아닙니다.
    for (const [kind, pattern] of Object.entries(KIND_WORDS)) if (pattern.test(sentence)) kinds.add(kind);
    if (UNSIGNED.test(sentence)) facts.unsigned = true;
    if (UNKNOWN_SIGNATURE.test(sentence)) facts.unknownSignature = true;
    if (NEW_ITEM.test(sentence)) facts.isNew = true;
    if (RANDOM_NAME.test(sentence)) facts.randomName = true;
    if (CHANGED_BINARY.test(sentence)) facts.changedBinary = true;
    if (OFF_HOURS.test(sentence)) facts.offHours = true;
    if (PERSISTS.test(sentence)) facts.persists = true;
    if (REMOTE.test(sentence)) facts.remote = true;
    const repeat = REPEAT_IN_TEXT.exec(sentence);
    if (repeat) facts.repeatedInText = Math.max(facts.repeatedInText, Number(repeat[1] ?? repeat[2]) || 0);
  }
  return { kinds, facts };
}

function readCount(data) {
  const value = data.count;
  const number = typeof value === 'number' ? value : (typeof value === 'string' ? Number(value) : NaN);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

export function decide(alert) {
  try {
    if (!isObject(alert)) return result('record', 0, '일치 패턴 없음(invalid_alert): 경보 형식을 읽지 못해 기록만 남깁니다.');
    const data = isObject(alert.data) ? alert.data : {};
    const rule = isObject(alert.rule) ? alert.rule : {};
    const level = typeof rule.level === 'number' && Number.isFinite(rule.level) ? rule.level : 0;
    const text = typeof rule.description === 'string' ? rule.description.slice(0, 2000).toLowerCase() : '';
    const path = typeof data.path === 'string' ? data.path.slice(0, 1024).toLowerCase() : '';

    const { kinds, facts } = readDescription(text);
    const hasKind = kinds.size > 0;
    const inTemp = TEMP_PATH.test(path);
    const inStartup = STARTUP_PATH.test(path);
    const repeated = Math.max(readCount(data), facts.repeatedInText) >= REPEATED_COUNT;
    const corroborations = [facts.changedBinary, facts.offHours, facts.persists, repeated || facts.remote]
      .filter(Boolean).length;
    const attention = level >= ATTENTION_RULE_LEVEL;

    // 1) 명확한 지속성 악용: 지속 수단 + 서로 다른 증거의 조합
    if (hasKind && inTemp && facts.unsigned) return fromPattern('unsigned_persistence_temp_path', corroborations);
    if (kinds.size >= 2 && inTemp) return fromPattern('persistence_multi_vector_temp_file', corroborations);
    if (hasKind && facts.unsigned && (repeated || facts.remote)) {
      return fromPattern('unsigned_service_repeated_or_remote', corroborations);
    }
    if (hasKind && inTemp && facts.isNew) return fromPattern('new_persistence_temp_path', corroborations);
    if (hasKind && inTemp && facts.randomName) return fromPattern('random_task_name_temp_path', corroborations);
    if (kinds.has('startup') && facts.isNew && inStartup && level >= STARTUP_BLOCK_RULE_LEVEL) {
      return fromPattern('startup_folder_new_entry', corroborations);
    }

    // 2) 애매한 시도: 증거 하나만 있거나 서명을 모르는 경우
    if (hasKind && facts.unknownSignature && attention) return fromPattern('persistence_unknown_signature');
    if (!hasKind && inTemp && attention) return fromPattern('temp_executable_without_registration');
    if (hasKind && attention) return fromPattern('persistence_event_attention');

    // 3) 낱말은 있으나 규칙 수준이 낮은 경우와 그 밖
    if (hasKind || inTemp) return fromDefault('below_attention_level');
    return fromDefault('no_known_persistence_pattern');
  } catch {
    return result('record', 0, '일치 패턴 없음(decide_error): 판단 중 오류가 나 기록만 남깁니다.');
  }
}
