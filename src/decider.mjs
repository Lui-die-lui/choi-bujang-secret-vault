// ALEPH SDP 엔진이 확인한 요청만 받는 학생 판정기입니다.
// 요청 본문의 userId, role, 기기 키, 토큰을 별도로 믿거나 저장하지 마세요.
// 6단계: 기기 등록 조건(device_registered)을 추가합니다. docs/DECIDER_REQUEST.md
// 계약에 있는 request.deviceRegistered·request.subjectId만 쓰고, 계약에 없는
// request.device 등은 만들어 쓰지 않습니다. 로컬 연습(scripts/fixture-7.mjs)이
// 쓰는 실제 요청 모양(service: 'notes', method: 'GET', route: 'GET /notes/:id')을
// "내 자료실 읽기"로 보고 판단합니다 — 그 외 요청(다른 서비스·다른 동작)은
// 그대로 starter.deny로 거부합니다(다른 규칙을 새로 만들지 않음).
//
// (보강) CHECK.md의 "요청에 담긴 로그인·기기 등록 여부·동작·경로만 판단합니다"
// 문구에 맞춰, 기기 등록뿐 아니라 로그인(subjectId 존재)도 이 규칙 안에서
// 명시적으로 확인합니다. 계약상 반 엔진이 신원을 확인한 뒤에만 decide()를
// 부르므로(subjectId는 항상 있어야 함) 평소엔 효과가 없지만, 등록된 기기라는
// 사실만으로 로그인 여부를 건너뛰고 허용하지 않는다는 걸 코드로도 분명히
// 남깁니다. deviceId와 subjectId가 실제로 같은 사람의 것인지(기기-사용자
// 결속)는 계약에 그 결속을 보여주는 필드가 없어 decide()에서 재검증할 수
// 없습니다 — 이건 반 엔진(실제 릴레이)의 책임이며, 계약에 없는 필드를
// 만들어 흉내 내지 않습니다.
export const RULE_IDS = Object.freeze(['starter.deny', 'device_registered']);

function hasSubject(request) {
  return typeof request.subjectId === 'string' && request.subjectId.trim() !== '';
}

export async function decide(request) {
  if (request.method === 'GET' && request.service === 'notes') {
    if (request.deviceRegistered === true && hasSubject(request)) {
      return {
        schema: 'aleph.decision.v1',
        requestId: request.requestId,
        decision: 'allow',
        reasonCode: 'approved',
        ruleIds: ['device_registered'],
      };
    }
    // deviceRegistered가 명시적으로 true가 아니거나(false·undefined·다른 값
    // 전부) subjectId(로그인)가 없으면 거부합니다 — 등록된 기기라는 이유만으로
    // 로그인 확인을 건너뛰고 허용하지 않습니다. CHECK.md가 지정한 이유 코드
    // 하나(device_not_registered)만 쓰고 새 코드를 만들지 않습니다.
    return {
      schema: 'aleph.decision.v1',
      requestId: request.requestId,
      decision: 'deny',
      reasonCode: 'device_not_registered',
      ruleIds: ['device_registered'],
    };
  }

  return {
    schema: 'aleph.decision.v1',
    requestId: request.requestId,
    decision: 'deny',
    reasonCode: 'starter_not_ready',
    ruleIds: [RULE_IDS[0]],
  };
}
