// 권한 가로채기(관리자 그룹 추가·관리자 명령) 경보 한 건을 패턴과 맞춰 { action, confidence, reason }을
// 돌려줍니다. 심판은 인터넷 없이 이 파일 하나만 불러와 경보마다 바로 답을 받으므로, import 문을
// 쓰지 않고 파일을 읽거나 쓰지도 않으며 바깥에 묻지 않습니다. 호출 간 상태도 없고, 입력이 비었거나
// 자료형이 달라도 예외 없이 형식에 맞는 응답을 돌려줍니다.
//
// 아래 패턴은 xdr/privilege/patterns.json을 그대로 옮겨 적은 것입니다. patterns.json을 고치면
// 여기도 같이 고쳐 주세요(npm run xdr:run -- privilege 가 두 파일의 일치를 확인합니다).
//
// 판단 원칙
//  - 경보 하나만 봅니다. 다른 경보와의 순서나 "그룹 추가 뒤 명령" 같은 관계는 추측하지 않고, 이 경보의
//    설명이 스스로 밝힌 사실만 씁니다.
//  - 기준 없음: 평소 관리자 명령 목록·업무 시간·승인 정보는 제공되지 않습니다. 그래서 임의의 기준으로
//    정상/비정상을 확정하지 않고, 설명이 밝힌 보강 증거(처음 보는·원격 주소, 업무 시간 밖, 방금·곧바로,
//    다른 계정의 권한, 여러 계정)와 권한 사건의 조합만 씁니다. 시각 값만으로 야간 여부를 판단하지 않습니다.
//  - block: 권한 사건(관리자 권한 부여 또는 관리자 명령 실행)에 서로 다른 보강 증거가 조합될 때만.
//    관리자 그룹 추가·관리자 명령·야간·높은 규칙 수준 하나만으로는 block하지 않습니다.
//  - 단순 그룹 변경을 취약점 악용(T1068)이라고 단정하지 않습니다. rule.mitre·계정 이름·경보 ID·
//    출발 주소·묶음 표시는 읽지 않습니다. reason에는 패턴 이름과 고정 문장만 넣습니다.
const BLOCK_THRESHOLD = 0.85;
const ALERT_THRESHOLD = 0.5;
const ATTENTION_RULE_LEVEL = 5;
const MULTI_ACCOUNT_COUNT = 3;
const BOOST = 0.02;
const CAP = 0.99;

const PATTERNS = Object.freeze([
  {
    name: 'admin_command_after_fresh_elevation',
    confidence: 0.93,
    reference: 'T1078·T1098: 계정이 관리자 권한을 얻은 직후 관리자 명령을 실행하는 것은 가로챈 계정의 권한 상승 사용에 전형적인 연속 동작입니다.',
  },
  {
    name: 'privilege_grant_followed_by_command',
    confidence: 0.92,
    reference: 'T1098·T1078: 같은 사건 안에서 권한 부여와 명령 실행이 이어지면 계정 조작 뒤 즉시 권한을 쓴 것입니다.',
  },
  {
    name: 'admin_command_unfamiliar_context',
    confidence: 0.9,
    reference: 'T1078: 평소와 다른 주소나 시간대에서의 관리자 명령은 정상 계정이 도용됐을 가능성을 보여 줍니다.',
  },
  {
    name: 'admin_command_other_account_privilege',
    confidence: 0.9,
    reference: 'T1078: 다른 계정의 권한으로 관리자 명령을 실행하는 것은 계정 자격 증명 도용·가장의 흔적입니다.',
  },
  {
    name: 'admin_group_add_multiple_accounts',
    confidence: 0.89,
    reference: 'T1098: 한꺼번에 여러 계정을 관리자 그룹에 넣는 것은 개별 관리 작업이 아니라 권한 확대 시도에 가깝습니다.',
  },
  {
    name: 'admin_group_add_unfamiliar_origin',
    confidence: 0.88,
    reference: 'T1098·T1078: 평소와 다른 출처에서 이뤄진 관리자 권한 부여는 가로챈 계정으로 한 조작일 수 있습니다.',
  },
  {
    name: 'admin_group_add_off_hours',
    confidence: 0.87,
    reference: 'T1098: 업무 시간 밖의 관리자 권한 부여는 정상 관리 작업과 구분되는 보강 증거입니다. 시각만으로는 판단하지 않고 설명이 밝힌 경우에만 씁니다.',
  },
  {
    name: 'admin_group_membership_reapplied',
    confidence: 0.65,
    reference: 'T1098: 빠졌다가 다시 들어온 구성원은 실수 정정 같은 정상 관리 작업일 수도 있어 단독으로는 알림으로만 남깁니다.',
  },
  {
    name: 'admin_privilege_event_single_signal',
    confidence: 0.6,
    reference: 'T1098·T1078: 관리자 권한 사건 하나만으로는 정상 관리 작업과 구분할 수 없어 사람이 볼 수 있게 알림으로만 남깁니다.',
  },
  {
    name: 'account_privilege_wording_attention',
    confidence: 0.5,
    reference: 'T1098: 권한 관련 사건이지만 실제 권한 상승이 확인되지 않아 알림으로만 남깁니다.',
  },
]);

const DEFAULTS = Object.freeze({
  no_known_privilege_pattern: { confidence: 0.05, reference: '알려진 권한 가로채기 패턴과 맞지 않는 사건입니다.' },
  below_attention_level: { confidence: 0.2, reference: '권한 관련 낱말은 있으나 규칙 수준이 5 미만이라 기록만 남깁니다.' },
});

// 설명 문장 안의 사실. 문장이 아니다·없다·취소로 끝나면 그 문장의 행위는 부정된 것으로 봅니다.
const NEGATED_SENTENCE = /(?:아닙니다|없습니다|취소됐습니다|않았습니다)\s*$/u;
const ADMIN_GROUP_ADD = /관리자\s*그룹(?:에)?\s*(?:추가|들어|포함)/u;
const BECAME_ADMIN = /관리자(?:가|로)\s*(?:된|되|들어|바뀌)|관리자\s*권한으로\s*바뀌/u;
const GROUP_ADD_WORD = /추가|들어|포함/u;
const ADMIN_COMMAND = /(?:관리자|권한)\s*명령/u;
const COMMAND_EXECUTED = /실행(?:했|됐|이)/u;
const GENERIC_COMMAND = /명령\s*실행/u;
const FRESH = /방금|곧바로|직후|즉시/u;
const UNFAMILIAR = /처음\s*(?:보는|봅니다)|원격\s*주소/u;
const OFF_HOURS = /(?:수업|업무)\s*시간\s*밖|업무처럼\s*보이지\s*않는\s*시각/u;
const OTHER_ACCOUNT = /다른\s*계정의\s*권한/u;
const ACCOUNT_COUNT = /계정\s*(\d+)\s*개/u;
const READDED = /빠진[^.]*다시/u;
const WEAK_WORD = /계정|그룹|권한|관리자|세션|승격/u;
const ADMIN_GROUP_NAME = /^admin/iu;

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
    const text = typeof rule.description === 'string' ? rule.description.slice(0, 2000) : '';
    const adminGroup = typeof data.group === 'string' && ADMIN_GROUP_NAME.test(data.group);

    const sentences = text.split(/[.。]/u).map((part) => part.trim()).filter(Boolean);
    const facts = {
      privChange: false, adminCommand: false, genericCommand: false, fresh: false, unfamiliar: false,
      offHours: false, otherAccount: false, readded: false, multiInText: 0,
    };
    for (const sentence of sentences) {
      if (NEGATED_SENTENCE.test(sentence)) continue; // 부정된 문장의 행위는 세지 않습니다.
      if (ADMIN_GROUP_ADD.test(sentence) || BECAME_ADMIN.test(sentence)
          || (adminGroup && GROUP_ADD_WORD.test(sentence))) facts.privChange = true;
      if (ADMIN_COMMAND.test(sentence) && COMMAND_EXECUTED.test(sentence)) facts.adminCommand = true;
      if (GENERIC_COMMAND.test(sentence)) facts.genericCommand = true;
      if (FRESH.test(sentence)) facts.fresh = true;
      if (UNFAMILIAR.test(sentence)) facts.unfamiliar = true;
      if (OFF_HOURS.test(sentence)) facts.offHours = true;
      if (OTHER_ACCOUNT.test(sentence)) facts.otherAccount = true;
      if (READDED.test(sentence)) facts.readded = true;
      const accounts = ACCOUNT_COUNT.exec(sentence);
      if (accounts) facts.multiInText = Math.max(facts.multiInText, Number(accounts[1]) || 0);
    }
    const command = facts.adminCommand || (facts.genericCommand && facts.privChange);
    const multi = Math.max(readCount(data), facts.multiInText) >= MULTI_ACCOUNT_COUNT;
    const privilegeEvent = facts.privChange || command;
    const attention = level >= ATTENTION_RULE_LEVEL;
    const corroborations = Math.max(0, [
      facts.fresh, facts.unfamiliar, facts.offHours, facts.otherAccount, multi, facts.privChange && command,
    ].filter(Boolean).length - 1);

    // 1) 명확한 권한 가로채기: 권한 사건 + 서로 다른 보강 증거(경보 하나에 적힌 사실만)
    if (command && facts.fresh) return fromPattern('admin_command_after_fresh_elevation', corroborations);
    if (facts.privChange && command) return fromPattern('privilege_grant_followed_by_command', corroborations);
    if (command && (facts.unfamiliar || facts.offHours)) return fromPattern('admin_command_unfamiliar_context', corroborations);
    if (command && facts.otherAccount) return fromPattern('admin_command_other_account_privilege', corroborations);
    if (facts.privChange && multi) return fromPattern('admin_group_add_multiple_accounts', corroborations);
    if (facts.privChange && facts.unfamiliar) return fromPattern('admin_group_add_unfamiliar_origin', corroborations);
    if (facts.privChange && facts.offHours) return fromPattern('admin_group_add_off_hours', corroborations);

    // 2) 애매한 시도: 증거 하나만 있거나 되돌려진 변경
    if (facts.privChange && facts.readded) return fromPattern('admin_group_membership_reapplied');
    if (privilegeEvent && attention) return fromPattern('admin_privilege_event_single_signal');
    if (WEAK_WORD.test(text)) {
      return attention ? fromPattern('account_privilege_wording_attention') : fromDefault('below_attention_level');
    }
    return fromDefault('no_known_privilege_pattern');
  } catch {
    return result('record', 0, '일치 패턴 없음(decide_error): 판단 중 오류가 나 기록만 남깁니다.');
  }
}
