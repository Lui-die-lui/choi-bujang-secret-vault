// 이 파일은 학생이 같은 프로젝트에서 이어서 구현합니다.
// 제공 UI를 받은 것만으로 단계 완료를 인정하지 않습니다.
const MODE_LABELS = { connected: '연결됨', demo: '예제 자료', disconnected: '연결 없음', unknown: '확인 불가' };
const DEVICE_LABELS = { compliant: '보안 기준 충족', noncompliant: '보안 기준 미충족', unknown: '확인 불가' };
const DECISION_LABELS = { allow: '접근 허용', deny: '접근 거부', challenge: '추가 확인 필요', unknown: '확인 불가' };
const SESSION_LABELS ={ active: '활성', expired: '만료', revoked: '철회됨', unknown: '확인 불가' };

function modeLabel(mode) {
  return Object.hasOwn(MODE_LABELS, mode) ? MODE_LABELS[mode] : MODE_LABELS.unknown;
}

// 한국어 상태 옆에 전달받은 원래 status 값을 함께 보여 준다. 값이 없으면 "(값 없음)".
function withRaw(label, raw) {
  return `${label} (${typeof raw === 'string' && raw ? raw : '값 없음'})`;
}

function lookup(labels, value) {
  return typeof value === 'string' && Object.hasOwn(labels, value) ? labels[value] : labels.unknown;
}

function text(tag, value, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = value;
  return node;
}

// 한 줄: "이름: 값". 상태 문구는 색이 아니라 글자로도 구분된다.
function row(name, value, warn) {
  const line = document.createElement('p');
  line.className = warn ? 'identity-row identity-warn' : 'identity-row';
  line.append(text('span', `${name}: `, 'identity-name'), text('strong', value));
  return line;
}

function section(title, resource, buildOk) {
  const box = document.createElement('section');
  box.className = 'identity-section';
  box.append(text('h4', title));
  const mode = modeLabel(resource?.mode);
  if (mode) box.append(text('p', `자료 출처: ${mode}`, 'identity-mode'));
  const status = resource?.status;
  if (status === 'loading') {
    box.append(text('p', '불러오는 중'));
  } else if (status === 'error') {
    const message = resource.error?.message;
    box.append(text('p', `연결 실패: ${typeof message === 'string' && message ? message : '확인 불가'}`, 'identity-warn'));
  } else if (status === 'ok' && resource.data != null) {
    buildOk(box, resource.data);
  } else {
    box.append(text('p', '확인 불가', 'identity-warn'));
  }
  return box;
}

function deviceRow(device) {
  const label = typeof device?.label === 'string' ? device.label : '확인 불가';
  const id = typeof device?.id === 'string' ? device.id : '확인 불가';
  const state = withRaw(lookup(DEVICE_LABELS, device?.status), device?.status);
  return row(`기기 ${label} (${id})`, state, device?.status !== 'compliant');
}

function sessionRow(session) {
  const id = typeof session?.id === 'string' ? session.id : '확인 불가';
  return row(`세션 ${id}`, withRaw(lookup(SESSION_LABELS, session?.status), session?.status), session?.status !== 'active');
}

export function createStudentView() {
  return {
    // 호출마다 새 요소를 만들어 돌려주므로 이전 사용자·기기·세션 DOM은 교체된다.
    renderIdentity({ me, devices, sessions } = {}) {
      const root = document.createElement('div');
      root.className = 'student-identity';
      root.append(
        section('로그인 사용자', me, (box, data) => {
          const user = data.user ?? {};
          box.append(row('사용자', typeof user.label === 'string' ? user.label : '확인 불가'));
          box.append(row('사용자 ID', typeof user.id === 'string' ? user.id : '확인 불가'));
          box.append(deviceRow(data.device));
          box.append(sessionRow(data.session));
        }),
        section('등록 기기 목록', devices, (box, data) => {
          if (!Array.isArray(data) || data.length === 0) return box.append(text('p', '표시할 기기가 없습니다.'));
          for (const device of data) box.append(deviceRow(device));
        }),
        section('로그인 세션 목록', sessions, (box, data) => {
          if (!Array.isArray(data) || data.length === 0) return box.append(text('p', '표시할 세션이 없습니다.'));
          for (const session of data) box.append(sessionRow(session));
        }),
      );
      return root;
    },
    // 요청 전·중·후·실패를 구분하고, 요청 실패는 접근 거부 판정과 다르게 보여 준다.
    renderDecision({ status, mode, data, error, appId } = {}) {
      const root = document.createElement('div');
      root.className = 'student-decision';
      if (typeof appId === 'string' && appId) root.append(row('업무 앱', appId));

      if (status === 'idle') {
        root.append(text('p', '앱을 골라 접속을 요청하세요'));
        return root;
      }
      root.append(text('p', `자료 출처: ${modeLabel(mode)}`, 'identity-mode'));

      if (status === 'loading') {
        root.append(text('p', '판정 확인 중'));
      } else if (status === 'error') {
        const message = error?.message;
        root.append(
          text('p', `요청 실패: ${typeof message === 'string' && message ? message : '확인 불가'}`, 'identity-warn'),
          text('p', '요청이 실패한 것이며 접근 거부 판정이 아닙니다. 판정을 받지 못했습니다.'),
        );
      } else if (status === 'ok' && data != null) {
        const raw = typeof data.decision === 'string' ? data.decision : '';
        const known = Object.hasOwn(DECISION_LABELS, raw) && raw !== 'unknown';
        const label = known ? DECISION_LABELS[raw] : DECISION_LABELS.unknown;
        root.append(row('접근 판정', withRaw(label, known ? raw : 'unknown'), raw !== 'allow'));
        if (raw === 'challenge') root.append(text('p', '추가 인증 또는 확인이 필요합니다. 이 앱이 확인 절차를 대신 수행하지 않습니다.'));
        if (!known) root.append(text('p', '접근이 허용되지 않은 것으로 처리합니다. 판정을 확인할 수 없습니다.', 'identity-warn'));
        root.append(
          row('판정 이유', typeof data.reason === 'string' && data.reason ? data.reason : '확인 불가'),
          row('판정 시각', typeof data.checkedAt === 'string' && data.checkedAt ? data.checkedAt : '확인 불가'),
        );
      } else {
        root.append(text('p', '확인 불가: 판정 결과를 받지 못했습니다. 접근이 허용된 것이 아닙니다.', 'identity-warn'));
      }
      return root;
    },
    renderEvents() { return '학생 구현 대기: 본인 접속·XDR 기록을 연결하세요.'; },
    renderStatus() { return '학생 구현 대기: 기기·세션·알림과 연결 점검 상태를 구분하세요.'; },
    renderVulnerabilities() { return '학생 구현 대기: 정확한 설치 버전·OSV 출처·조회 시각·부분 결과·조회 실패를 구분하세요.'; },
    renderAiConnection() { return '학생 구현 대기: 모델 응답 점검과 실제 사건 설명을 구분하고 AI 오류·취소·수동 복구를 안내하세요.'; },
    renderExplanation() { return '학생 구현 대기: 선택한 사건의 근거·규칙·현재 상태와 AI 설명을 연결하세요. 제안은 자동 실행하지 않습니다.'; },
    renderAction() { return '학생 구현 대기: 현재 사건·조치·실제 대상·사람 확인·ACK와 원천 효과·unknown을 구분하세요.'; },
  };
}
