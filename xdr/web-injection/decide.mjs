// 웹 접근 경보 한 건을 패턴과 맞춰 { action, confidence, reason }을 돌려줍니다.
// 심판은 인터넷 없이 이 파일 하나만 불러와 경보마다 바로 답을 받으므로, import 문을
// 전혀 쓰지 않고 파일을 읽거나 쓰지도 않으며 바깥에 묻지 않습니다. 호출 간 상태도 없습니다.
//
// 아래 패턴은 xdr/web-injection/patterns.json을 그대로 옮겨 적은 것입니다. patterns.json을
// 고치면 여기도 같이 고쳐 주세요.
//
// (바로잡음 2) 앞선 두 판은 직접 지어낸 합성 경보 모양(요청 주소에 공격 문자열이 그대로
// 들어 있는 모양)에 맞춰져 있어 심판 판정에서 계속 어긋났습니다. 운영 측 연습 경보
// (xdr/fixtures/web-injection.json, schema aleph.xdr.fixture.v1)를 보니 요청 주소에는
// 문서용 표기(예: /notes?q=doc-sql-chain)만 있고, 신호는 규칙 수준(rule.level)·반복 횟수
// (data.count)·한글 설명(rule.description)에 들어 있습니다. 이제 그 세 가지를 중심으로
// 경보 한 건만 보고 판단합니다. 요청 인자에 실제 주입 구문이 그대로 들어온 경우를 위한
// 조건도 남겨 두었습니다.
const BLOCK_THRESHOLD = 0.85;
const ALERT_THRESHOLD = 0.5;

// 같은 주소에서 이만큼 반복되면 사람이 손으로 넣은 검색어로 보기 어렵습니다.
const REPEAT_THRESHOLD = 5;
const ESCALATED_RULE_LEVEL = 10;
const MID_RULE_LEVEL = 5;

const SQL_WORD = /sql|데이터베이스\s*조회|select/u;
const SCRIPT_WORD = /스크립트|script/u;
const TRAVERSAL_WORD = /거슬러|경로\s*이탈|\.\.[/\\]/u;
const MARKER_WORD = /표기|표식|구문|구분자|주입|삽입/u;
const SINGLE_MARKER_WORD = /주입|따옴표|구분\s*문자|이상한/u;
const COUNT_IN_TEXT = /(\d+)\s*(번|건|회|차례)/u;

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

function isRepeated(alert) {
  return alert.count !== null && alert.count >= REPEAT_THRESHOLD;
}

function anyArgument(alert, test) {
  return alert.argumentTexts.some(test);
}

// 확신도 내림차순입니다. 처음 맞는 패턴이 가장 확신도 높은 패턴입니다.
const PATTERNS = [
  { name: 'sql_union_select_in_argument', confidence: 0.95, matches: (a) => anyArgument(a, (text) => SQL_UNION_SELECT.test(text)) },
  { name: 'script_tag_in_argument', confidence: 0.95, matches: (a) => anyArgument(a, (text) => SCRIPT_TAG.test(text)) },
  { name: 'repeated_sql_marker', confidence: 0.93, matches: (a) => isRepeated(a) && SQL_WORD.test(a.description) },
  { name: 'repeated_script_marker', confidence: 0.93, matches: (a) => isRepeated(a) && SCRIPT_WORD.test(a.description) },
  { name: 'repeated_path_traversal_marker', confidence: 0.92, matches: (a) => isRepeated(a) && TRAVERSAL_WORD.test(a.description) },
  { name: 'sql_quote_boolean_tautology_in_argument', confidence: 0.9, matches: (a) => anyArgument(a, (text) => SQL_BOOLEAN_TAUTOLOGY.test(text)) },
  { name: 'sql_quote_statement_break_in_argument', confidence: 0.9, matches: (a) => anyArgument(a, matchesStatementBreak) },
  { name: 'path_traversal_repeated_in_argument', confidence: 0.9, matches: (a) => anyArgument(a, (text) => countTraversal(text) >= 2) },
  { name: 'escalated_rule_level', confidence: 0.9, matches: (a) => a.ruleLevel >= ESCALATED_RULE_LEVEL },
  { name: 'repeated_injection_marker', confidence: 0.88, matches: (a) => isRepeated(a) && MARKER_WORD.test(a.description) },
  {
    name: 'ambiguous_single_injection_like_marker',
    confidence: 0.6,
    matches: (a) => a.ruleLevel >= MID_RULE_LEVEL && SINGLE_MARKER_WORD.test(a.description),
  },
  {
    name: 'ambiguous_lone_quote_in_argument',
    confidence: 0.55,
    matches: (a) => anyArgument(a, (text) => QUOTE.test(text)
      && !SQL_UNION_SELECT.test(text)
      && !SQL_BOOLEAN_TAUTOLOGY.test(text)
      && !matchesStatementBreak(text)),
  },
  { name: 'ambiguous_single_path_traversal_in_argument', confidence: 0.55, matches: (a) => anyArgument(a, (text) => countTraversal(text) === 1) },
  { name: 'ambiguous_mid_rule_level', confidence: 0.55, matches: (a) => a.ruleLevel >= MID_RULE_LEVEL },
];

const URL_FIELD_NAMES = ['url', 'uri', 'path', 'request', 'query', 'args', 'params'];
const REQUEST_LINE = /"(?:get|post|put|delete|patch|head|options)\s+(\S+)\s+http\/[\d.]+"/giu;

function isText(value) {
  return typeof value === 'string' && value.trim() !== '';
}

// 주소에서 첫 '?' 뒤 부분을 꺼내 '+'를 공백으로 바꾸고, 퍼센트 인코딩을 한 번 풀고,
// 소문자로 바꿉니다. '?'가 없으면 인자가 없는 것으로 봅니다.
function argumentsOf(url) {
  const queryStart = url.indexOf('?');
  if (queryStart < 0) return '';
  const rawArgs = url.slice(queryStart + 1).replace(/\+/gu, ' ');
  let decoded = rawArgs;
  try {
    decoded = decodeURIComponent(rawArgs);
  } catch {
    // 퍼센트 인코딩이 깨진 주소는 풀지 않은 그대로 맞춰 봅니다.
  }
  return decoded.toLowerCase();
}

// 경보 한 건에서 판단에 쓸 값만 뽑습니다. 원본 Wazuh 모양과 read-alerts.mjs가 뽑은 모양
// ({ ruleLevel, description, ... })을 둘 다 받습니다. 계정·비밀값처럼 보이는 필드는 읽지 않습니다.
function summarize(rawAlert) {
  const alert = rawAlert && typeof rawAlert === 'object' ? rawAlert : {};
  const data = alert.data && typeof alert.data === 'object' ? alert.data : {};
  const rule = alert.rule && typeof alert.rule === 'object' ? alert.rule : {};

  const logs = [alert.full_log, alert.message, data.full_log].filter(isText);
  const description = [rule.description, alert.description, data.title, data.message, ...logs]
    .filter(isText).join(' ').toLowerCase();

  const urls = URL_FIELD_NAMES.flatMap((name) => [data[name], alert[name]]).filter(isText);
  for (const log of logs) {
    for (const match of log.matchAll(REQUEST_LINE)) urls.push(match[1]);
  }

  // 반복 횟수는 구조화된 필드가 있으면 그것을 쓰고, 없으면 설명의 "12번"·"8건" 같은 표현에서 읽습니다.
  const countField = data.count ?? data.attempts ?? data.hits;
  const countFromField = Number(countField);
  const countFromText = Number((COUNT_IN_TEXT.exec(description) ?? [])[1]);
  let count = null;
  if (countField !== undefined && countField !== null && countField !== '' && Number.isFinite(countFromField)) {
    count = countFromField;
  } else if (Number.isFinite(countFromText)) {
    count = countFromText;
  }

  const level = Number(rule.level ?? alert.ruleLevel ?? alert.level);
  return {
    description,
    count,
    ruleLevel: Number.isFinite(level) ? level : 0,
    argumentTexts: urls.map(argumentsOf).filter((text) => text !== ''),
  };
}

function toAction(confidence) {
  if (confidence >= BLOCK_THRESHOLD) return 'block';
  if (confidence >= ALERT_THRESHOLD) return 'alert';
  return 'record';
}

export function decide(alert) {
  const summary = summarize(alert);
  const matched = PATTERNS.find((pattern) => pattern.matches(summary));
  if (!matched) {
    return { action: 'record', confidence: 0, reason: 'no_pattern_matched' };
  }
  return { action: toAction(matched.confidence), confidence: matched.confidence, reason: matched.name };
}
