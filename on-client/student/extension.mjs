// 이 파일은 학생이 같은 프로젝트에서 이어서 구현합니다.
// 제공 UI를 받은 것만으로 단계 완료를 인정하지 않습니다.
const MODE_LABELS = { connected: '연결됨', demo: '예제 자료', disconnected: '연결 없음', unknown: '확인 불가' };
const DEVICE_LABELS = { compliant: '보안 기준 충족', noncompliant: '보안 기준 미충족', unknown: '확인 불가' };
const DECISION_LABELS = { allow: '접근 허용', deny: '접근 거부', challenge: '추가 확인 필요', unknown: '확인 불가' };
const SESSION_LABELS ={ active: '활성', expired: '만료', revoked: '철회됨', unknown: '확인 불가' };

const ACCESS_LABELS = { allowed: '허용됨', denied: '거부됨', unknown: '확인 불가' };
const KIND_LABELS = { access: '접속', xdr: 'XDR 경보' };

function lookupLabel(labels, value) {
  return typeof value === 'string' && Object.hasOwn(labels, value) ? labels[value] : `확인 불가(${typeof value === 'string' ? value : '값 없음'})`;
}

function timeValue(at) {
  const t = typeof at === 'string' ? Date.parse(at) : NaN;
  return Number.isNaN(t) ? -Infinity : t;
}

// 시각은 한국 시각으로 읽을 수 있게 쓰고, 받은 원래 값을 함께 적는다.
function formatTime(at) {
  const t = timeValue(at);
  if (t === -Infinity) return `확인 불가(${typeof at === 'string' ? at : '값 없음'})`;
  const kst = new Date(t).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false });
  return `${kst} KST (${at})`;
}

function appKey(event) {
  return typeof event?.appId === 'string' ? event.appId : '';
}

function listOf(items, emptyText) {
  const ul = document.createElement('ul');
  if (!Array.isArray(items) || items.length === 0) {
    ul.append(text('li', emptyText));
    return ul;
  }
  for (const item of items) ul.append(text('li', `${item?.id ?? '확인 불가'}: ${item?.text ?? ''}`));
  return ul;
}

// 불러오는 중·빈 목록·실패를 서로 다른 문장으로 보여 준다. 실패에는 사용자가 직접 누르는 다시 시도 안내를 붙인다.
function statusSection(title, what, resource, buildOk) {
  const box = document.createElement('section');
  box.className = 'identity-section';
  box.append(text('h4', title));
  const mode = resource?.mode ? modeLabel(resource.mode) : null;
  if (mode) box.append(text('p', `자료 출처: ${mode}`, 'identity-mode'));
  const status = resource?.status;
  if (status === 'loading') {
    box.append(text('p', `${what} 불러오는 중`));
  } else if (status === 'error') {
    const message = resource.error?.message;
    const timedOut = resource.error?.code === 'TIMEOUT';
    box.append(
      text('p', `${what} 조회에 실패했습니다${timedOut ? ' (시간 초과)' : ''}: ${typeof message === 'string' && message ? message : '확인 불가'}`, 'identity-warn'),
      text('p', '다시 시도는 위쪽 다시 불러오기 버튼을 직접 누르세요. 자동으로 다시 요청하지 않습니다.'),
    );
  } else if (status === 'ok' && resource.data != null) {
    buildOk(box, resource.data);
  } else if (status === 'idle') {
    box.append(text('p', `${what}: 아직 불러오지 않았습니다`));
  } else {
    box.append(text('p', `${what}: 확인 불가`, 'identity-warn'));
  }
  return box;
}

// 진단 결과에서 정해진 값만 꺼낸다. 그 밖의 필드(키·토큰 등)는 읽지도 표시하지도 않는다.
function safeDiagnostics(data) {
  const pick = (v) => (typeof v === 'string' && v ? v : '확인 불가');
  return [
    ['requestId', pick(data?.requestId)],
    ['component', pick(data?.component)],
    ['version', pick(data?.version)],
    ['checkedAt', pick(data?.checkedAt)],
    ['engine.mode', pick(data?.engine?.mode)],
    ['engine.code', pick(data?.engine?.code)],
  ];
}

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
    // 필터·상세 선택은 이 클로저에 둔다. 새 자료가 오면 이전 목록과 상세를 지우고 다시 그린다.
    renderEvents({ status, mode, data, error } = {}) {
      const root = document.createElement('div');
      root.className = 'student-events';
      root.append(text('p', `자료 출처: ${modeLabel(mode)}`, 'identity-mode'));
      let selectedId = null;

      if (status === 'loading') {
        root.append(text('p', '기록을 불러오는 중'));
        return root;
      }
      if (status === 'error') {
        if (error?.code === 'CONTRACT_MISMATCH') {
          root.append(text('p', '확인 불가: 기록 형식이 계약과 달라 목록을 표시하지 않습니다.', 'identity-warn'));
        } else {
          const message = error?.message;
          root.append(text('p', `기록을 불러오지 못했습니다: ${typeof message === 'string' && message ? message : '확인 불가'}`, 'identity-warn'));
        }
        return root;
      }
      if (status !== 'ok' || !Array.isArray(data)) {
        root.append(text('p', '확인 불가: 기록 상태를 알 수 없습니다.', 'identity-warn'));
        return root;
      }
      if (data.length === 0) {
        root.append(text('p', '표시할 기록이 없습니다'));
        return root;
      }

      // 원본 배열은 수정하지 않고 복사본을 at 기준 최신순으로 정렬한다.
      const events = data.filter((e) => e && typeof e === 'object')
        .sort((a, b) => timeValue(b.at) - timeValue(a.at));
      const filters = { kind: 'all', appId: 'all', access: 'all' };

      const controls = document.createElement('div');
      controls.className = 'student-events-filters';
      const count = text('p', '', 'student-events-count');
      count.setAttribute('role', 'status');
      const list = document.createElement('ul');
      list.className = 'student-events-list';
      const detail = document.createElement('div');
      detail.className = 'student-events-detail';

      const draw = () => {
        const shown = events.filter((e) => (filters.kind === 'all' || e.kind === filters.kind)
          && (filters.appId === 'all' || appKey(e) === filters.appId)
          && (filters.access === 'all' || e.state?.access === filters.access));
        count.textContent = `표시 ${shown.length}건 / 받은 기록 ${events.length}건 (본인 최근 기록만 해당)`;
        list.replaceChildren();
        if (shown.length === 0) list.append(text('li', '선택한 조건에 맞는 기록이 없습니다'));
        for (const event of shown) {
          const item = document.createElement('li');
          item.dataset.studentEventId = String(event.id);
          item.append(
            text('span', `${event.id} · `),
            text('span', `${formatTime(event.at)} · `),
            text('strong', `${lookupLabel(KIND_LABELS, event.kind)} · `),
            text('span', event.appId ? `앱 ${event.appId} · ` : '앱을 확인할 수 없음 · '),
            text('span', `${event.summary ?? ''} `),
          );
          const button = text('button', `${event.id} 상세`);
          button.type = 'button';
          button.addEventListener('click', () => { selectedId = event.id; drawDetail(); });
          item.append(button);
          list.append(item);
        }
      };

      const drawDetail = () => {
        detail.replaceChildren();
        const event = events.find((e) => e.id === selectedId);
        if (!event) return;
        detail.dataset.studentEventDetail = String(event.id);
        const state = event.state ?? {};
        detail.append(
          text('h4', `${event.id} 상세`),
          row('사건 ID', String(event.id)),
          row('앱', event.appId ? event.appId : '앱을 확인할 수 없음'),
          text('h5', '근거'),
          listOf(event.evidence, '근거 없음'),
          text('h5', '적용 규칙'),
          listOf(event.rules, '규칙 없음'),
          text('h5', '상태'),
          row('접속 상태', withRaw(lookup(ACCESS_LABELS, state.access), state.access), state.access !== 'allowed'),
          row('세션 상태', withRaw(lookup(SESSION_LABELS, state.session), state.session), state.session !== 'active'),
          row('기기 상태', withRaw(lookup(DEVICE_LABELS, state.device), state.device), state.device !== 'compliant'),
        );
        // 지원되지 않는 조치만 요청 없이 비활성 안내로 둔다. 목록이 비어 있으면 아무것도 만들지 않는다.
        const actions = Array.isArray(event.supportedActions) ? event.supportedActions : [];
        if (actions.length > 0) {
          detail.append(text('h5', '조치'));
          for (const item of actions) {
            const action = typeof item === 'string' ? item : (item?.id ?? item?.action ?? '확인 불가');
            const button = text('button', `${action} 미지원`);
            button.type = 'button';
            button.disabled = true;
            detail.append(button, text('p', '아직 지원하지 않는 조치입니다. 조치 실행 연결은 준비 중이며 어떤 요청도 보내지 않습니다.'));
          }
        }
      };

      const select = (label, key, values, optionLabel) => {
        const wrap = document.createElement('label');
        wrap.append(text('span', `${label} `));
        const el = document.createElement('select');
        const all = text('option', '전체');
        all.value = 'all';
        el.append(all);
        for (const value of values) {
          const option = text('option', optionLabel(value));
          option.value = value;
          el.append(option);
        }
        el.addEventListener('change', () => { filters[key] = el.value; draw(); });
        wrap.append(el);
        return wrap;
      };
      const distinct = (pick) => [...new Set(events.map(pick).filter((v) => typeof v === 'string'))];
      controls.append(
        select('기록 종류', 'kind', distinct((e) => e.kind), (v) => `${lookupLabel(KIND_LABELS, v)} (${v})`),
        select('업무 앱', 'appId', distinct(appKey), (v) => (v === '' ? '앱을 확인할 수 없음' : v)),
        select('접속 상태', 'access', distinct((e) => e.state?.access), (v) => `${lookup(ACCESS_LABELS, v)} (${v})`),
      );

      draw();
      root.append(controls, count, list, detail);
      return root;
    },
    // 호출마다 새 요소를 만들어 이전 실패 안내를 지운다. 자동 재요청은 없고, 복사는 버튼을 누를 때만 한다.
    renderStatus({ devices, sessions, notifications, diagnostics, mode } = {}) {
      const root = document.createElement('div');
      root.className = 'student-status';
      root.append(text('p', `자료 출처: ${modeLabel(mode)}`, 'identity-mode'));

      root.append(
        statusSection('등록 기기', '등록 기기', devices, (box, data) => {
          if (!Array.isArray(data) || data.length === 0) return box.append(text('p', '등록된 기기가 없습니다'));
          for (const device of data) box.append(deviceRow(device));
        }),
        statusSection('로그인 세션', '로그인 세션', sessions, (box, data) => {
          box.append(text('p', '지금 검증된 연결 한 개만 표시합니다. 지난 세션 목록이 아닙니다.', 'identity-mode'));
          if (!Array.isArray(data) || data.length === 0) return box.append(text('p', '현재 연결 없음'));
          for (const session of data) box.append(sessionRow(session));
        }),
      );

      const alerts = document.createElement('section');
      alerts.className = 'identity-section';
      alerts.append(text('h4', '알림'));
      if (!Array.isArray(notifications)) {
        alerts.append(text('p', '확인 불가: 알림 목록을 받지 못했습니다.', 'identity-warn'));
      } else if (notifications.length === 0) {
        alerts.append(text('p', '주의할 알림이 없습니다'));
      } else {
        const ul = document.createElement('ul');
        for (const n of notifications) {
          ul.append(text('li', `자료 ${n?.resource ?? '확인 불가'} · 코드 ${n?.code ?? '확인 불가'}: ${n?.message ?? ''}`));
        }
        alerts.append(ul);
      }
      root.append(alerts);

      const help = statusSection('도움정보', '도움정보', diagnostics, (box, data) => {
        const safe = safeDiagnostics(data);
        for (const [name, value] of safe) box.append(row(name, value));
        box.append(text('p', '이 정보는 도움을 요청할 때 쓰도록 복사하는 것입니다. 비밀번호·토큰·API 키는 포함되지 않습니다. 복사 전에는 어디에도 전송되지 않습니다.'));
        const copy = text('button', '도움정보 복사');
        copy.type = 'button';
        const result = text('p', '', 'student-copy-result');
        result.setAttribute('role', 'status');
        copy.addEventListener('click', async () => {
          const body = safe.map(([name, value]) => `${name}: ${value}`).join('\n');
          try {
            await navigator.clipboard.writeText(body);
            result.textContent = '도움정보를 클립보드에 복사했습니다.';
          } catch {
            result.textContent = '복사하지 못했습니다. 위 내용을 직접 선택해 복사하세요.';
          }
        });
        box.append(copy, result);
      });
      root.append(help);
      return root;
    },
    renderVulnerabilities() { return '학생 구현 대기: 정확한 설치 버전·OSV 출처·조회 시각·부분 결과·조회 실패를 구분하세요.'; },
    renderAiConnection() { return '학생 구현 대기: 모델 응답 점검과 실제 사건 설명을 구분하고 AI 오류·취소·수동 복구를 안내하세요.'; },
    renderExplanation() { return '학생 구현 대기: 선택한 사건의 근거·규칙·현재 상태와 AI 설명을 연결하세요. 제안은 자동 실행하지 않습니다.'; },
    renderAction() { return '학생 구현 대기: 현재 사건·조치·실제 대상·사람 확인·ACK와 원천 효과·unknown을 구분하세요.'; },
  };
}
