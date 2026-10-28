// 서버 전용 PC 상태 조회 모듈입니다. 브라우저로 내려보내지 않고, src/server.mjs의 GET /api/pc-status만 부릅니다.
// 읽기 전용·일반 권한 조회만 합니다. 조회 항목과 명령은 아래에 고정돼 있고 요청 값으로 조합하지 않습니다.
// 이 모듈은 SDP 접속 판정이나 SDP 연결 상태와 무관합니다.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { statfs } from 'node:fs/promises';
import { cpus, freemem, totalmem } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CPU_WINDOW_MS = 1000;
export const EVENT_WINDOW_HOURS = 24;
// 클라이언트 요청 제한(10초)보다 짧게 끝낸다. 조회들은 동시에 시작한다.
const PROBE_TIMEOUT_MS = Object.freeze({ network: 6000, firewall: 6000, events: 8000 });
const MAX_OUTPUT_BYTES = 8192;
const PROBE_SCRIPT = fileURLToPath(new URL('./pc-probe.ps1', import.meta.url));
// 자식 프로세스에는 이 목록의 환경변수만 넘긴다. 토큰·비밀번호·열쇠류는 목록에 없다.
const CHILD_ENV_NAMES = ['SystemRoot', 'windir', 'SystemDrive', 'PATH', 'PATHEXT', 'PSModulePath', 'TEMP', 'TMP',
  'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'ProgramData', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432',
  'PROCESSOR_ARCHITECTURE', 'NUMBER_OF_PROCESSORS', 'OS', 'COMPUTERNAME', 'USERNAME', 'USERDOMAIN'];
const REASONS = new Set(['timeout', 'access_denied', 'policy_blocked', 'powershell_missing', 'unsupported_platform',
  'not_supported', 'output_invalid', 'output_too_large', 'no_sample', 'failed']);
const FIREWALL_NAMES = ['Domain', 'Private', 'Public'];
const FIREWALL_STATES = ['true', 'false', 'notconfigured'];
const LOG_NAMES = ['System', 'Application'];

const unavailable = (reason, now) => ({ status: 'unavailable', reason: REASONS.has(reason) ? reason : 'failed', measuredAt: now().toISOString() });
const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;
const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000;
const asArray = value => (Array.isArray(value) ? value : value == null ? [] : [value]);
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function childEnvironment(env) {
  const wanted = new Set(CHILD_ENV_NAMES.map(name => name.toLowerCase()));
  const out = {};
  for (const [name, value] of Object.entries(env)) if (wanted.has(name.toLowerCase()) && typeof value === 'string') out[name] = value;
  return out;
}

// 고정 스크립트를 셸 없이 실행한다. -ExecutionPolicy는 지정하지 않으므로 PC의 정책이 막으면 그대로 policy_blocked로 보고한다.
function runPowerShellProbe(section, { env, platform }) {
  return new Promise(resolve => {
    if (platform !== 'win32') return resolve({ ok: false, reason: 'unsupported_platform' });
    const root = typeof env.SystemRoot === 'string' && /^[A-Za-z]:\\[^"\0]*$/.test(env.SystemRoot) ? env.SystemRoot : 'C:\\Windows';
    const exe = join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    if (!existsSync(exe)) return resolve({ ok: false, reason: 'powershell_missing' });
    const child = execFile(exe, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', PROBE_SCRIPT, '-Section', section], {
      shell: false, windowsHide: true, encoding: 'utf8', timeout: PROBE_TIMEOUT_MS[section], maxBuffer: MAX_OUTPUT_BYTES,
      env: childEnvironment(env),
    }, (error, stdout, stderr) => {
      if (error) {
        if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return resolve({ ok: false, reason: 'output_too_large' });
        if (error.killed) return resolve({ ok: false, reason: 'timeout' });
        // 오류 원문은 판단에만 쓰고 응답·로그에 남기지 않는다.
        if (/UnauthorizedAccess|PSSecurityException/i.test(String(stderr))) return resolve({ ok: false, reason: 'policy_blocked' });
        return resolve({ ok: false, reason: 'failed' });
      }
      try { resolve({ ok: true, value: JSON.parse(stdout) }); } catch { resolve({ ok: false, reason: 'output_invalid' }); }
    });
    child.stdin?.end();
  });
}

// 스크립트 출력은 믿지 않고, 정해진 필드와 값만 새 객체로 옮긴다.
function cleanNetwork(raw) {
  if (!isRecord(raw) || !count(raw.adapterTotal) || !count(raw.adapterUp) || raw.adapterUp > raw.adapterTotal) return null;
  const c = raw.categories;
  const categories = isRecord(c) && count(c.public) && count(c.private) && count(c.domain)
    ? { public: c.public, private: c.private, domain: c.domain } : null;
  return { adapterTotal: raw.adapterTotal, adapterUp: raw.adapterUp, categories };
}

function cleanFirewall(raw) {
  if (!isRecord(raw)) return null;
  const profiles = [];
  for (const row of asArray(raw.profiles)) {
    if (!isRecord(row) || !FIREWALL_NAMES.includes(row.name) || !FIREWALL_STATES.includes(row.enabled)) return null;
    profiles.push({ name: row.name, enabled: row.enabled });
  }
  return profiles.length === 0 ? null : { profiles };
}

function cleanEvents(raw) {
  if (!isRecord(raw) || raw.windowHours !== EVENT_WINDOW_HOURS) return null;
  const logs = [];
  for (const row of asArray(raw.logs)) {
    if (!isRecord(row) || !LOG_NAMES.includes(row.name)) return null;
    if (row.status === 'ok' && count(row.errors) && count(row.warnings)) {
      logs.push({ name: row.name, status: 'ok', errors: row.errors, warnings: row.warnings, truncated: row.truncated === true });
    } else if (row.status === 'unavailable') {
      logs.push({ name: row.name, status: 'unavailable', reason: REASONS.has(row.reason) ? row.reason : 'failed' });
    } else return null;
  }
  return LOG_NAMES.every(name => logs.some(log => log.name === name)) && logs.length === LOG_NAMES.length
    ? { windowHours: EVENT_WINDOW_HOURS, logs } : null;
}

const CLEANERS = Object.freeze({ network: cleanNetwork, firewall: cleanFirewall, events: cleanEvents });

export function createPcStatusReader({
  now = () => new Date(),
  env = process.env,
  platform = process.platform,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  readCpuTimes = cpus,
  readTotalMemory = totalmem,
  readFreeMemory = freemem,
  readDiskSpace = statfs,
  probe = section => runPowerShellProbe(section, { env, platform }),
} = {}) {
  async function readCpu() {
    const before = readCpuTimes();
    await sleep(CPU_WINDOW_MS);
    const after = readCpuTimes();
    if (!Array.isArray(before) || !Array.isArray(after) || before.length === 0 || before.length !== after.length) return unavailable('no_sample', now);
    let idle = 0;
    let total = 0;
    for (let i = 0; i < after.length; i++) {
      const a = after[i].times;
      const b = before[i].times;
      for (const key of Object.keys(a)) total += a[key] - (b[key] ?? 0);
      idle += a.idle - b.idle;
    }
    if (!(total > 0) || !Number.isFinite(total) || idle < 0) return unavailable('no_sample', now);
    const percent = round(Math.min(100, Math.max(0, (1 - idle / total) * 100)), 1);
    return { status: 'ok', percent, unit: '%', windowMs: CPU_WINDOW_MS, logicalCores: after.length, measuredAt: now().toISOString() };
  }

  function readMemory() {
    const total = readTotalMemory();
    const available = readFreeMemory();
    if (!(total > 0) || !(available >= 0) || available > total) return unavailable('failed', now);
    const gib = 1024 ** 3;
    return {
      status: 'ok', usedPercent: round(((total - available) / total) * 100, 1), unit: 'GiB',
      totalGiB: round(total / gib, 1), availableGiB: round(available / gib, 1), measuredAt: now().toISOString(),
    };
  }

  async function readDisk() {
    const drive = platform === 'win32'
      ? (/^[A-Za-z]:$/.test(env.SystemDrive ?? '') ? env.SystemDrive.toUpperCase() : 'C:') : '/';
    try {
      const stats = await readDiskSpace(platform === 'win32' ? `${drive}\\` : drive);
      const total = Number(stats.blocks) * Number(stats.bsize);
      const free = Number(stats.bavail) * Number(stats.bsize);
      if (!(total > 0) || !(free >= 0) || free > total) return unavailable('failed', now);
      const gib = 1024 ** 3;
      return {
        status: 'ok', drive, unit: 'GiB', freeGiB: round(free / gib, 1), totalGiB: round(total / gib, 1),
        freePercent: round((free / total) * 100, 1), measuredAt: now().toISOString(),
      };
    } catch (error) {
      return unavailable(error?.code === 'EACCES' || error?.code === 'EPERM' ? 'access_denied' : 'failed', now);
    }
  }

  async function readProbe(section) {
    let result;
    try { result = await probe(section); } catch { return unavailable('failed', now); }
    if (!result?.ok) return unavailable(result?.reason, now);
    const raw = result.value;
    if (!isRecord(raw)) return unavailable('output_invalid', now);
    if (raw.status === 'unavailable') return unavailable(raw.reason, now);
    const clean = raw.status === 'ok' ? CLEANERS[section](raw) : null;
    return clean ? { status: 'ok', ...clean, measuredAt: now().toISOString() } : unavailable('output_invalid', now);
  }

  const safely = work => Promise.resolve().then(work).catch(() => unavailable('failed', now));
  async function readOnce() {
    const startedAt = now().toISOString();
    const [cpu, memory, disk, network, firewall, events] = await Promise.all([
      safely(readCpu), safely(readMemory), safely(readDisk),
      safely(() => readProbe('network')), safely(() => readProbe('firewall')), safely(() => readProbe('events')),
    ]);
    return { startedAt, finishedAt: now().toISOString(), platform, cpu, memory, disk, network, firewall, events };
  }

  // 조회가 진행 중이면 새로 시작하지 않고 같은 결과를 기다린다(중복 실행 방지).
  let inflight = null;
  return Object.freeze({
    read() {
      if (!inflight) inflight = readOnce().finally(() => { inflight = null; });
      return inflight;
    },
  });
}
