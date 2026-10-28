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

// error.code 별 원인 구분과 안내 방향. 모르는 코드는 확인 불가로 처리한다.
const PENDING = { cause: '권한 준비 중·확인 불가', guide: '담당자에게 계정 연결과 앱 권한 확인을 요청하세요. 학생 잘못이 아닙니다.' };
const AUTH = { cause: '인증 실패', guide: '계정 연결을 다시 확인하고, 계속되면 담당자에게 확인을 요청하세요.' };
const BLOCKED = { cause: '접근 제한', guide: '계정 연결을 다시 확인하고, 담당자에게 앱 이용 권한을 확인하세요.' };
const BUDGET = { cause: '반 사용량·이용 한도', guide: '담당자에게 확인을 요청하세요.' };
const CLOSED = { cause: '이용 시간 아님', guide: '이용 시간을 확인하세요.' };
const RETRY = { cause: '요청 제한·시간 초과·네트워크', guide: '잠시 뒤 직접 다시 점검하세요. 자동으로 다시 점검하지 않습니다.' };
const CANCELLED = { cause: '취소', guide: '취소됨. 이전 결과는 현재 결과가 아닙니다.' };
const NO_MODEL = { cause: '쓸 수 있는 모델 없음', guide: '담당자에게 모델 허용 설정 확인을 요청하세요.' };
const AI_ERROR_GROUPS = {
  ON_AI_PROVISIONING_PENDING: PENDING,
  WB_CLCO_AUTH_REQUIRED: AUTH,
  WB_CLCO_ACCESS_BLOCKED: BLOCKED,
  ON_AI_AUTHORIZATION_CHANGED: BLOCKED,
  SUBJECT_SCOPE_UNVERIFIED: BLOCKED,
  WB_CLCO_COHORT_BUDGET_EXHAUSTED: BUDGET,
  WB_CLCO_LIMIT_REACHED: BUDGET,
  WB_CLCO_SESSION_CLOSED: CLOSED,
  WB_CLCO_RATE_LIMITED: RETRY,
  WB_CLCO_TIMEOUT: RETRY,
  REQUEST_TIMEOUT: RETRY,
  ENGINE_TIMEOUT: RETRY,
  TIMEOUT: RETRY,
  WB_CLCO_CANCELLED: CANCELLED,
  CANCELLED,
  REQUEST_CANCELLED: CANCELLED,
  MODEL_NOT_CONFIGURED: NO_MODEL,
  ON_AI_MODEL_LIST_EMPTY: NO_MODEL,
  AI_REQUEST_UNVERIFIED: { cause: '확인 불가', guide: '연결 또는 응답을 확인할 수 없습니다. 잠시 뒤 직접 다시 점검하고, 계속되면 담당자에게 문의하세요.' },
};

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

// ---------- 내 PC 상태 (renderStatus 칸 안에 표시) ----------
// 값은 서버의 GET /api/pc-status(student/pc-status.mjs)가 이 PC에서 읽은 것만 씁니다. 예시값·기본값은 없습니다.
// SDP 연결 상태와 PC 조회 상태는 따로 보여 줍니다. 이 패널은 접속 판정이나 SDP 연결과 무관합니다.
const PC_PATH = '/api/pc-status';
const PC_HISTORY_KEY = 'kesheb.pcHistory.v1';
const PC_HISTORY_MAX = 100;
const PC_ITEM_COUNT = 6;
const PC_REASONS = {
  timeout: ['시간 안에 응답하지 않았습니다', '잠시 뒤 「다시 조회」를 눌러 보세요.'],
  access_denied: ['일반 사용자 권한으로는 읽을 수 없습니다', '권한을 올리거나 보안 설정을 바꾸지 말고 확인 불가로 두세요. 필요하면 담당자에게 문의하세요.'],
  policy_blocked: ['PowerShell 실행 정책이 조회 스크립트를 막았습니다', '이 앱은 정책을 바꾸거나 우회하지 않습니다. 허용 방법은 담당자와 상의하세요.'],
  powershell_missing: ['Windows PowerShell을 찾지 못했습니다', '내 Windows PC에서 앱을 실행했는지 확인하세요.'],
  unsupported_platform: ['Windows가 아닌 환경입니다', '내 Windows PC에서 앱을 실행하세요.'],
  not_supported: ['이 Windows에서 해당 조회 명령을 쓸 수 없습니다', '담당자에게 문의하세요.'],
  output_invalid: ['조회 결과의 형식을 확인하지 못했습니다', '다시 조회하고, 계속되면 담당자에게 알리세요.'],
  output_too_large: ['조회 결과가 너무 커서 받지 않았습니다', '다시 조회하고, 계속되면 담당자에게 알리세요.'],
  no_sample: ['측정에 필요한 값을 얻지 못했습니다', '다시 조회하세요.'],
  failed: ['조회 중 오류가 났습니다', '다시 조회하고, 계속되면 담당자에게 알리세요.'],
};
const FIREWALL_LABELS = { Domain: '도메인 네트워크', Private: '개인 네트워크', Public: '공용 네트워크' };
const FIREWALL_STATE_LABELS = { true: '켜짐', false: '꺼짐', notconfigured: '미구성' };

const isObj = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const inRange = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const isCount = value => Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000;
const validTime = value => typeof value === 'string' && !Number.isNaN(Date.parse(value));
const roundTo = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;

// 한 항목의 형식을 확인한다. 형식이 다르면 값을 쓰지 않고 확인 불가로 바꾼다.
function pcItem(raw, parse) {
  const invalid = { status: 'unavailable', reason: 'output_invalid', measuredAt: isObj(raw) && validTime(raw.measuredAt) ? raw.measuredAt : null };
  if (!isObj(raw)) return invalid;
  if (raw.status === 'unavailable') {
    return { status: 'unavailable', reason: Object.hasOwn(PC_REASONS, raw.reason) ? raw.reason : 'failed', measuredAt: invalid.measuredAt };
  }
  if (raw.status !== 'ok' || !validTime(raw.measuredAt)) return invalid;
  const parsed = parse(raw);
  return parsed ? { status: 'ok', ...parsed, measuredAt: raw.measuredAt } : invalid;
}

function normalizePc(data) {
  if (!isObj(data) || !validTime(data.finishedAt)) return null;
  return {
    finishedAt: data.finishedAt,
    cpu: pcItem(data.cpu, r => inRange(r.percent, 0, 100) && inRange(r.windowMs, 100, 10000) && inRange(r.logicalCores, 1, 4096)
      ? { percent: r.percent, windowMs: r.windowMs, logicalCores: r.logicalCores } : null),
    memory: pcItem(data.memory, r => inRange(r.usedPercent, 0, 100) && inRange(r.totalGiB, 0.1, 1e6) && inRange(r.availableGiB, 0, 1e6)
      ? { usedPercent: r.usedPercent, totalGiB: r.totalGiB, availableGiB: r.availableGiB } : null),
    disk: pcItem(data.disk, r => typeof r.drive === 'string' && /^([A-Za-z]:|\/)$/.test(r.drive) && inRange(r.freeGiB, 0, 1e9)
      && inRange(r.totalGiB, 0.1, 1e9) && inRange(r.freePercent, 0, 100)
      ? { drive: r.drive, freeGiB: r.freeGiB, totalGiB: r.totalGiB, freePercent: r.freePercent } : null),
    network: pcItem(data.network, r => isCount(r.adapterTotal) && isCount(r.adapterUp) && r.adapterUp <= r.adapterTotal
      ? { adapterTotal: r.adapterTotal, adapterUp: r.adapterUp,
        categories: isObj(r.categories) && isCount(r.categories.public) && isCount(r.categories.private) && isCount(r.categories.domain)
          ? { public: r.categories.public, private: r.categories.private, domain: r.categories.domain } : null } : null),
    firewall: pcItem(data.firewall, r => {
      if (!Array.isArray(r.profiles) || r.profiles.length === 0) return null;
      const profiles = [];
      for (const p of r.profiles) {
        if (!isObj(p) || !Object.hasOwn(FIREWALL_LABELS, p.name) || !Object.hasOwn(FIREWALL_STATE_LABELS, p.enabled)) return null;
        profiles.push({ name: p.name, enabled: p.enabled });
      }
      return { profiles };
    }),
    events: pcItem(data.events, r => {
      if (r.windowHours !== 24 || !Array.isArray(r.logs)) return null;
      const logs = [];
      for (const l of r.logs) {
        if (!isObj(l) || (l.name !== 'System' && l.name !== 'Application')) return null;
        if (l.status === 'ok' && isCount(l.errors) && isCount(l.warnings)) logs.push({ name: l.name, status: 'ok', errors: l.errors, warnings: l.warnings, truncated: l.truncated === true });
        else if (l.status === 'unavailable') logs.push({ name: l.name, status: 'unavailable', reason: Object.hasOwn(PC_REASONS, l.reason) ? l.reason : 'failed' });
        else return null;
      }
      return logs.length === 2 && new Set(logs.map(l => l.name)).size === 2 ? { windowHours: 24, logs } : null;
    }),
  };
}

// 시각은 이 브라우저의 시간대로 쓰고 시간대 이름을 붙인다.
function formatLocal(at) {
  const t = typeof at === 'string' ? Date.parse(at) : NaN;
  return Number.isNaN(t) ? '시각 확인 불가' : new Date(t).toLocaleString('ko-KR', { hour12: false, timeZoneName: 'short' });
}

function formatElapsed(fromAt, toAt) {
  const seconds = Math.round((Date.parse(toAt) - Date.parse(fromAt)) / 1000);
  if (!Number.isFinite(seconds) || seconds < 0) return '간격 확인 불가';
  if (seconds < 60) return `${seconds}초`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}분 ${seconds % 60}초`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}시간 ${Math.floor((seconds % 3600) / 60)}분`;
  return `${Math.floor(seconds / 86400)}일 이상`;
}

// 추이 기록에는 CPU·메모리·디스크 숫자와 측정 시각만 둔다. 네트워크·방화벽·Windows 기록은 저장하지 않는다.
function cleanHistoryEntry(entry) {
  if (!isObj(entry) || !validTime(entry.t)) return null;
  const pick = (value, max) => (inRange(value, 0, max) ? value : null);
  const clean = { t: entry.t, cpu: pick(entry.cpu, 100), mem: pick(entry.mem, 100), disk: pick(entry.disk, 1e9) };
  return clean.cpu === null && clean.mem === null && clean.disk === null ? null : clean;
}

function readHistory() {
  let stored;
  try { stored = localStorage.getItem(PC_HISTORY_KEY); } catch { return { list: [], storage: false }; }
  if (stored === null) return { list: [], storage: true };
  try {
    const parsed = JSON.parse(stored);
    const list = Array.isArray(parsed) ? parsed.map(cleanHistoryEntry).filter(Boolean).slice(-PC_HISTORY_MAX) : [];
    return { list, storage: true };
  } catch { return { list: [], storage: true }; }
}

function writeHistory(list) {
  try {
    if (list.length === 0) localStorage.removeItem(PC_HISTORY_KEY);
    else localStorage.setItem(PC_HISTORY_KEY, JSON.stringify(list));
    return true;
  } catch { return false; }
}

function sdpState(mode, diagnostics) {
  if (mode === 'disconnected') return ['SDP 미연결', true];
  if (mode === 'demo') return ['SDP 미연결 (예제 자료 모드이며 실제 연결이 아닙니다)', true];
  if (mode === 'connected') {
    const code = diagnostics?.status === 'ok' && typeof diagnostics.data?.engine?.code === 'string' && /^[A-Z_]{1,40}$/.test(diagnostics.data.engine.code)
      ? `, 엔진 코드 ${diagnostics.data.engine.code}` : '';
    return [`서버가 엔진 모드 '연결됨'으로 보고함${code}. 이 화면이 SDP 서버 연결을 직접 확인한 것은 아닙니다`, false];
  }
  return ['SDP 연결 상태 확인 불가', true];
}

function changeLine(name, prev, cur, unit, deltaUnit, threshold) {
  const delta = roundTo(cur - prev, 1);
  const word = Math.abs(delta) < threshold ? '거의 같음' : delta > 0 ? '증가' : '감소';
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '±';
  return `${name}: ${prev}${unit} → ${cur}${unit} (${sign}${Math.abs(delta)}${deltaUnit}) ${word}`;
}

// ---- 화면 디자인 (이 패널 안에서만 적용) ----
// 앱의 CSP(style-src 'self')가 <style>과 style 속성을 막으므로, CSSOM 방식인 constructed stylesheet로 넣는다.
// 모든 규칙은 .kpc 안쪽에만 걸리며 앱 공통 화면에는 영향을 주지 않는다. 지원하지 않는 브라우저는 스타일 없이 읽을 수 있는 문서 모양으로 보인다.
const PC_THEME_KEY = 'kesheb.pcTheme.v1';
const PC_VIEWS = [['overview', '개요'], ['status', 'PC 상태'], ['compare', '변화 비교'], ['inspect', 'PC 점검']];
const PC_THEME_CHOICES = [['system', '시스템'], ['light', '라이트'], ['dark', '다크']];
// 상태는 색만으로 구분하지 않고 아이콘 + 글자를 함께 쓴다.
const PC_BADGES = { ok: ['✓', '정상'], warn: ['▲', '주의'], unknown: ['?', '확인 불가'], info: ['i', '참고'] };
const PC_STYLE = `
.kpc{--k-bg-a:#eef3fb;--k-bg-b:#ece7f8;--k-blob1:rgba(96,140,255,.30);--k-blob2:rgba(167,139,250,.26);
--k-card:rgba(255,255,255,.80);--k-solid:#ffffff;--k-line:rgba(15,23,42,.18);--k-line-strong:#64748b;
--k-text:#0f172a;--k-muted:#475569;--k-accent:#1d4ed8;--k-accent-soft:#dbe6ff;--k-track:#cbd5e1;
--k-ok:#166534;--k-ok-bg:#dcfce7;--k-warn:#92400e;--k-warn-bg:#fef3c7;--k-unk:#334155;--k-unk-bg:#e2e8f0;--k-info:#1e3a8a;--k-info-bg:#dbeafe;
--k-btn-bg:#1d4ed8;--k-btn-text:#ffffff;--k-dis-bg:#e2e8f0;--k-dis-text:#475569;--k-focus:#1d4ed8;
--k-shadow:0 1px 2px rgba(15,23,42,.08),0 6px 18px rgba(15,23,42,.06);
container-type:inline-size;container-name:kpc;position:relative;isolation:isolate;overflow:hidden;padding:14px;
border:1px solid var(--k-line);border-radius:14px;color:var(--k-text);line-height:1.5;
background:radial-gradient(60% 80% at 0% 0%,var(--k-blob1),transparent 70%),radial-gradient(55% 70% at 100% 100%,var(--k-blob2),transparent 70%),linear-gradient(135deg,var(--k-bg-a),var(--k-bg-b))}
.kpc[data-theme="dark"]{--k-bg-a:#0b1220;--k-bg-b:#161230;--k-blob1:rgba(59,130,246,.28);--k-blob2:rgba(139,92,246,.26);
--k-card:rgba(17,24,39,.78);--k-solid:#111827;--k-line:rgba(255,255,255,.22);--k-line-strong:#94a3b8;
--k-text:#f1f5f9;--k-muted:#cbd5e1;--k-accent:#93c5fd;--k-accent-soft:#1e3a5f;--k-track:#334155;
--k-ok:#86efac;--k-ok-bg:#052e16;--k-warn:#fcd34d;--k-warn-bg:#451a03;--k-unk:#e2e8f0;--k-unk-bg:#1f2937;--k-info:#bfdbfe;--k-info-bg:#172554;
--k-btn-bg:#93c5fd;--k-btn-text:#0b1220;--k-dis-bg:#1f2937;--k-dis-text:#cbd5e1;--k-focus:#fbbf24;
--k-shadow:0 1px 2px rgba(0,0,0,.4),0 8px 22px rgba(0,0,0,.28);color-scheme:dark}
.kpc[data-theme="light"]{color-scheme:light}
.kpc *{box-sizing:border-box}
.kpc h4,.kpc h5,.kpc p,.kpc ul{margin:0;padding:0}
.kpc h4{font-size:1rem;color:var(--k-text)}
.kpc h5{font-size:1.05rem;color:var(--k-text)}
.kpc-shell{display:grid;grid-template-columns:200px minmax(0,1fr);gap:14px;align-items:start}
.kpc-panel{background:var(--k-solid);border:1px solid var(--k-line);border-radius:12px;box-shadow:var(--k-shadow);padding:14px;margin:0}
.kpc-main{display:grid;gap:12px;min-width:0}
.kpc-sub{color:var(--k-muted);font-size:.88rem}
.kpc-nav{display:grid;gap:12px}
.kpc-nav-list{display:flex;flex-direction:column;gap:6px;list-style:none}
.kpc-theme{display:grid;gap:6px}
.kpc-theme-list{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
.kpc .kpc-theme-list button{padding:6px 2px;text-align:center}
.kpc button{font:inherit;min-height:40px;padding:6px 12px;border:1px solid var(--k-line-strong);border-radius:8px;background:var(--k-solid);color:var(--k-text);cursor:pointer;text-align:left}
.kpc button:hover{border-color:var(--k-accent)}
.kpc button:focus-visible{outline:3px solid var(--k-focus);outline-offset:2px;box-shadow:none}
.kpc .kpc-nav-list button{width:100%}
.kpc button[aria-current="page"],.kpc button[aria-pressed="true"]{background:var(--k-accent-soft);color:var(--k-text);font-weight:700;border-color:var(--k-accent);box-shadow:inset 4px 0 0 var(--k-accent)}
.kpc button.kpc-primary{background:var(--k-btn-bg);color:var(--k-btn-text);border-color:var(--k-btn-bg);font-weight:700;text-align:center}
.kpc button[aria-disabled="true"]{background:var(--k-dis-bg);color:var(--k-dis-text);border:1px dashed var(--k-line-strong);cursor:not-allowed;font-weight:400}
.kpc-head{display:grid;gap:8px}
.kpc-head-row{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;justify-content:space-between}
.kpc-chips{display:flex;flex-wrap:wrap;gap:6px 16px}
.kpc-chip{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.kpc-badge{display:inline-flex;gap:4px;align-items:center;padding:1px 8px;border-radius:999px;font-size:.82rem;font-weight:700;border:1px solid currentColor;white-space:nowrap}
.kpc-badge-ok{color:var(--k-ok);background:var(--k-ok-bg)}
.kpc-badge-warn{color:var(--k-warn);background:var(--k-warn-bg)}
.kpc-badge-unknown{color:var(--k-unk);background:var(--k-unk-bg)}
.kpc-badge-info{color:var(--k-info);background:var(--k-info-bg)}
.kpc-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px}
.kpc-kpi{display:grid;gap:6px;background:var(--k-solid);border:1px solid var(--k-line);border-radius:12px;box-shadow:var(--k-shadow);padding:12px;align-content:start}
.kpc-kpi-label{font-weight:700}
.kpc-kpi-value{font-size:1.9rem;font-weight:700;line-height:1.15;font-variant-numeric:tabular-nums}
.kpc-kpi-value small{font-size:.95rem;font-weight:600;color:var(--k-muted);margin-left:4px}
.kpc-bar{height:8px;border-radius:999px;background:var(--k-track);overflow:hidden}
.kpc-bar span{display:block;height:100%;border-radius:999px;background:var(--k-accent)}
.kpc-list{display:grid;gap:8px;list-style:none}
.kpc-item{display:grid;grid-template-columns:auto minmax(0,1fr);gap:10px;align-items:start;padding:8px 0;border-top:1px solid var(--k-line)}
.kpc-list>.kpc-item:first-child,.kpc-panel>.kpc-item:first-of-type{border-top:0}
.kpc-item-name{font-weight:700}
.kpc-item-value{overflow-wrap:anywhere}
.kpc-detail{color:var(--k-muted);font-size:.88rem;overflow-wrap:anywhere}
.kpc-note{color:var(--k-muted);font-size:.88rem;margin-top:8px}
.kpc-strong{font-weight:700}
.kpc-stack{display:grid;gap:8px}
.kpc-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
@supports ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){
.kpc-panel,.kpc-kpi{background:var(--k-card);-webkit-backdrop-filter:blur(10px) saturate(1.1);backdrop-filter:blur(10px) saturate(1.1)}}
@media (prefers-reduced-transparency:reduce){
.kpc-panel,.kpc-kpi{background:var(--k-solid)!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important}}
@media (forced-colors:active){.kpc-panel,.kpc-kpi,.kpc-badge,.kpc button{border:1px solid CanvasText}}
@container kpc (max-width:640px){
.kpc-shell{grid-template-columns:minmax(0,1fr)}
.kpc-nav-list{flex-direction:row;flex-wrap:wrap}
.kpc .kpc-nav-list button{width:auto}
.kpc-kpis{grid-template-columns:minmax(0,1fr)}
.kpc-item{grid-template-columns:minmax(0,1fr)}}
`;

let pcStyleReady = false;
function installPcStyle() {
  if (pcStyleReady) return;
  pcStyleReady = true;
  try {
    if (typeof CSSStyleSheet === 'function' && document.adoptedStyleSheets !== undefined) {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(PC_STYLE);
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    }
  } catch { /* 스타일을 못 넣어도 내용은 그대로 읽을 수 있다 */ }
}

function node(tag, className, ...children) {
  const created = document.createElement(tag);
  if (className) created.className = className;
  created.append(...children);
  return created;
}

function badge(kind) {
  const [icon, label] = PC_BADGES[kind];
  const mark = text('span', icon);
  mark.setAttribute('aria-hidden', 'true');
  return node('span', `kpc-badge kpc-badge-${kind}`, mark, text('span', label));
}

function kpcItem(kind, name, value, details = []) {
  return node('div', `kpc-item kpc-item-${kind}`, badge(kind),
    node('div', '', text('p', name, 'kpc-item-name'), text('p', value, 'kpc-item-value'), ...details.map(d => text('p', d, 'kpc-detail'))));
}

function readTheme() {
  try {
    const stored = localStorage.getItem(PC_THEME_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch { return 'system'; }
}

function systemPrefersDark() {
  try { return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches === true; } catch { return false; }
}

// 주의·확인 불가 항목을 한곳에 모은다. 기준 값은 보안 판정이 아니라 참고 기준이다.
function pcAttention(result) {
  if (!result) return [];
  const out = [];
  const reasonOf = item => (PC_REASONS[item.reason] ?? PC_REASONS.failed)[0];
  for (const [label, item] of [['CPU 사용률', result.cpu], ['메모리 사용량', result.memory], ['디스크 남은 공간', result.disk]]) {
    if (item.status !== 'ok') out.push(['unknown', `${label}: 확인 불가 — ${reasonOf(item)}`]);
  }
  if (result.cpu.status === 'ok' && result.cpu.percent >= 90) out.push(['warn', `CPU 사용률이 높습니다 (${result.cpu.percent} %)`]);
  if (result.memory.status === 'ok' && result.memory.usedPercent >= 90) out.push(['warn', `메모리 사용률이 높습니다 (${result.memory.usedPercent} %)`]);
  if (result.disk.status === 'ok' && result.disk.freePercent < 10) out.push(['warn', `디스크 남은 비율이 낮습니다 (${result.disk.drive} ${result.disk.freePercent} %)`]);
  if (result.network.status !== 'ok') out.push(['unknown', `네트워크 어댑터: 확인 불가 — ${reasonOf(result.network)}`]);
  else if (result.network.adapterTotal > 0 && result.network.adapterUp === 0) out.push(['warn', '연결된 네트워크 어댑터가 없습니다']);
  if (result.firewall.status !== 'ok') out.push(['unknown', `Windows 방화벽: 확인 불가 — ${reasonOf(result.firewall)}`]);
  else for (const p of result.firewall.profiles) if (p.enabled !== 'true') out.push(['warn', `방화벽 ${FIREWALL_LABELS[p.name]}: ${FIREWALL_STATE_LABELS[p.enabled]}`]);
  if (result.events.status !== 'ok') out.push(['unknown', `Windows 기록: 확인 불가 — ${reasonOf(result.events)}`]);
  else for (const log of result.events.logs) if (log.status !== 'ok') out.push(['unknown', `${log.name} 로그: 확인 불가 — ${reasonOf(log)}`]);
  return out;
}

function createPcDashboard({ api, onChange } = {}) {
  const pc = {
    loading: false, started: false, result: null, failed: null, attemptedAt: null,
    previous: null, current: null, confirmClear: false, focusId: null, history: null,
    view: 'overview', theme: readTheme(), watchingTheme: false,
  };
  const changed = () => { try { if (typeof onChange === 'function') onChange(); } catch { /* 표시 갱신 실패는 조회 결과와 무관하다 */ } };
  const ensureHistory = () => (pc.history ??= readHistory());
  const effectiveTheme = () => (pc.theme === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : pc.theme);

  function watchSystemTheme() {
    if (pc.watchingTheme) return;
    pc.watchingTheme = true;
    try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (pc.theme === 'system') changed(); }); } catch { /* 시스템 테마 변경 감지를 못 해도 다시 그릴 때 반영된다 */ }
  }

  function setTheme(choice) {
    pc.theme = choice;
    try {
      if (choice === 'system') localStorage.removeItem(PC_THEME_KEY);
      else localStorage.setItem(PC_THEME_KEY, choice);
    } catch { /* 저장 못 하면 이번 화면에서만 적용된다 */ }
    pc.focusId = `pc-theme-${choice}`;
    changed();
  }

  function record(result) {
    const history = ensureHistory();
    const entry = cleanHistoryEntry({
      t: result.finishedAt,
      cpu: result.cpu.status === 'ok' ? result.cpu.percent : null,
      mem: result.memory.status === 'ok' ? result.memory.usedPercent : null,
      disk: result.disk.status === 'ok' ? result.disk.freeGiB : null,
    });
    pc.previous = history.list.at(-1) ?? null;
    pc.current = entry;
    if (!entry) return;
    history.list = [...history.list, entry].slice(-PC_HISTORY_MAX);
    history.storage = writeHistory(history.list);
  }

  async function load() {
    if (pc.loading) return;
    if (!api || typeof api.get !== 'function') {
      pc.failed = { code: 'NO_API', message: '학생 화면에 조회 연결이 없어 조회할 수 없습니다.' };
      pc.attemptedAt = new Date().toISOString();
      return changed();
    }
    pc.loading = true;
    pc.confirmClear = false;
    changed();
    let response;
    try { response = await api.get(PC_PATH); } catch { response = { ok: false, error: { code: 'NETWORK_ERROR', message: '로컬 서버에 연결할 수 없습니다.' } }; }
    pc.loading = false;
    pc.attemptedAt = new Date().toISOString();
    const result = response?.ok === true ? normalizePc(response.data) : null;
    if (result) {
      pc.result = result;
      pc.failed = null;
      record(result);
    } else {
      const code = typeof response?.error?.code === 'string' && /^[A-Z_]{1,40}$/.test(response.error.code) ? response.error.code : 'INVALID_RESPONSE';
      const message = response?.ok === true ? '서버 응답 형식을 확인할 수 없습니다.'
        : typeof response?.error?.message === 'string' && response.error.message ? response.error.message : '서버가 오류 내용을 제공하지 않았습니다.';
      pc.failed = { code, message };
    }
    changed();
  }

  // 값을 읽은 항목은 정상/주의, 못 읽은 항목은 이유와 다음 행동이 붙은 확인 불가로 보여 준다.
  function metricItem(tag, name, item, build) {
    if (item.status !== 'ok') {
      const [reason, next] = PC_REASONS[item.reason] ?? PC_REASONS.failed;
      return kpcItem('unknown', name, `[확인 불가] ${reason}`, [`다음 행동: ${next}${item.measuredAt ? ` (시도 시각 ${formatLocal(item.measuredAt)})` : ''}`]);
    }
    const [value, detail, warn] = build(item);
    return kpcItem(warn ? 'warn' : 'ok', name, `[${tag}] ${value}`, [`${detail} · 측정 시각 ${formatLocal(item.measuredAt)}`]);
  }

  function gauge(percent) {
    const fill = document.createElement('span');
    if (fill.style) fill.style.width = `${Math.min(100, Math.max(0, percent))}%`;
    return node('div', 'kpc-bar', fill);
  }

  function kpiCard(label, item, tag, build) {
    const card = node('div', 'kpc-kpi', text('p', label, 'kpc-kpi-label'));
    if (item.status !== 'ok') {
      const [reason, next] = PC_REASONS[item.reason] ?? PC_REASONS.failed;
      card.append(badge('unknown'), text('p', '확인 불가', 'kpc-kpi-value'), text('p', reason, 'kpc-detail'), text('p', `다음 행동: ${next}`, 'kpc-detail'));
      return card;
    }
    const { big, unit, percent, sub, warn } = build(item);
    const value = node('p', 'kpc-kpi-value', big, text('small', unit));
    card.append(badge(warn ? 'warn' : 'ok'), value, gauge(percent), text('p', sub, 'kpc-detail'),
      text('p', `${tag} · 측정 시각 ${formatLocal(item.measuredAt)}`, 'kpc-detail'));
    return card;
  }

  function overviewView(result, tag) {
    const box = node('div', 'kpc-main');
    const core = node('section', 'kpc-panel kpc-stack');
    core.append(text('h5', '핵심 상태'));
    if (!result) {
      core.append(text('p', pc.loading ? '조회 중…' : '아직 조회한 값이 없습니다. 「조회하기」를 누르세요.'));
    } else {
      if (tag === '이전 조회값') core.append(text('p', `아래 값은 ${formatLocal(result.finishedAt)}에 조회한 이전 조회값입니다.`, 'kpc-detail'));
      core.append(node('div', 'kpc-kpis',
        kpiCard('CPU 사용률', result.cpu, tag, i => ({ big: String(i.percent), unit: '%', percent: i.percent, warn: i.percent >= 90, sub: `논리 코어 ${i.logicalCores}개 평균, ${i.windowMs / 1000}초 구간` })),
        kpiCard('메모리 사용량', result.memory, tag, i => ({ big: String(i.usedPercent), unit: '% 사용', percent: i.usedPercent, warn: i.usedPercent >= 90, sub: `사용 가능 ${i.availableGiB} GiB / 전체 ${i.totalGiB} GiB` })),
        kpiCard('디스크 남은 공간', result.disk, tag, i => ({ big: String(i.freeGiB), unit: 'GiB 남음', percent: 100 - i.freePercent, warn: i.freePercent < 10, sub: `${i.drive} 드라이브 · 전체 ${i.totalGiB} GiB 중 ${i.freePercent} % 남음(막대는 사용 비율)` })),
      ));
    }
    const attention = node('section', 'kpc-panel');
    attention.append(text('h5', '주의·확인 불가 항목'));
    const items = pcAttention(result);
    if (!result) attention.append(text('p', pc.loading ? '조회 중…' : '조회 전에는 판단할 수 없습니다.', 'kpc-note'));
    else if (items.length === 0) attention.append(text('p', '주의 또는 확인 불가 항목이 없습니다 (참고 기준 기준, 보안 판정 아님).', 'kpc-note'));
    else attention.append(node('ul', 'kpc-list', ...items.map(([kind, label]) => node('li', `kpc-item kpc-item-${kind}`, badge(kind), text('span', label)))));
    const inspect = node('section', 'kpc-panel');
    inspect.append(text('h5', 'PC 점검 요약'));
    if (!result) inspect.append(text('p', pc.loading ? '조회 중…' : '아직 조회한 값이 없습니다.', 'kpc-note'));
    else {
      const net = result.network;
      const fw = result.firewall;
      const ev = result.events;
      inspect.append(
        net.status === 'ok' ? kpcItem(net.adapterTotal > 0 && net.adapterUp === 0 ? 'warn' : 'ok', '네트워크 어댑터', `총 ${net.adapterTotal}개 중 ${net.adapterUp}개 연결됨`) : kpcItem('unknown', '네트워크 어댑터', '확인 불가'),
        fw.status === 'ok' ? kpcItem(fw.profiles.every(p => p.enabled === 'true') ? 'ok' : 'warn', 'Windows 방화벽', fw.profiles.map(p => `${FIREWALL_LABELS[p.name].replace(' 네트워크', '')} ${FIREWALL_STATE_LABELS[p.enabled]}`).join(' · ')) : kpcItem('unknown', 'Windows 방화벽', '확인 불가'),
        ev.status === 'ok' ? kpcItem('info', '최근 24시간 Windows 기록', ev.logs.map(l => (l.status === 'ok' ? `${l.name} 오류 ${l.errors}·경고 ${l.warnings}` : `${l.name} 확인 불가`)).join(' · ')) : kpcItem('unknown', '최근 24시간 Windows 기록', '확인 불가'),
      );
      inspect.append(text('p', 'Windows 경고·오류 건수는 침해나 공격 탐지 결과가 아닙니다. 자세한 내용은 「PC 점검」에서 봅니다.', 'kpc-note'));
    }
    box.append(core, attention, inspect);
    return box;
  }

  function statusView(result, tag) {
    const box = node('section', 'kpc-panel');
    box.append(text('h5', 'CPU·메모리·디스크'));
    if (!result) {
      box.append(text('p', pc.loading ? '조회 중…' : '아직 조회한 값이 없습니다. 「조회하기」를 누르세요.'));
      return node('div', 'kpc-main', box);
    }
    box.append(
      metricItem(tag, 'CPU 사용률', result.cpu, i => [`${i.percent} %`,
        `기준: 논리 코어 ${i.logicalCores}개 평균, 조회 중 ${i.windowMs / 1000}초 구간의 순간값(OS 보고 시간 기준)`, i.percent >= 90]),
      metricItem(tag, '메모리 사용량', result.memory, i => [`${i.usedPercent} % 사용 (사용 가능 ${i.availableGiB} GiB / 전체 ${i.totalGiB} GiB)`,
        '기준: 사용 중 = 전체 − 운영체제가 보고한 사용 가능 메모리', i.usedPercent >= 90]),
      metricItem(tag, '디스크 남은 공간', result.disk, i => [`${i.drive} 드라이브 ${i.freeGiB} GiB 남음 (전체 ${i.totalGiB} GiB 중 ${i.freePercent} %)`,
        `대상: ${i.drive} 한 곳(시스템 드라이브)만 조회, 다른 드라이브는 조회하지 않음`, i.freePercent < 10]),
      text('p', '주의 표시는 CPU·메모리 90% 이상, 디스크 남은 비율 10% 미만일 때 붙는 참고 기준입니다. 보안 판정이 아닙니다.', 'kpc-note'),
    );
    return node('div', 'kpc-main', box);
  }

  function compareView() {
    const box = node('section', 'kpc-panel kpc-stack');
    box.append(text('h5', '직전 조회와 비교'));
    const history = ensureHistory();
    const { previous, current } = pc;
    if (!pc.result || !current) {
      box.append(text('p', pc.loading ? '조회 중…' : '비교할 기록 부족: 이번 조회에서 비교에 쓸 숫자를 얻지 못했습니다.'));
    } else if (!previous) {
      box.append(text('p', '비교할 기록 부족: 직전 조회 기록이 없습니다. 한 번 더 조회하면 이번 값과 비교합니다.'));
    } else {
      box.append(text('p', `이전 조회값: ${formatLocal(previous.t)} · 이번 조회: ${formatLocal(current.t)} · 간격 ${formatElapsed(previous.t, current.t)}`, 'kpc-detail'));
      const ul = node('ul', 'kpc-list');
      const add = (name, prev, cur, unit, deltaUnit, threshold) => {
        ul.append(text('li', prev === null || cur === null ? `${name}: 비교할 기록 부족 (한쪽 값이 확인 불가였습니다)` : changeLine(name, prev, cur, unit, deltaUnit, threshold)));
      };
      add('CPU 사용률', previous.cpu, current.cpu, ' %', '%p', 1);
      add('메모리 사용률', previous.mem, current.mem, ' %', '%p', 1);
      add('디스크 남은 공간', previous.disk, current.disk, ' GiB', ' GiB', 0.5);
      box.append(ul, text('p', 'CPU는 1초 구간의 순간값이라 조회마다 크게 달라질 수 있습니다. 변화가 1%p(디스크는 0.5 GiB) 미만이면 "거의 같음"으로 적습니다. 원인을 판단한 것이 아니라 숫자 차이의 설명입니다.', 'kpc-note'));
    }
    box.append(text('p', `저장된 추이 기록: ${history.list.length}/${PC_HISTORY_MAX}회 (CPU·메모리·디스크 숫자와 측정 시각만, 이 브라우저에만 저장)`, 'kpc-strong'));
    if (!history.storage) box.append(text('p', '이 브라우저에서는 기록을 저장할 수 없습니다. 이번 화면을 닫으면 비교 기록이 사라집니다.', 'kpc-note'));
    const recent = history.list.slice(-5).reverse();
    if (recent.length > 0) {
      const f = (v, unit) => (v === null ? '확인 불가' : `${v}${unit}`);
      box.append(text('p', '최근 기록 (최대 5회):', 'kpc-strong'),
        node('ul', 'kpc-list', ...recent.map(e => text('li', `${formatLocal(e.t)} · CPU ${f(e.cpu, ' %')} · 메모리 ${f(e.mem, ' %')} · 디스크 남음 ${f(e.disk, ' GiB')}`))));
    }
    if (history.list.length > 0) {
      const actions = node('div', 'kpc-actions');
      if (pc.confirmClear) {
        box.append(text('p', `저장된 추이 기록 ${history.list.length}회를 모두 삭제할까요? 되돌릴 수 없습니다.`, 'kpc-strong'));
        const yes = text('button', '삭제 확인');
        yes.type = 'button';
        yes.id = 'pc-clear-confirm';
        yes.addEventListener('click', () => {
          const h = ensureHistory();
          h.list = [];
          h.storage = writeHistory([]);
          pc.previous = null;
          pc.current = null;
          pc.confirmClear = false;
          pc.focusId = 'pc-refresh';
          changed();
        });
        const no = text('button', '취소');
        no.type = 'button';
        no.id = 'pc-clear-cancel';
        no.addEventListener('click', () => { pc.confirmClear = false; pc.focusId = 'pc-clear-history'; changed(); });
        actions.append(yes, no);
      } else {
        const clear = text('button', '기록 삭제');
        clear.type = 'button';
        clear.id = 'pc-clear-history';
        clear.addEventListener('click', () => { pc.confirmClear = true; pc.focusId = 'pc-clear-confirm'; changed(); });
        actions.append(clear);
      }
      box.append(actions);
    }
    return node('div', 'kpc-main', box);
  }

  function inspectView(result, tag) {
    const box = node('section', 'kpc-panel');
    box.append(text('h5', '네트워크·방화벽·Windows 기록 (읽기 전용)'));
    if (!result) {
      box.append(text('p', pc.loading ? '조회 중…' : '아직 조회한 값이 없습니다.'));
      return node('div', 'kpc-main', box);
    }
    box.append(metricItem(tag, '네트워크 어댑터', result.network, i => [`총 ${i.adapterTotal}개 중 ${i.adapterUp}개 연결됨(Up)`,
      '가상 어댑터를 포함합니다. IP·MAC·SSID는 조회·표시·저장하지 않습니다', i.adapterTotal > 0 && i.adapterUp === 0]));
    if (result.network.status === 'ok') {
      const c = result.network.categories;
      box.append(kpcItem(c ? 'info' : 'unknown', '연결 범주', c ? `공용 ${c.public} · 개인 ${c.private} · 도메인 ${c.domain}` : '확인 불가 (범주를 읽지 못했습니다)'));
    }
    if (result.firewall.status !== 'ok') box.append(metricItem(tag, 'Windows 방화벽', result.firewall, () => ['', '', false]));
    else {
      for (const p of result.firewall.profiles) {
        box.append(kpcItem(p.enabled === 'true' ? 'ok' : 'warn', `방화벽 ${FIREWALL_LABELS[p.name]}`, `[${tag}] ${FIREWALL_STATE_LABELS[p.enabled]}${p.enabled === 'true' ? '' : ' — 주의'}`));
      }
      box.append(text('p', `켜짐·꺼짐 상태만 읽었고 방화벽 설정은 바꾸지 않았습니다 · 측정 시각 ${formatLocal(result.firewall.measuredAt)}`, 'kpc-note'));
    }
    if (result.events.status !== 'ok') box.append(metricItem(tag, '최근 24시간 Windows 기록', result.events, () => ['', '', false]));
    else {
      for (const log of result.events.logs) {
        if (log.status !== 'ok') box.append(metricItem(tag, `${log.name} 로그`, { status: 'unavailable', reason: log.reason, measuredAt: result.events.measuredAt }, () => ['', '', false]));
        else {
          const over = log.truncated ? ' 이상(조회 상한에 도달했습니다)' : '';
          box.append(kpcItem('info', `${log.name} 로그`, `[${tag}] 오류 ${log.errors}건 · 경고 ${log.warnings}건${over}${log.errors + log.warnings === 0 ? ' (해당 기간 기록 없음)' : ''}`));
        }
      }
      box.append(text('p', `조회 기간: 조회 시각 기준 최근 ${result.events.windowHours}시간 · 대상: System·Application 로그의 경고·오류 건수만(치명·정보 수준과 로그 내용은 읽지 않음) · 측정 시각 ${formatLocal(result.events.measuredAt)}`, 'kpc-note'));
    }
    box.append(text('p', 'Windows 경고·오류 건수는 침해나 공격 탐지 결과가 아닙니다.', 'kpc-strong'));
    return node('div', 'kpc-main', box);
  }

  function navigation() {
    const nav = node('nav', 'kpc-nav');
    nav.setAttribute('aria-label', 'PC 상태 메뉴');
    const list = node('ul', 'kpc-nav-list');
    for (const [id, label] of PC_VIEWS) {
      const button = text('button', label);
      button.type = 'button';
      button.id = `pc-nav-${id}`;
      if (pc.view === id) button.setAttribute('aria-current', 'page');
      button.addEventListener('click', () => { pc.view = id; pc.focusId = `pc-nav-${id}`; changed(); });
      list.append(node('li', '', button));
    }
    const theme = node('div', 'kpc-theme', text('p', '화면 테마', 'kpc-sub'));
    theme.setAttribute('role', 'group');
    theme.setAttribute('aria-label', '화면 테마');
    const choices = node('div', 'kpc-theme-list');
    for (const [id, label] of PC_THEME_CHOICES) {
      const button = text('button', label);
      button.type = 'button';
      button.id = `pc-theme-${id}`;
      button.setAttribute('aria-pressed', pc.theme === id ? 'true' : 'false');
      button.addEventListener('click', () => setTheme(id));
      choices.append(button);
    }
    theme.append(choices);
    nav.append(node('div', '', text('h4', '내 PC 상태'), text('p', '이 PC에서 직접 조회', 'kpc-sub')), list, theme);
    return nav;
  }

  return {
    render({ mode, diagnostics } = {}) {
      installPcStyle();
      watchSystemTheme();
      const active = typeof document !== 'undefined' ? document.activeElement : null;
      const keepFocus = pc.focusId ?? (active && /^pc-[a-z-]+$/.test(active.id) ? active.id : null);
      pc.focusId = null;
      if (!pc.started) {
        pc.started = true;
        queueMicrotask(load);
      }

      const result = pc.result;
      const stale = Boolean(result) && (pc.loading || pc.failed !== null);
      const tag = stale ? '이전 조회값' : '실측값';
      const ok = result ? ['cpu', 'memory', 'disk', 'network', 'firewall', 'events'].filter(k => result[k].status === 'ok').length : 0;

      const root = node('div', 'kpc');
      root.setAttribute('data-theme', effectiveTheme());
      root.setAttribute('role', 'region');
      root.setAttribute('aria-label', '내 PC 상태');

      let label;
      let stateKind;
      if (pc.loading) { label = '조회 중… (CPU는 1초 구간을 재므로 몇 초 걸립니다)'; stateKind = 'info'; }
      else if (pc.failed) { label = `조회 실패 (${pc.failed.message} · 코드 ${pc.failed.code})`; stateKind = 'unknown'; }
      else if (!result) { label = '아직 조회하지 않았습니다'; stateKind = 'info'; }
      else if (ok === PC_ITEM_COUNT) { label = `조회 성공 (${PC_ITEM_COUNT}개 항목 모두)`; stateKind = 'ok'; }
      else if (ok === 0) { label = `전체 확인 불가 (${PC_ITEM_COUNT}개 항목 모두 읽지 못했습니다)`; stateKind = 'unknown'; }
      else { label = `부분 성공 (${PC_ITEM_COUNT}개 중 ${ok}개 성공, ${PC_ITEM_COUNT - ok}개 확인 불가)`; stateKind = 'warn'; }
      const state = node('p', 'kpc-chip', badge(stateKind), text('span', 'PC 조회 상태: '), text('strong', label));
      state.setAttribute('role', 'status');

      const [sdpText, sdpWarn] = sdpState(mode, diagnostics);
      const sdp = node('p', 'kpc-chip', badge(sdpWarn ? 'unknown' : 'info'), text('span', 'SDP 연결 상태 (PC 조회와 별개): '), text('strong', sdpText));

      const refresh = text('button', pc.loading ? '조회 중…' : result || pc.failed ? '다시 조회' : '조회하기', 'kpc-primary');
      refresh.type = 'button';
      refresh.id = 'pc-refresh';
      if (pc.loading) {
        refresh.setAttribute('aria-disabled', 'true');
        refresh.setAttribute('aria-busy', 'true');
      }
      refresh.addEventListener('click', () => { if (!pc.loading) { pc.focusId = 'pc-refresh'; load(); } });

      const times = [];
      if (result) times.push(`마지막 성공 조회: ${formatLocal(result.finishedAt)}${stale ? ' (아래 값은 이 시각의 이전 조회값입니다)' : ''}`);
      else times.push('마지막 성공 조회: 없음');
      if (pc.attemptedAt && pc.failed) times.push(`마지막 시도: ${formatLocal(pc.attemptedAt)} — 실패한 시도는 새 결과로 쓰지 않았습니다.`);

      const title = text('h5', PC_VIEWS.find(([id]) => id === pc.view)[1]);
      title.id = 'pc-view-title';
      const head = node('section', 'kpc-panel kpc-head',
        node('div', 'kpc-head-row', title, refresh),
        node('div', 'kpc-chips', state, sdp),
        ...times.map(t => text('p', t, 'kpc-detail')));

      const body = pc.view === 'status' ? statusView(result, tag)
        : pc.view === 'compare' ? compareView()
          : pc.view === 'inspect' ? inspectView(result, tag) : overviewView(result, tag);
      const main = node('div', 'kpc-main', head, body, text('p', '이 패널의 값은 모두 이 PC에서 실제로 읽은 값입니다. 예시값이나 기본값으로 빈칸을 채우지 않으며, 읽지 못한 항목은 0이 아니라 확인 불가로 표시합니다.', 'kpc-note'));
      main.setAttribute('aria-labelledby', 'pc-view-title');

      root.append(node('div', 'kpc-shell', navigation(), main));

      if (keepFocus) {
        setTimeout(() => (document.getElementById(keepFocus) ?? document.getElementById('pc-refresh'))?.focus(), 0);
      }
      return root;
    },
  };
}

export function createStudentView({ api, onChange } = {}) {
  const pcDashboard = createPcDashboard({ api, onChange });
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
      root.append(pcDashboard.render({ mode, diagnostics }));

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
    // 호출마다 새 요소를 만들어 이전 표를 지운다. 조회 실패·미조회는 "취약점 없음"으로 보이지 않게 한다.
    renderVulnerabilities({ status, mode, data, error } = {}) {
      const root = document.createElement('div');
      root.className = 'student-vulnerabilities';
      const str = (v) => (typeof v === 'string' && v ? v : null);

      if (status === 'idle') {
        root.append(text('p', '조회 전: 설치 패키지 조회를 직접 실행하세요. 아직 취약점 여부를 확인하지 않았습니다.'));
        return root;
      }
      root.append(text('p', `자료 출처: ${modeLabel(mode)}`, 'identity-mode'));
      if (status === 'loading') {
        root.append(text('p', '조회 중: 결과가 아직 없습니다. 이전 결과는 표시하지 않습니다.'));
        return root;
      }
      if (status === 'error') {
        root.append(
          text('p', `조회 실패: ${str(error?.message) ?? '확인 불가'}`, 'identity-warn'),
          row('오류 코드', str(error?.code) ?? '확인 불가', true),
          text('p', '조회 실패는 취약점이 없다는 뜻이 아닙니다. 이전 결과를 현재 결과로 보지 않습니다. 다시 조회하려면 직접 실행하세요.'),
        );
        return root;
      }
      if (status !== 'ok' || data == null || typeof data !== 'object') {
        root.append(text('p', '확인 불가: 조회 상태를 알 수 없습니다. 취약점이 없다는 뜻이 아닙니다.', 'identity-warn'));
        return root;
      }

      const SCAN_LABELS = {
        complete: '모두 조회(complete)',
        partial: '일부 조회 실패(partial): 조회에 실패한 패키지는 취약점 없음이 아닙니다.',
        not_checked: '아직 조회 안 함(not_checked): 승인된 공개 조회 대상이 없어 조회하지 않았습니다.',
        not_configured: '조회 준비 미완료(not_configured): 조회 대상 프로젝트 설정이 필요합니다. 담당자가 준비합니다.',
        unverifiable: 'lock 파일 확인 불가(unverifiable)',
      };
      const scanKnown = typeof data.status === 'string' && Object.hasOwn(SCAN_LABELS, data.status);
      root.append(row('전체 조회 상태', scanKnown ? SCAN_LABELS[data.status] : `확인 불가(${str(data.status) ?? '값 없음'})`, data.status !== 'complete'));
      if (data.lockfileVersion !== undefined) root.append(row('lockfileVersion', String(data.lockfileVersion)));
      if (str(data.lockfileHash)) root.append(row('lockfileHash', data.lockfileHash));
      if (str(data.checkedAt)) root.append(row('조회 시각(checkedAt)', data.checkedAt));
      root.append(text('p', '이 결과는 package-lock.json과 설치된 node_modules의 정확한 버전을 OSV(알려진 취약점 데이터베이스)와 대조한 것입니다. 조회 범위에서 알려진 항목이 없다는 뜻이며 안전을 보장하지 않습니다.'));

      const packages = Array.isArray(data.packages) ? data.packages : [];
      if (packages.length === 0) {
        root.append(text('p', data.status === 'complete' ? '조회한 패키지가 없습니다.' : '표시할 패키지 조회 결과가 없습니다. 취약점이 없다는 뜻이 아닙니다.'));
        return root;
      }
      const PKG_LABELS = { known_vulnerabilities: '알려진 항목 있음', none_found: '알려진 항목 없음(조회 범위 기준)', unverifiable: '조회 확인 불가' };
      const list = document.createElement('ul');
      list.className = 'student-vulnerabilities-list';
      for (const pkg of packages) {
        const item = document.createElement('li');
        const name = str(pkg?.name) ?? '확인 불가';
        const version = str(pkg?.version) ?? '확인 불가';
        item.dataset.studentPackageName = name;
        item.dataset.studentPackageVersion = version;
        const vulns = Array.isArray(pkg?.vulnerabilities) ? pkg.vulnerabilities : [];
        const raw = str(pkg?.status);
        const partialIds = raw === 'unverifiable' && vulns.length > 0;
        const label = partialIds ? '일부 확인·전체 조회 확인 불가'
          : (raw && Object.hasOwn(PKG_LABELS, raw) ? PKG_LABELS[raw] : '확인 불가');
        item.append(
          text('strong', `${name}@${version}`),
          row('조회 결과', `${label} (${raw ?? '값 없음'})`, raw !== 'none_found'),
          row('출처', str(pkg?.source) ?? '확인 불가'),
          row('조회 시각', str(pkg?.checkedAt) ?? '확인 불가'),
        );
        if (vulns.length > 0) {
          const ids = document.createElement('ul');
          for (const v of vulns) ids.append(text('li', `${str(v?.id) ?? '확인 불가'} · modified: ${str(v?.modified) ?? '확인 불가'}`));
          item.append(ids);
        } else if (raw === 'unverifiable') {
          item.append(text('p', '조회에 실패했습니다. 취약점이 없다는 뜻이 아닙니다.', 'identity-warn'));
        }
        list.append(item);
      }
      root.append(list);
      return root;
    },
    // 호출마다 새 요소를 만들어 이전 점검 결과·오류 안내를 지운다. 자동 재점검은 없다.
    renderAiConnection({ status, mode, data, error, checkedAt } = {}) {
      const root = document.createElement('div');
      root.className = 'student-ai-connection';
      root.dataset.studentAiState = typeof status === 'string' ? status : 'unknown';

      if (status === 'idle') {
        root.append(text('p', 'AI 연결 점검 전'));
        root.append(text('p', '「현재 API 연결 점검」 버튼을 직접 눌러 점검하세요. 자동으로 점검하지 않습니다.'));
        return root;
      }
      root.append(text('p', `자료 출처: ${modeLabel(mode)}`, 'identity-mode'));

      if (status === 'loading') {
        root.append(text('p', 'AI 연결 점검 중'));
        root.append(text('p', '점검 중에는 「취소」를 누를 수 있습니다. 취소하면 늦게 도착한 응답은 표시하지 않습니다.'));
      } else if (status === 'error') {
        const code = typeof error?.code === 'string' && error.code ? error.code : '확인 불가';
        const message = typeof error?.message === 'string' && error.message ? error.message : '확인 불가';
        const known = Object.hasOwn(AI_ERROR_GROUPS, code) ? AI_ERROR_GROUPS[code] : AI_ERROR_GROUPS.AI_REQUEST_UNVERIFIED;
        root.append(
          text('p', `AI 연결 점검 실패 (${known.cause})`, 'identity-warn'),
          row('오류 코드', code, true),
          row('오류 메시지', message, true),
          text('p', `안내: ${known.guide}`),
          text('p', '사건 설명은 실행하지 않았거나 확인되지 않았습니다. 다시 점검하려면 「현재 API 연결 점검」 버튼을 직접 누르세요.'),
        );
      } else if (status === 'ok' && data != null) {
        const kind = data.audienceAuthorization;
        const label = kind === 'verified' ? '앱 권한 확인 후 점검(verified)'
          : kind === 'test' ? '시험 연결 점검(test)' : null;
        if (!label || !Number.isInteger(data.modelCount)) {
          root.append(text('p', '확인 불가: 점검 응답 형식을 확인할 수 없습니다. 연결 완료로 보지 않습니다.', 'identity-warn'));
          return root;
        }
        root.append(
          row('점검 종류', label),
          row('응답 모델 수', String(data.modelCount)),
          row('점검 시각', typeof checkedAt === 'string' && checkedAt ? checkedAt : '확인 불가'),
        );
        if (kind === 'test') root.append(text('p', '시험 연결입니다. 앱 권한을 확인한 결과가 아닙니다.', 'identity-warn'));
        if (mode === 'demo') root.append(text('p', '예제 자료(demo)입니다. 실제 연결 결과가 아닙니다.', 'identity-warn'));
        root.append(
          text('p', '연결과 모델 목록 응답만 점검했습니다. 사건 설명은 아직 실행하지 않았습니다.'),
          text('p', '사건 설명은 보안 기록에서 사건을 골라 따로 요청하고 확인하세요.'),
        );
      } else {
        root.append(text('p', '확인 불가: AI 연결 점검 상태를 알 수 없습니다. 연결 완료로 보지 않습니다.', 'identity-warn'));
      }
      return root;
    },
    // 성공한 설명에만 data-student-explanation-event 를 붙인다. 실패·대기에는 붙이지 않는다.
    renderExplanation({ event, explanation, checkedAt } = {}) {
      const root = document.createElement('div');
      root.className = 'student-explanation';
      const status = explanation?.status;
      const eventId = typeof event?.id === 'string' && event.id ? event.id : null;

      if (status === 'loading') {
        root.append(text('p', 'AI 설명 요청 중'));
      } else if (status === 'error') {
        const code = typeof explanation.error?.code === 'string' && explanation.error.code ? explanation.error.code : '확인 불가';
        const message = typeof explanation.error?.message === 'string' && explanation.error.message ? explanation.error.message : '확인 불가';
        root.append(
          text('p', 'AI 설명 실패: 설명을 받지 못했습니다', 'identity-warn'),
          row('오류 코드', code, true),
          row('오류 메시지', message, true),
          text('p', '기록은 그대로입니다. 설명 실패는 과제 실패가 아니며 업무 앱 판정과 기록 목록은 계속 동작합니다. 다시 요청하려면 보안 기록에서 직접 요청하세요.'),
        );
      } else if (status === 'ok' && !eventId) {
        root.append(text('p', '보안 기록에서 기록을 먼저 고르세요. 기록 없이는 AI 설명을 표시하지 않습니다.'));
      } else if (status === 'ok') {
        const data = explanation.data;
        const evidence = Array.isArray(event.evidence) ? event.evidence : [];
        const ids = Array.isArray(data?.evidenceIds) ? data.evidenceIds : null;
        const proposals = Array.isArray(data?.proposals) ? data.proposals : null;
        const cited = ids?.map((ref) => evidence.find((e) => e?.id === ref));
        const proposalCited = proposals?.every((p) => Array.isArray(p?.evidenceIds)
          && p.evidenceIds.every((ref) => evidence.some((e) => e?.id === ref)));
        if (typeof data?.summary !== 'string' || !data.summary || !ids || !proposals) {
          root.append(text('p', '확인 불가: 설명 형식이 계약과 달라 표시하지 않습니다.', 'identity-warn'));
          return root;
        }
        if (data.executed !== false || data.requiresHumanConfirmation !== true) {
          root.append(
            text('p', 'AI 설명을 쓸 수 없습니다: 조치가 이미 실행됐다고 답했거나 사람 확인 조건이 빠져 있습니다.', 'identity-warn'),
            text('p', '기록은 그대로 유지됩니다.'),
          );
          return root;
        }
        if (cited.some((e) => !e) || !proposalCited) {
          root.append(
            text('p', 'AI 설명을 쓸 수 없습니다: 인용한 근거 ID가 선택한 기록의 근거와 맞지 않습니다(근거 불일치).', 'identity-warn'),
            text('p', '기록은 그대로 유지됩니다. 없는 근거를 추측해 맞추지 않습니다.'),
          );
          return root;
        }

        // 모든 검사를 통과한 설명에만 성공 표식을 붙인다.
        root.dataset.studentExplanationEvent = eventId;
        const state = event.state ?? {};
        const unknownStates = [['access', '접속'], ['session', '세션'], ['device', '기기']]
          .filter(([key]) => state[key] === 'unknown');
        const rules = Array.isArray(event.rules) ? event.rules : [];
        const supported = Array.isArray(event.supportedActions) ? event.supportedActions : [];

        const evidenceList = document.createElement('ul');
        cited.forEach((e) => evidenceList.append(text('li', `${e.id} — ${e.text ?? ''}`)));
        if (cited.length === 0) evidenceList.append(text('li', '인용한 근거 없음'));
        const ruleList = document.createElement('ul');
        for (const r of rules) ruleList.append(text('li', `${r?.id ?? '확인 불가'} — ${r?.text ?? ''}`));
        if (rules.length === 0) ruleList.append(text('li', '규칙 없음'));
        const unknownList = document.createElement('ul');
        for (const [, label] of unknownStates) unknownList.append(text('li', `${label}: 확인 불가(unknown)`));
        if (unknownStates.length === 0) unknownList.append(text('li', '없음'));

        root.append(
          text('h4', 'AI 설명(참고용)'),
          row('사건 ID', eventId),
          row('AI 설명 요약', data.summary),
          row('설명 확인 시각', typeof checkedAt === 'string' && checkedAt ? checkedAt : '확인 불가'),
          text('p', 'AI 설명은 해석입니다. 사실 판단은 근거 글과 연동 시스템이 알려 준 상태로 하세요.'),
          text('h5', '인용한 근거'),
          evidenceList,
          text('h5', '적용 규칙'),
          ruleList,
          text('h5', '확인 불가 상태'),
          unknownList,
          text('h5', '조치 제안'),
        );
        if (proposals.length === 0) {
          root.append(text('p', supported.length === 0
            ? '연동 시스템이 지원하는 조치가 없어 제안이 없습니다(정상).'
            : 'AI가 이 기록에 대해 제안한 조치가 없습니다.'));
        } else {
          const list = document.createElement('ul');
          for (const p of proposals) {
            list.append(text('li', `${p.action} — ${p.reason ?? '이유 없음'} (근거 ${p.evidenceIds.join(', ') || '없음'}) · 사람 확인이 필요하며 실행되지 않았습니다.`));
          }
          root.append(list);
        }
        root.append(text('p', '설명과 제안만으로 보안 조치가 실행되지 않습니다.'));
      } else {
        root.append(text('p', eventId
          ? '사건을 선택해 AI 설명을 요청하면 여기에 표시됩니다. 연결 점검만으로는 설명이 실행되지 않습니다.'
          : '보안 기록에서 기록을 먼저 고르세요. 연결 점검만으로는 설명이 실행되지 않습니다.'));
      }
      return root;
    },
    // 호출마다 새 요소를 만들어 이전 대상·요청·결과를 지운다. 버튼·요청·확인 번호는 만들지 않는다.
    renderAction({ status, event, actionId, target, receipt, observation, message, confirmationExpiresAt, error } = {}) {
      const root = document.createElement('div');
      root.className = 'student-action';
      const str = (v) => (typeof v === 'string' && v ? v : null);
      const eventId = str(event?.id);
      const requestId = str(receipt?.requestId);
      root.dataset.studentActionState = str(status) ?? 'unknown';

      const known = ['idle', 'loading', 'prepared', 'executing', 'pending', 'succeeded', 'denied', 'failed', 'unknown', 'error', 'expired'];
      if (!known.includes(status)) {
        root.append(text('p', `확인 불가: 조치 상태를 알 수 없습니다(${str(status) ?? '값 없음'}). 성공으로 보지 않습니다.`, 'identity-warn'));
        return root;
      }
      if (status === 'idle') {
        root.append(
          text('p', '아직 미실행(idle): 조치 제안·확인·전달이 없었습니다.'),
          text('p', '조치 준비 버튼이 보이지 않는 것은 정상입니다. 현재 기록에는 연동 시스템이 지원하는 조치가 없어 실제 처리 경로가 열리지 않습니다.'),
        );
        return root;
      }

      // 효과 확인은 succeeded 이면서 observation.effectApplied === true 일 때만 인정한다.
      const effectConfirmed = status === 'succeeded' && observation?.effectApplied === true && str(observation.observedAt) !== null;
      const shown = status === 'succeeded' && !effectConfirmed ? 'unknown' : status;
      root.dataset.studentActionState = shown;

      const warn = shown !== 'prepared';
      switch (shown) {
        case 'loading':
          root.append(text('p', '조치 준비 또는 결과 조회 중(loading): 결과가 아직 없습니다.'));
          break;
        case 'prepared':
          root.append(text('p', '준비됨·미실행(prepared): 사람 확인 전이며 서버에 전달되지 않았습니다.'));
          break;
        case 'executing':
          root.append(text('p', '서버에 전달 중(executing): 결과가 아직 확인되지 않았습니다.', 'identity-warn'));
          break;
        case 'pending':
          root.append(
            text('p', '서버 접수·처리 중(pending): 결과가 아직 확인되지 않았습니다.', 'identity-warn'),
            text('p', '서버가 요청을 받았다는 응답(ACK)은 효과 확인이 아닙니다.'),
          );
          break;
        case 'succeeded':
          root.append(text('p', '효과 확인(succeeded): 연동 시스템이 효과를 관측했습니다.'));
          break;
        case 'denied':
          root.append(text('p', '거절(denied): 연동 시스템이 조치를 거절했습니다.', 'identity-warn'));
          break;
        case 'failed':
          root.append(text('p', '실패(failed): 연동 시스템이 조치를 처리하지 못했습니다.', 'identity-warn'));
          break;
        case 'expired':
          root.append(text('p', '확인 기한 지남(expired): 이번 준비로는 집행할 수 없습니다. 조치를 다시 준비하세요.', 'identity-warn'));
          break;
        case 'error':
          root.append(
            text('p', '요청 처리 안 됨(error): 조치가 처리되지 않았습니다.', 'identity-warn'),
            row('오류 코드', str(error?.code) ?? '확인 불가', true),
            row('오류 메시지', str(error?.message) ?? '확인 불가', true),
          );
          break;
        default:
          root.append(
            text('p', '결과 불명(unknown): 효과가 있었다고도 없었다고도 판단하지 마세요.', 'identity-warn'),
            text('p', status === 'succeeded'
              ? 'succeeded 응답이지만 효과 관측(effectApplied: true)이 없어 효과 확인으로 보지 않습니다.'
              : '제공 화면의 「연동 시스템 결과만 재조회」 버튼으로 결과만 다시 조회하세요. 같은 조치를 다시 전달하지 마세요.'),
          );
      }
      if (str(message) && shown !== 'error') root.append(row('안내', message, warn));

      if (eventId) root.dataset.studentActionEvent = eventId;
      if (requestId) root.dataset.studentActionRequest = requestId;

      if (eventId) root.append(row('사건 ID', eventId));
      const evidence = Array.isArray(event?.evidence) ? event.evidence.map((e) => str(e?.id)).filter(Boolean) : [];
      if (evidence.length > 0) root.append(row('근거 ID', evidence.join(', ')));
      if (str(actionId)) root.append(row('조치', actionId));
      if (str(target?.id)) root.append(row('실제 대상', target.id));
      if (Number.isInteger(target?.generation)) root.append(row('대상 세대(generation)', String(target.generation)));
      if (shown === 'prepared' && str(confirmationExpiresAt)) root.append(row('확인 기한', confirmationExpiresAt));
      if (requestId) root.append(row('requestId', requestId));
      if (str(receipt?.receiptId)) root.append(row('receiptId', receipt.receiptId));
      if (Number.isInteger(receipt?.version)) root.append(row('version', String(receipt.version)));
      if (effectConfirmed) {
        root.append(row('관측 시각', observation.observedAt), row('effectApplied', 'true'));
      }
      root.append(text('p', '조치 실행은 제공 화면의 버튼으로만 합니다. 이 영역은 상태만 보여 주며 어떤 요청도 보내지 않습니다.'));
      return root;
    },
  };
}
