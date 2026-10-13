// ALEPH SDP 엔진이 확인한 요청만 받는 학생 판정기입니다.
// 요청 본문의 userId, role, 기기 키, 토큰을 별도로 믿거나 저장하지 마세요.
// 6단계: 기기 등록 조건(device_registered)을 추가합니다. docs/DECIDER_REQUEST.md
// 계약에 있는 request.deviceRegistered만 쓰고, 계약에 없는 request.device 등은
// 만들어 쓰지 않습니다. 로컬 연습(scripts/fixture-7.mjs)이 쓰는 실제 요청 모양
// (service: 'notes', method: 'GET', route: 'GET /notes/:id')을 "내 자료실
// 읽기"로 보고 판단합니다 — 그 외 요청(다른 서비스·다른 동작)은 그대로
// starter.deny로 거부합니다(다른 규칙을 새로 만들지 않음).
export const RULE_IDS = Object.freeze(['starter.deny', 'device_registered']);

export async function decide(request) {
  if (request.method === 'GET' && request.service === 'notes') {
    if (request.deviceRegistered === true) {
      return {
        schema: 'aleph.decision.v1',
        requestId: request.requestId,
        decision: 'allow',
        reasonCode: 'approved',
        ruleIds: ['device_registered'],
      };
    }
    // deviceRegistered가 명시적으로 true가 아니면(false·undefined·다른 값 전부)
    // 거부합니다 — 등록된 기기라는 이유만으로 다른 검사를 건너뛰지 않습니다.
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
