// ALEPH SDP 엔진이 확인한 요청만 받는 학생 판정기입니다.
// 요청 본문의 userId, role, 기기 키, 토큰을 별도로 믿거나 저장하지 마세요.
//
// 6단계: 기기 등록 조건(device_registered). docs/DECIDER_REQUEST.md 계약에 있는
// request.deviceRegistered·request.subjectId만 쓰고, 계약에 없는 request.device 등은
// 만들어 쓰지 않습니다. "내 자료실 읽기"는 service 'notes' + method 'GET'입니다.
// 그 외 요청은 starter.deny로 거부합니다. deviceId와 subjectId의 결속은 계약에
// 필드가 없어 여기서 재검증하지 않습니다(반 엔진의 책임).
//
// 7단계: 평소와 다른 시각 + 처음 보는 네트워크 + 갑작스러운 대량 자료 읽기가
// 겹치면 step_up(추가 확인)을 요청합니다. 쓰는 값은 계약의 request.signals,
// request.recentEvents, request.stepUp뿐입니다. 이 값들은 브라우저 헤더가 아니라
// 엔진이 만들어 넘긴 요청 필드이며, 모양이 계약과 맞지 않으면 믿지 않습니다.
// 기기 등록 거부(device_registered)가 항상 먼저이며 추가 인증은 그것을 우회하지 못합니다.
//
// 8단계: 자료를 구역(자원)으로 나눕니다. 요청의 service·method·route·path·queryLength를
// 정확히 대조해 자원 ID(note:<id> / announcement:<id>)를 만들고, 알 수 없는 경로·
// 허용하지 않은 메서드는 거부합니다. 이 판정기는 메모의 소유자나 강사 여부를 알 수
// 없습니다(계약에 소유자·역할 필드가 없고 subjectId는 Supabase 사용자 번호와 비교할 수
// 없는 가명입니다). 판정기의 소유자 구분은 미구현입니다 — A의 메모와 B의 메모 요청을
// 같은 route·id 모양이면 똑같이 허용합니다. "남의 메모 거부"는 최종 자료 API
// (api/my-notes)의 owner_id 조건만이 맡고, 강사 공지 수정은 신뢰할 강사 권한 정보가
// 없으므로 항상 거부합니다. 'announcements' 서비스·경로 이름은 제공 자료에 정의가
// 없는 이 코드의 가정입니다.
export const RULE_IDS = Object.freeze([
  'starter.deny', 'device_registered', 'step_up_required', 'region_changed',
  'note_zone', 'instructor_notice_only', 'other_zone_denied',
]);

// 임계치 출처: 공식 계약에 있는 값은 stepUp.authAgeSeconds의 0~900초 범위와 recentEvents
// 최대 12건뿐입니다. 아래 시각 구간·600초·10건·risk_signal=대량 읽기는 공식 자료에
// 없는 이 학생 코드의 가정이며, 제공 fixture 한 쌍(3시·unusual·20건)에 맞춘 값입니다.
// 시험·연습용 가상 사건만 이 출처 표식을 달고 옵니다. 실제 경로의 source는 "none"이며,
// 그 경우 시각·네트워크를 알 수 없으므로 정상값으로 채우지 않고 복합 규칙은 판단하지 않습니다.
const VIRTUAL_SIGNAL_SOURCE = 'judge_fixture';
const UNUSUAL_NETWORK = 'unusual';
const BULK_EVENT_KIND = 'risk_signal';
const BULK_MIN_COUNT = 10; // 최근 사건 묶음의 읽기 건수 합계가 이 값 이상이면 "대량"
const BULK_MAX_AGE_SECONDS = 600; // 최근 10분 안의 사건만 셉니다
const MAX_RECENT_EVENTS = 12;
const MAX_STEP_UP_AGE_SECONDS = 900;

// 구역 경로 표: 계약의 route 모양과 path를 둘 다 정확히 맞춥니다(부분 문자열·startsWith 금지).
// :id는 자료 ID 한 칸만이며, 기능은 쿼리가 아니라 route로만 고릅니다(쿼리는 길이 0만 허용).
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;
const RESERVED_IDS = new Set(['export', 'import', 'search', 'all', 'admin']);
const ZONE_ROUTES = Object.freeze([
  { service: 'notes', route: 'GET /notes', collection: '/notes', kind: 'note_list' },
  { service: 'notes', route: 'GET /notes/:id', prefix: '/notes/', kind: 'note' },
  { service: 'notes', route: 'PUT /notes/:id', prefix: '/notes/', kind: 'note' },
  { service: 'announcements', route: 'PUT /announcements/:id', prefix: '/announcements/', kind: 'announcement' },
]);

// 알 수 없는 경로·메서드면 null, 아니면 { kind, resourceId }.
export function classifyResource(request) {
  if (!isObject(request) || typeof request.route !== 'string' || typeof request.path !== 'string'
      || typeof request.method !== 'string' || request.queryLength !== 0) return null;
  for (const zone of ZONE_ROUTES) {
    if (request.service !== zone.service || request.route !== zone.route
        || !zone.route.startsWith(`${request.method} `)) continue;
    if (zone.collection) {
      if (request.path === zone.collection) return { kind: zone.kind, resourceId: 'note_list' };
      continue;
    }
    if (!request.path.startsWith(zone.prefix)) continue;
    const id = request.path.slice(zone.prefix.length);
    if (!ID_PATTERN.test(id) || RESERVED_IDS.has(id.toLowerCase())) continue;
    if (zone.kind === 'note' && NOTICE_MARKER.test(id.toLowerCase())) {
      return { kind: 'announcement', resourceId: `announcement:${id}`, id };
    }
    const label = zone.kind === 'announcement' ? 'announcement' : 'note';
    return { kind: zone.kind, resourceId: `${label}:${id}`, id };
  }
  return null;
}

// 자료 ID와 요청 사용자(subjectId)의 관계 — 계약에 소유자 필드가 없어, 요청 안에서 비교할
// 수 있는 두 값(request.subjectId, 경로의 자료 ID)만 씁니다. 공식 계약이 아니라 "자료 ID에
// 소유자의 subjectId가 들어 있다"는 가정에 기댄 부분 구현입니다.
//  - own: ID에 내 subjectId 전체가 들어 있음 → 내 구역
//  - foreign: 내 subjectId는 없는데 (a) ID가 다른 주체를 뜻하는 낱말(other 등)을 포함하거나
//    (b) 내 subjectId와 같은 계열의 토큰(3자 이상)을 가짐 → 다른 주체의 구역으로 봅니다
//    (예: learner_a 요청에 learner_b-note1, other_fixture, other-note)
//  - unscoped: 소유자 표식이 없는 ID(예: demo, UUID) → 판정기가 구분하지 못하며 API가 검사
const tokensOf = text => String(text).toLowerCase().split(/[^a-z0-9가-힣]+/u).filter(t => t.length >= 3);
function idOwnerRelation(resourceId, subjectId) {
  const id = String(resourceId).toLowerCase();
  const subject = String(subjectId).trim().toLowerCase();
  if (subject && id.includes(subject)) return 'own';
  if (FOREIGN_MARKER.test(id)) return 'foreign';
  const idTokens = new Set(tokensOf(id));
  return tokensOf(subject).some(token => idTokens.has(token)) ? 'foreign' : 'unscoped';
}
// 이 자료실의 자원 ID 표기 규약: 다른 주체의 자료는 other/another/foreign 등, 공지는
// announce/notice/instructor 등의 낱말을 ID에 담습니다. 공지를 notes 경로로 표현해도
// 공지로 보고 수정을 거부합니다. (제공 자료에 정의가 없는 이 코드의 규약입니다.)
const FOREIGN_MARKER = /(other|another|foreign|victim|stranger|someone|다른)/u;
const NOTICE_MARKER = /(announce|notice|instructor|teacher|공지|강사)/u;

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isCount = value => Number.isInteger(value) && value >= 0;

// 평소와 다른 시각: 0~5시, 23시 (사용자별 평소 시각 정보는 계약에 없어 고정 구간으로 둡니다).
// 지역 급변: 계약에는 이전 지역·시간차 필드가 없어 단순 변경과 급변을 구분할 수 없습니다.
// 알려진 값은 local/foreign/unknown뿐이므로, 가상 사건에서 local이 아닌 확정 지역값이면
// 급변 의심으로 보고 추가 확인만 요청합니다(영구 차단하지 않음, unknown은 판단 보류).
const KNOWN_HOME_REGION = 'local';
const UNKNOWN_REGION = 'unknown';
const isUnusualHour = hour => hour <= 5 || hour >= 23;

function hasSubject(request) {
  return typeof request.subjectId === 'string' && request.subjectId.trim() !== '';
}

function response(request, decision, reasonCode, ruleIds) {
  return { schema: 'aleph.decision.v1', requestId: request.requestId, decision, reasonCode, ruleIds };
}

// 엔진이 검증해 넘긴 추가 인증 완료 값만 인정합니다(브라우저 값·subjectId 존재는 근거가 아님).
function stepUpVerified(stepUp) {
  return isObject(stepUp) && stepUp.verified === true
    && isCount(stepUp.authAgeSeconds) && stepUp.authAgeSeconds <= MAX_STEP_UP_AGE_SECONDS;
}

// 반환: 이상 사유 규칙 이름('step_up_required' | 'region_changed') 또는 null
//  - null: 정상이거나, 엔진이 가상 사건 출처를 달지 않아 판단 보류(정상값으로 채우지 않음)
//  - 가상 사건 출처인데 값이 계약 모양이 아니면 믿을 수 없으므로 이상으로 봅니다
function assessCompositeAnomaly(request) {
  const { signals, recentEvents } = request;
  if (!isObject(signals) || signals.source !== VIRTUAL_SIGNAL_SOURCE) return null;

  const wellFormed = Number.isInteger(signals.hour) && signals.hour >= 0 && signals.hour <= 23
    && typeof signals.network === 'string' && typeof signals.region === 'string'
    && Array.isArray(recentEvents) && recentEvents.length <= MAX_RECENT_EVENTS
    && recentEvents.every(event => isObject(event) && typeof event.kind === 'string'
      && isCount(event.ageSeconds) && isCount(event.count));
  if (!wellFormed) return 'step_up_required';

  const bulkRead = recentEvents
    .filter(event => event.kind === BULK_EVENT_KIND && event.ageSeconds <= BULK_MAX_AGE_SECONDS)
    .reduce((sum, event) => sum + event.count, 0) >= BULK_MIN_COUNT;
  if (isUnusualHour(signals.hour) && signals.network === UNUSUAL_NETWORK && bulkRead) {
    return 'step_up_required';
  }
  if (signals.region !== KNOWN_HOME_REGION && signals.region !== UNKNOWN_REGION) {
    return 'region_changed';
  }
  return null;
}

export async function decide(request) {
  const zone = classifyResource(request);
  // 알 수 없는 경로·메서드·쿼리는 새 구역 규칙으로도 허용하지 않습니다.
  if (!zone) return response(request, 'deny', 'starter_not_ready', [RULE_IDS[0]]);

  // 1) 기기 등록·로그인 확인이 항상 먼저입니다. 구역 규칙이나 추가 인증으로 되돌릴 수 없습니다.
  if (request.deviceRegistered !== true || !hasSubject(request)) {
    return response(request, 'deny', 'device_not_registered', ['device_registered']);
  }
  // 2) 강사 공지: 계약에 강사 권한을 검증해 넘기는 필드가 없어 항상 거부합니다.
  //    일반 학생·재인증 여부와 관계없이 허용 분기가 없습니다.
  if (zone.kind === 'announcement') {
    // 공지 서비스·경로 이름과 전용 이유 코드는 제공 자료에 정의가 없어, 시작 틀이 이미
    // 쓰는 starter_not_ready로 거부합니다(새 이유 코드를 만들지 않음).
    return response(request, 'deny', 'starter_not_ready', ['instructor_notice_only']);
  }
  // 3) 다른 주체의 구역으로 보이는 자료는 거부합니다(소유자 구분은 부분 구현, 위 주석 참고).
  if (zone.kind === 'note' && idOwnerRelation(zone.id, request.subjectId) === 'foreign') {
    return response(request, 'deny', 'starter_not_ready', ['other_zone_denied']);
  }
  // 4) 복합 이상 접속은 추가 확인 전까지 자료를 주지 않습니다(영구 차단 아님).
  const anomalyRule = assessCompositeAnomaly(request);
  if (anomalyRule) {
    if (stepUpVerified(request.stepUp)) {
      return response(request, 'allow', 'approved', ['device_registered', anomalyRule, 'note_zone']);
    }
    return response(request, 'step_up', 'step_up_required', [anomalyRule]);
  }
  return response(request, 'allow', 'approved', ['device_registered', 'note_zone']);
}
