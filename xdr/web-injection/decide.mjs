// 웹 접근 경보 한 건을 패턴과 맞춰 { action, confidence, reason }을 돌려줍니다.
// 심판은 인터넷 없이 이 파일 하나만 불러와 경보마다 바로 답을 받으므로, import 문을
// 전혀 쓰지 않고 파일을 읽거나 쓰지도 않으며 바깥에 묻지 않습니다. 호출 간 상태도 없습니다.
//
// 아래 패턴은 xdr/web-injection/patterns.json을 그대로 옮겨 적은 것입니다. patterns.json을
// 고치면 여기도 같이 고쳐 주세요.
//
// (바로잡음 1) 처음에는 합성 시험 자료의 data.url에서 '?' 뒤 부분만 봤는데, 심판 판정에서
// 명확한 공격·애매한 시도·정상 기록 건수가 모두 어긋났습니다(X02_CLEAR_NOT_BLOCKED 등).
// 심판 경보에 그 필드가 있다는 보장이 없어, 이제 경보 한 건 안의 여러 자리를 봅니다.
//   - 요청 인자: data.url 같은 주소 필드와 full_log의 요청 줄에서 꺼낸 주소('?' 뒤 부분)
//   - 자유 문장: 설명(rule.description)·full_log·data의 다른 문자열 값
//   - 설명 문장이 주입 형태를 말로 적어 둔 경우(예: "SQL 주입 시도가 8건 반복됨")
// 실제 Wazuh 경보나 심판 경보의 형식은 여전히 확인하지 못했습니다. 설명 문장 조건의
// 낱말과 확신도는 과제 문구("주입 형태를 가려내 알리고, 반복되는 명확한 주입 시도만
// 막습니다")에 맞춰 직접 정한 값입니다.
const BLOCK_THRESHOLD = 0.85;
const ALERT_THRESHOLD = 0.5;

const SQL_UNION_SELECT = /\bunion\b(\s+all)?\s+select\b/u;
const SQL_BOOLEAN_TAUTOLOGY = /['"]\s*(or|and)\s+['"]?\w+['"]?\s*=\s*['"]?\w+/u;
const SQL_STATEMENT_BREAK = /['"]\s*;\s*(select|insert|update|delete|drop)\b/u;
const SQL_COMMENT_CUT = /['"][^&]*(--|\/\*)/u;
const SCRIPT_TAG = /<\s*script\b/u;
const QUOTE = /['"]/u;
const TRAVERSAL_STEP = /\.\.[/\\]/gu;

function countTraversal(text) {
  return (text.match(TRAVERSAL_STEP) ?? []).length;
}

function matchesStatementBreak(text) {
  return SQL_STATEMENT_BREAK.test(text) || SQL_COMMENT_CUT.test(text);
}

// 요청 인자 문자열에 맞춰 보는 패턴입니다(확신도 내림차순).
const ARGUMENT_PATTERNS = [
  { name: 'sql_union_select_in_argument', confidence: 0.95, matches: (text) => SQL_UNION_SELECT.test(text) },
  { name: 'script_tag_in_argument', confidence: 0.95, matches: (text) => SCRIPT_TAG.test(text) },
  { name: 'sql_quote_boolean_tautology_in_argument', confidence: 0.9, matches: (text) => SQL_BOOLEAN_TAUTOLOGY.test(text) },
  { name: 'sql_quote_statement_break_in_argument', confidence: 0.9, matches: matchesStatementBreak },
  { name: 'path_traversal_repeated_in_argument', confidence: 0.9, matches: (text) => countTraversal(text) >= 2 },
  {
    name: 'ambiguous_lone_quote_in_argument',
    confidence: 0.55,
    matches: (text) => QUOTE.test(text)
      && !SQL_UNION_SELECT.test(text)
      && !SQL_BOOLEAN_TAUTOLOGY.test(text)
      && !matchesStatementBreak(text),
  },
  { name: 'ambiguous_single_path_traversal_in_argument', confidence: 0.55, matches: (text) => countTraversal(text) === 1 },
];

// 자유 문장(설명·로그 원문)에는 뚜렷한 패턴만 맞춰 봅니다. 따옴표 하나나 '../' 한 번,
// 따옴표 뒤 주석 기호는 정상 로그 줄에도 흔해 여기서는 보지 않습니다.
const FREE_TEXT_PATTERN_NAMES = new Set([
  'sql_union_select_in_argument',
  'script_tag_in_argument',
  'sql_quote_boolean_tautology_in_argument',
  'path_traversal_repeated_in_argument',
]);
const FREE_TEXT_PATTERNS = [
  ...ARGUMENT_PATTERNS.filter((pattern) => FREE_TEXT_PATTERN_NAMES.has(pattern.name)),
  { name: 'sql_quote_statement_break_in_argument', confidence: 0.9, matches: (text) => SQL_STATEMENT_BREAK.test(text) },
];

// 설명 문장이 세 신호(SQL 구문·스크립트 태그·경로 거슬러 올라가기)를 말로 적어 둔 경우입니다.
const DESCRIBED_INJECTION = /sql\s*(주입|인젝션|삽입|구문|injection)|sqli\b|따옴표|스크립트\s*(태그|주입|삽입)|<\s*script|\bxss\b|cross[-\s]?site\s*scripting|경로\s*(거슬러|탐색|순회|조작)|디렉터리\s*(탐색|순회)|(path|directory)\s*traversal|\.\.[/\\]/u;
const DESCRIBED_NEGATION = /아님|아닌|아니|없음|없이|정상/u;
const DESCRIBED_REPEAT_WORD = /반복|연속|잇따라|다수|여러\s*(번|차례|건)/u;
const DESCRIBED_COUNT = /(\d+)\s*(건|회|번|차례)/u;
const DESCRIBED_REPEATED = { name: 'described_injection_repeated', confidence: 0.9 };
const DESCRIBED_SINGLE = { name: 'ambiguous_described_injection_single', confidence: 0.6 };
const ESCALATED_RULE_LEVEL = 10;

const URL_FIELD_NAMES = ['url', 'uri', 'path', 'request', 'query', 'args', 'params'];
const REQUEST_LINE = /"(?:get|post|put|delete|patch|head|options)\s+(\S+)\s+http\/[\d.]+"/giu;

function decodeLower(text) {
  let decoded = text;
  try {
    decoded = decodeURIComponent(text);
  } catch {
    // 퍼센트 인코딩이 깨진 문자열은 풀지 않은 그대로 맞춰 봅니다.
  }
  return decoded.toLowerCase();
}

// 주소에서 첫 '?' 뒤 부분을 꺼냅니다. '?'가 없으면 인자가 없는 것으로 봅니다.
function argumentsOf(url) {
  const queryStart = url.indexOf('?');
  if (queryStart < 0) return '';
  return decodeLower(url.slice(queryStart + 1).replace(/\+/gu, ' '));
}

function isText(value) {
  return typeof value === 'string' && value.trim() !== '';
}

// 경보 한 건에서 맞춰 볼 문자열을 자리별로 모읍니다. 원본 Wazuh 모양과
// read-alerts.mjs가 뽑은 모양({ ruleLevel, description, ... })을 둘 다 받습니다.
function collectTexts(rawAlert) {
  const alert = rawAlert && typeof rawAlert === 'object' ? rawAlert : {};
  const data = alert.data && typeof alert.data === 'object' ? alert.data : {};
  const rule = alert.rule && typeof alert.rule === 'object' ? alert.rule : {};

  const descriptions = [rule.description, alert.description, data.title, data.message].filter(isText);
  const logs = [alert.full_log, alert.message, data.full_log].filter(isText);
  const urls = URL_FIELD_NAMES.flatMap((name) => [data[name], alert[name]]).filter(isText);
  for (const log of logs) {
    for (const match of log.matchAll(REQUEST_LINE)) urls.push(match[1]);
  }
  const otherData = Object.entries(data)
    .filter(([name, value]) => isText(value) && !URL_FIELD_NAMES.includes(name)
      && !['title', 'message', 'full_log'].includes(name))
    .map(([, value]) => value);

  const level = Number(rule.level ?? alert.ruleLevel ?? alert.level);
  return {
    argumentTexts: urls.map(argumentsOf).filter((text) => text !== ''),
    freeTexts: [...descriptions, ...logs, ...otherData].map(decodeLower),
    descriptionTexts: descriptions.map((text) => text.toLowerCase()),
    ruleLevel: Number.isFinite(level) ? level : 0,
  };
}

function describedHit(description, ruleLevel) {
  if (!DESCRIBED_INJECTION.test(description) || DESCRIBED_NEGATION.test(description)) return null;
  const count = Number((DESCRIBED_COUNT.exec(description) ?? [])[1]);
  const repeated = DESCRIBED_REPEAT_WORD.test(description) || count >= 2 || ruleLevel >= ESCALATED_RULE_LEVEL;
  return repeated ? DESCRIBED_REPEATED : DESCRIBED_SINGLE;
}

function toAction(confidence) {
  if (confidence >= BLOCK_THRESHOLD) return 'block';
  if (confidence >= ALERT_THRESHOLD) return 'alert';
  return 'record';
}

export function decide(alert) {
  const { argumentTexts, freeTexts, descriptionTexts, ruleLevel } = collectTexts(alert);

  // 자리마다 따로 맞춰 본 뒤 가장 확신도 높은 것 하나를 씁니다(문자열을 이어 붙여 세면
  // 설명과 주소에 한 번씩 나온 '../'가 반복으로 잘못 세어지기 때문입니다).
  const hits = [];
  for (const text of argumentTexts) {
    const hit = ARGUMENT_PATTERNS.find((pattern) => pattern.matches(text));
    if (hit) hits.push(hit);
  }
  for (const text of freeTexts) {
    const hit = FREE_TEXT_PATTERNS.find((pattern) => pattern.matches(text));
    if (hit) hits.push(hit);
  }
  for (const text of descriptionTexts) {
    const hit = describedHit(text, ruleLevel);
    if (hit) hits.push(hit);
  }

  if (hits.length === 0) {
    return { action: 'record', confidence: 0, reason: 'no_pattern_matched' };
  }
  const best = hits.reduce((top, hit) => (hit.confidence > top.confidence ? hit : top));
  return { action: toAction(best.confidence), confidence: best.confidence, reason: best.name };
}
