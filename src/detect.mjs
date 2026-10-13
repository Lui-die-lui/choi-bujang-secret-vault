// 9단계 탐지 함수입니다. docs/DETECT_EVENTS.md의 가상 사건 계약만 따릅니다.
// 반 엔진이 검증한 사건만 전달해야 하며, 브라우저가 보낸 사용자 번호는 받지 않습니다.
//
// 입력: 사건마다 계약의 세 값(at, method, identity.sub)만 읽습니다. 그 밖의 값(메모 내용·
// 토큰·실명 등)은 사건에 들어 있어도 읽지 않고, 저장·출력·오류 문구에도 넣지 않습니다.
// 규칙 burst_read: 같은 가명 사용자의 GET 사건이 어느 10분 구간에서든 120건을 넘을 때만
// 회수를 "제안"합니다. 이 함수는 결과를 돌려줄 뿐 기기·접속 권한을 바꾸지 않습니다.
//
// 계약에 없는 것(만들어 쓰지 않음): 네트워크·지역·기기·기존 판정 값이 사건에 없어
// "평소와 다른 네트워크"와의 복합 조건과 기기 단위 대상은 구현하지 못했습니다.
// 제안 대상은 계약대로 가명 사용자(subject) 한 명입니다.
const WINDOW_MS = 10 * 60 * 1000;
const BURST_LIMIT = 120; // 정확히 120건은 제안 대상이 아닙니다(초과만).
const READ_METHOD = 'GET';
const REASON_CODE = 'burst_read';

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

// 사건 한 건에서 { atMs, method, sub }만 꺼냅니다. 모양이 계약과 다르면 null(세지 않음).
function readEvent(event) {
  if (!isObject(event) || !isObject(event.identity)) return null;
  const { at, method } = event;
  const { sub } = event.identity;
  if (typeof at !== 'string' || typeof method !== 'string'
      || typeof sub !== 'string' || sub.trim() === '') return null;
  const atMs = Date.parse(at);
  if (!Number.isFinite(atMs)) return null;
  return { atMs, method, sub };
}

export function detect(events) {
  if (!Array.isArray(events)) throw new TypeError('invalid_detection_events');

  // 사용자를 합산하지 않도록 가명 사용자별로 GET 시각만 모읍니다.
  const readsBySubject = new Map();
  for (const event of events) {
    const item = readEvent(event);
    if (!item || item.method !== READ_METHOD) continue;
    if (!readsBySubject.has(item.sub)) readsBySubject.set(item.sub, []);
    readsBySubject.get(item.sub).push(item.atMs);
  }

  // 가장 먼저 기준을 넘은 사용자 한 명만 제안합니다.
  let found = null;
  for (const [sub, times] of readsBySubject) {
    times.sort((a, b) => a - b);
    let start = 0;
    for (let end = 0; end < times.length; end += 1) {
      while (times[end] - times[start] > WINDOW_MS) start += 1;
      if (end - start + 1 > BURST_LIMIT) {
        if (!found || times[end] < found.atMs) found = { sub, atMs: times[end] };
        break;
      }
    }
  }
  if (!found) return { action: 'observe' };
  return { action: 'propose_revocation', reasonCode: REASON_CODE, subject: found.sub };
}
