// 웹 접근 경보 한 건을 패턴과 맞춰 { action, confidence, reason }을 돌려줍니다.
// 심판은 인터넷 없이 이 파일 하나만 불러와 경보마다 바로 답을 받으므로, import 문을
// 전혀 쓰지 않고 파일을 읽거나 쓰지도 않으며 바깥에 묻지 않습니다. 호출 간 상태도 없습니다.
//
// 아래 PATTERNS는 xdr/web-injection/patterns.json을 그대로 옮겨 적은 것입니다(확신도
// 내림차순). patterns.json을 고치면 이 상수도 같이 고쳐 주세요. 검사 대상은 합성 시험
// 자료(xdr/fixtures/web-injection.json)의 data.url에서 첫 '?' 뒤 부분뿐이며, 실제 Wazuh
// 경보 형식에서 요청 인자가 어느 필드에 담기는지는 확인하지 않았습니다.
const BLOCK_THRESHOLD = 0.85;
const ALERT_THRESHOLD = 0.5;

const SQL_UNION_SELECT = /\bunion\b(\s+all)?\s+select\b/u;
const SQL_BOOLEAN_TAUTOLOGY = /['"]\s*(or|and)\s+['"]?\w+['"]?\s*=\s*['"]?\w+/u;
const SQL_STATEMENT_BREAK = /['"]\s*;\s*(select|insert|update|delete|drop)\b/u;
const SQL_COMMENT_CUT = /['"][^&]*(--|\/\*)/u;
const SCRIPT_TAG = /<\s*script\b/u;
const QUOTE = /['"]/u;
const TRAVERSAL_STEP = /\.\.[/\\]/gu;

function countTraversal(args) {
  return (args.match(TRAVERSAL_STEP) ?? []).length;
}

function matchesStatementBreak(args) {
  return SQL_STATEMENT_BREAK.test(args) || SQL_COMMENT_CUT.test(args);
}

const PATTERNS = [
  {
    name: 'sql_union_select_in_argument',
    confidence: 0.95,
    matches: (args) => SQL_UNION_SELECT.test(args),
  },
  {
    name: 'script_tag_in_argument',
    confidence: 0.95,
    matches: (args) => SCRIPT_TAG.test(args),
  },
  {
    name: 'sql_quote_boolean_tautology_in_argument',
    confidence: 0.9,
    matches: (args) => SQL_BOOLEAN_TAUTOLOGY.test(args),
  },
  {
    name: 'sql_quote_statement_break_in_argument',
    confidence: 0.9,
    matches: matchesStatementBreak,
  },
  {
    name: 'path_traversal_repeated_in_argument',
    confidence: 0.9,
    matches: (args) => countTraversal(args) >= 2,
  },
  {
    name: 'ambiguous_lone_quote_in_argument',
    confidence: 0.55,
    matches: (args) => QUOTE.test(args)
      && !SQL_UNION_SELECT.test(args)
      && !SQL_BOOLEAN_TAUTOLOGY.test(args)
      && !matchesStatementBreak(args),
  },
  {
    name: 'ambiguous_single_path_traversal_in_argument',
    confidence: 0.55,
    matches: (args) => countTraversal(args) === 1,
  },
];

// data.url의 첫 '?' 뒤 부분을 꺼내 '+'를 공백으로 바꾸고, 퍼센트 인코딩을 한 번 풀고,
// 소문자로 바꿉니다. 인자가 없거나 주소가 문자열이 아니면 빈 문자열입니다.
function extractArguments(alert) {
  const url = alert?.data?.url;
  if (typeof url !== 'string') return '';
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

function toAction(confidence) {
  if (confidence >= BLOCK_THRESHOLD) return 'block';
  if (confidence >= ALERT_THRESHOLD) return 'alert';
  return 'record';
}

export function decide(alert) {
  const args = extractArguments(alert);
  if (args === '') {
    return { action: 'record', confidence: 0, reason: 'no_request_argument' };
  }
  // PATTERNS가 확신도 내림차순이라 처음 맞는 패턴이 가장 확신도 높은 패턴입니다.
  const matched = PATTERNS.find((pattern) => pattern.matches(args));
  if (!matched) {
    return { action: 'record', confidence: 0, reason: 'no_pattern_matched' };
  }
  return {
    action: toAction(matched.confidence),
    confidence: matched.confidence,
    reason: matched.name,
  };
}
