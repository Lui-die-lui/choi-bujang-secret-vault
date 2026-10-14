// 알려진 취약점(CVE-2021-44228, Log4Shell) 악용 경보 한 건을 패턴과 맞춰
// { action, confidence, reason }을 돌려줍니다. 심판은 인터넷 없이 이 파일 하나만 불러와 경보마다
// 바로 답을 받으므로, import 문을 쓰지 않고 파일을 읽거나 쓰지도 않으며 바깥에 묻지 않습니다.
// 호출 간 상태도 없고, 입력이 비었거나 자료형이 달라도 예외 없이 형식에 맞는 응답을 돌려줍니다.
//
// 아래 패턴은 xdr/known-cve/patterns.json을 그대로 옮겨 적은 것입니다. patterns.json을 고치면
// 여기도 같이 고쳐 주세요(npm run xdr:run -- known-cve 가 두 파일의 일치를 확인합니다).
//
// 판단 원칙
//  - 명확한 악용(block): 요청 머리글·인자에 "완전한" JNDI 원격 조회 구문(${jndi:<전송>://)이 있을 때만.
//    jndi·log4j·CVE 번호 같은 낱말, 규칙 수준, 점검 도구 이름만으로는 block하지 않습니다.
//  - 애매한 시도(alert): 구문의 일부, 점검 도구 흔적, 낱말·설명만 있는 경우.
//  - 정상(record): 위 어디에도 맞지 않는 경우.
//  - rule.mitre(T1190)는 공격 기법 분류라 읽지 않습니다. 경보 ID·출발 주소·묶음 표시는 쓰지 않습니다.
//  - reason에는 근거 패턴 이름과 고정 문장만 넣고 요청 원문·비밀값을 복사하지 않습니다.
const BLOCK_THRESHOLD = 0.85;
const ALERT_THRESHOLD = 0.5;
const ATTENTION_RULE_LEVEL = 5;
const REPEATED_COUNT = 3;

const PATTERNS = Object.freeze([
  {
    name: 'jndi_lookup_scanner_trace',
    confidence: 0.97,
    reference: 'CVE-2021-44228 악용 구문에 T1595.002 점검 도구 흔적이 함께 있어 자동 점검 뒤 악용으로 이어진 요청입니다.',
  },
  {
    name: 'jndi_lookup_repeated',
    confidence: 0.95,
    reference: 'CVE-2021-44228 악용 구문이 여러 곳에 있거나 반복되면 우연한 입력으로 보기 어렵습니다.',
  },
  {
    name: 'jndi_lookup_in_request_header',
    confidence: 0.92,
    reference: 'CVE-2021-44228: 공격자가 통제하는 값이 로그에 남는 머리글에 JNDI 조회 구문을 넣는 알려진 악용 형태입니다.',
  },
  {
    name: 'jndi_lookup_in_request_argument',
    confidence: 0.9,
    reference: 'CVE-2021-44228: 요청 인자가 로그 메시지에 들어가는 지점을 노린 알려진 악용 형태입니다.',
  },
  {
    name: 'incomplete_lookup_fragment',
    confidence: 0.7,
    reference: 'CVE-2021-44228 악용 구문의 일부만 있는 시도로, 악용 여부를 단정할 수 없어 알림으로만 남깁니다.',
  },
  {
    name: 'scanner_tool_trace',
    confidence: 0.6,
    reference: 'MITRE ATT&CK T1595.002 절차 예시에 나오는 점검 도구의 흔적입니다. 점검만으로는 악용이 일어났다고 볼 수 없어 알림으로만 남깁니다.',
  },
  {
    name: 'lookup_syntax_in_description_only',
    confidence: 0.55,
    reference: '구문이 설명 문장에만 있고 요청에서 확인되지 않아 악용으로 단정하지 않고 알림으로만 남깁니다.',
  },
  {
    name: 'cve_or_component_reference_in_request',
    confidence: 0.55,
    reference: 'CVE-2021-44228 관련 낱말만으로는 악용 구문이 아니므로(검색·문서 열람일 수 있음) 알림으로만 남깁니다.',
  },
  {
    name: 'vuln_wording_in_description_only',
    confidence: 0.5,
    reference: '설명 문장의 낱말만으로는 악용을 확인할 수 없어 사람이 볼 수 있게 알림으로만 남깁니다.',
  },
]);

const DEFAULTS = Object.freeze({
  no_known_exploit_pattern: { confidence: 0.05, reference: '알려진 악용 패턴과 맞지 않는 요청입니다.' },
  below_attention_level: { confidence: 0.2, reference: '관련 낱말은 있으나 규칙 수준이 5 미만이라 기록만 남깁니다.' },
});

const LOOKUP_SCHEMES = ['ldap', 'ldaps', 'rmi', 'dns', 'iiop', 'nis', 'corba', 'http', 'https'];
const SCANNER_NAMES = ['vulmap', 'acunetix', 'masscan', 'jexboss', 'interactsh', 'interact.sh'];
const HEADER_FIELDS = ['useragent', 'user_agent', 'referer', 'referrer', 'header', 'headers'];
const IGNORED_DATA_FIELDS = ['srcip', 'srcuser', 'count', 'id'];

const FULL_LOOKUP = new RegExp(`\\$\\{\\s*jndi\\s*:\\s*(?:${LOOKUP_SCHEMES.join('|')})\\s*:\\/\\/`, 'u');
const PARTIAL_LOOKUP = /\$\{\s*jndi\b|\bjndi\s*:\s*(?:ldaps?|rmi|dns|iiop|nis|corba)\b/u;
const SCANNER_NAME = new RegExp(SCANNER_NAMES.map((name) => name.replace(/\./gu, '\\.')).join('|'), 'u');
const WEAK_REQUEST_WORD = /cve-\d{4}-\d{4,}|\bjndi\b|log4j|log4shell/u;
const WEAK_DESCRIPTION_WORD = /cve-\d{4}-\d{4,}|jndi|log4j|log4shell|원격\s*조회|조회\s*(?:구문|형태)|취약점|점검\s*(?:도구|흔적)|라이브러리|library|scanner|스캐너/u;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// 제한된 정규화: 소문자, 퍼센트 인코딩 최대 2회, ${lower:x}·${upper:x}·${::-x} 한 글자 대체 최대 3회.
function normalize(text) {
  let out = text.toLowerCase();
  for (let i = 0; i < 2; i += 1) {
    try {
      const decoded = decodeURIComponent(out);
      if (decoded === out) break;
      out = decoded;
    } catch {
      break;
    }
  }
  for (let i = 0; i < 3; i += 1) {
    const next = out.replace(/\$\{\s*(?:lower|upper)\s*:\s*([^}])\}|\$\{[^}:]*(?::[^}:]*)*:-([^}])\}/gu, (_match, a, b) => (a ?? b ?? ''));
    if (next === out) break;
    out = next;
  }
  return out;
}

// 요청 값 모으기: 머리글 계열과 인자(그 밖의 문자열) 값을 나눠 정규화해 돌려줍니다.
function collectRequestValues(data) {
  const headers = [];
  const args = [];
  if (!isObject(data)) return { headers, args };
  for (const [key, value] of Object.entries(data)) {
    if (typeof value !== 'string' || value === '' || value.length > 4096) continue;
    const field = key.toLowerCase();
    if (IGNORED_DATA_FIELDS.includes(field)) continue;
    (HEADER_FIELDS.includes(field) ? headers : args).push(normalize(value));
  }
  return { headers, args };
}

function readCount(data) {
  const value = isObject(data) ? data.count : undefined;
  const number = typeof value === 'number' ? value : (typeof value === 'string' ? Number(value) : NaN);
  return Number.isFinite(number) && number >= 0 ? number : 1;
}

function byName(name) {
  return PATTERNS.find((pattern) => pattern.name === name);
}

function result(action, confidence, reason) {
  return { action, confidence, reason };
}

function fromPattern(patternName) {
  const pattern = byName(patternName);
  const action = pattern.confidence >= BLOCK_THRESHOLD ? 'block'
    : (pattern.confidence >= ALERT_THRESHOLD ? 'alert' : 'record');
  return result(action, pattern.confidence, `패턴 ${pattern.name}: ${pattern.reference}`);
}

function fromDefault(key) {
  const entry = DEFAULTS[key];
  return result('record', entry.confidence, `일치 패턴 없음(${key}): ${entry.reference}`);
}

export function decide(alert) {
  try {
    if (!isObject(alert)) return result('record', 0, '일치 패턴 없음(invalid_alert): 경보 형식을 읽지 못해 기록만 남깁니다.');
    const data = isObject(alert.data) ? alert.data : {};
    const rule = isObject(alert.rule) ? alert.rule : {};
    const level = typeof rule.level === 'number' && Number.isFinite(rule.level) ? rule.level : 0;
    const description = typeof rule.description === 'string' ? normalize(rule.description.slice(0, 2000)) : '';
    const { headers, args } = collectRequestValues(data);
    const count = readCount(data);

    const inHeader = headers.some((value) => FULL_LOOKUP.test(value));
    const inArgument = args.some((value) => FULL_LOOKUP.test(value));
    const scanner = [...headers, ...args].some((value) => SCANNER_NAME.test(value));

    // 1) 명확한 악용: 요청 값에 완전한 조회 구문
    if (inHeader || inArgument) {
      if (scanner) return fromPattern('jndi_lookup_scanner_trace');
      if ((inHeader && inArgument) || count >= REPEATED_COUNT) return fromPattern('jndi_lookup_repeated');
      return fromPattern(inHeader ? 'jndi_lookup_in_request_header' : 'jndi_lookup_in_request_argument');
    }

    // 2) 애매한 시도: 구문 일부, 점검 도구 흔적
    if ([...headers, ...args].some((value) => PARTIAL_LOOKUP.test(value))) return fromPattern('incomplete_lookup_fragment');
    if (scanner) return fromPattern('scanner_tool_trace');
    if (FULL_LOOKUP.test(description)) return fromPattern('lookup_syntax_in_description_only');

    // 3) 낱말만 있는 경우: 규칙 수준이 주의 단계 이상일 때만 알림
    const weakInRequest = [...headers, ...args].some((value) => WEAK_REQUEST_WORD.test(value));
    const weakInDescription = WEAK_DESCRIPTION_WORD.test(description);
    if (weakInRequest || weakInDescription) {
      if (level < ATTENTION_RULE_LEVEL) return fromDefault('below_attention_level');
      return fromPattern(weakInRequest ? 'cve_or_component_reference_in_request' : 'vuln_wording_in_description_only');
    }
    return fromDefault('no_known_exploit_pattern');
  } catch {
    return result('record', 0, '일치 패턴 없음(decide_error): 판단 중 오류가 나 기록만 남깁니다.');
  }
}
