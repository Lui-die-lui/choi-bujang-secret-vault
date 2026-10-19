// 이 파일은 학생이 같은 프로젝트에서 이어서 구현합니다.
// 제공 UI를 받은 것만으로 단계 완료를 인정하지 않습니다.
const MODE_LABELS = { demo: '예제 자료', disconnected: '연결 없음', unknown: '확인 불가' };
const DEVICE_LABELS = { compliant: '보안 기준 충족', noncompliant: '보안 기준 미충족', unknown: '확인 불가' };
const SESSION_LABELS = { active: '활성', expired: '만료', revoked: '철회됨', unknown: '확인 불가' };

function modeLabel(mode) {
  if (Object.hasOwn(MODE_LABELS, mode)) return MODE_LABELS[mode];
  return mode === 'live' ? null : MODE_LABELS.unknown;
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
  const state = lookup(DEVICE_LABELS, device?.status);
  return row(`기기 ${label} (${id})`, state, device?.status !== 'compliant');
}

function sessionRow(session) {
  const id = typeof session?.id === 'string' ? session.id : '확인 불가';
  return row(`세션 ${id}`, lookup(SESSION_LABELS, session?.status), session?.status !== 'active');
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
    renderDecision() { return '학생 구현 대기: 서버의 판정과 이유를 연결하세요.'; },
    renderEvents() { return '학생 구현 대기: 본인 접속·XDR 기록을 연결하세요.'; },
    renderStatus() { return '학생 구현 대기: 기기·세션·알림과 연결 점검 상태를 구분하세요.'; },
    renderVulnerabilities() { return '학생 구현 대기: 정확한 설치 버전·OSV 출처·조회 시각·부분 결과·조회 실패를 구분하세요.'; },
    renderAiConnection() { return '학생 구현 대기: 모델 응답 점검과 실제 사건 설명을 구분하고 AI 오류·취소·수동 복구를 안내하세요.'; },
    renderExplanation() { return '학생 구현 대기: 선택한 사건의 근거·규칙·현재 상태와 AI 설명을 연결하세요. 제안은 자동 실행하지 않습니다.'; },
    renderAction() { return '학생 구현 대기: 현재 사건·조치·실제 대상·사람 확인·ACK와 원천 효과·unknown을 구분하세요.'; },
  };
}
