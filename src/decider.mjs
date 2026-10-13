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
export const RULE_IDS = Object.freeze(['starter.deny', 'device_registered', 'step_up_required']);

// 시험·연습용 가상 사건만 이 출처 표식을 달고 옵니다. 실제 경로의 source는 "none"이며,
// 그 경우 시각·네트워크를 알 수 없으므로 정상값으로 채우지 않고 복합 규칙은 판단하지 않습니다.
const VIRTUAL_SIGNAL_SOURCE = 'judge_fixture';
const UNUSUAL_NETWORK = 'unusual';
const BULK_EVENT_KIND = 'risk_signal';
const BULK_MIN_COUNT = 10; // 최근 사건 묶음의 읽기 건수 합계가 이 값 이상이면 "대량"
const BULK_MAX_AGE_SECONDS = 600; // 최근 10분 안의 사건만 셉니다
const MAX_RECENT_EVENTS = 12;
const MAX_STEP_UP_AGE_SECONDS = 900;

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isCount = value => Number.isInteger(value) && value >= 0;

// 평소와 다른 시각: 0~5시, 23시 (사용자별 평소 시각 정보는 계약에 없어 고정 구간으로 둡니다).
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

// 'anomalous' | 'normal' | 'unknown'
//  - unknown: 엔진이 가상 사건 출처를 달지 않았거나 값이 없음 → 정상값으로 채우지 않고 판단 보류
//  - anomalous: 세 조건이 모두 확인됨, 또는 가상 사건 출처인데 값이 계약 모양이 아님(믿을 수 없음)
function assessCompositeAnomaly(request) {
  const { signals, recentEvents } = request;
  if (!isObject(signals) || signals.source !== VIRTUAL_SIGNAL_SOURCE) return 'unknown';

  const wellFormed = Number.isInteger(signals.hour) && signals.hour >= 0 && signals.hour <= 23
    && typeof signals.network === 'string' && typeof signals.region === 'string'
    && Array.isArray(recentEvents) && recentEvents.length <= MAX_RECENT_EVENTS
    && recentEvents.every(event => isObject(event) && typeof event.kind === 'string'
      && isCount(event.ageSeconds) && isCount(event.count));
  if (!wellFormed) return 'anomalous';

  const bulkRead = recentEvents
    .filter(event => event.kind === BULK_EVENT_KIND && event.ageSeconds <= BULK_MAX_AGE_SECONDS)
    .reduce((sum, event) => sum + event.count, 0) >= BULK_MIN_COUNT;
  return isUnusualHour(signals.hour) && signals.network === UNUSUAL_NETWORK && bulkRead
    ? 'anomalous' : 'normal';
}

export async function decide(request) {
  if (request.method === 'GET' && request.service === 'notes') {
    // 1) 기기 등록·로그인 확인이 항상 먼저입니다. 추가 인증으로 되돌릴 수 없습니다.
    if (request.deviceRegistered !== true || !hasSubject(request)) {
      return response(request, 'deny', 'device_not_registered', ['device_registered']);
    }
    // 2) 복합 이상 접속은 추가 확인 전까지 자료를 주지 않습니다(영구 차단 아님).
    if (assessCompositeAnomaly(request) === 'anomalous') {
      if (stepUpVerified(request.stepUp)) {
        return response(request, 'allow', 'approved', ['device_registered', 'step_up_required']);
      }
      return response(request, 'step_up', 'step_up_required', ['step_up_required']);
    }
    return response(request, 'allow', 'approved', ['device_registered']);
  }

  return response(request, 'deny', 'starter_not_ready', [RULE_IDS[0]]);
}
