import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { startLocalServer } from './local-server.mjs';

// 12단계 검증 절차: 실제 API 요청을 보내고 결과를 한 표로 남깁니다.
//  실행: npm run ops:verify            (이 저장소의 api/*.mjs를 로컬 서버로 띄워 실제 Supabase에 접속)
//        OPS_BASE_URL=https://... npm run ops:verify   (이미 배포된 서버를 대상으로)
// 규칙: 실제로 보낸 요청의 응답만 "executed"로 적습니다. 계정·패스키가 필요해 보내지 못한 항목은
// "not_run"(사유 포함), 사람의 브라우저 조작이 필요한 항목은 "manual_pending"입니다. 함수 단위
// 점검은 kind가 local_function이며 실제 API 결과와 구분합니다. 토큰·비밀번호·본문은 기록하지 않습니다.
const root = resolve(import.meta.dirname, '..');
const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true }).trim();
const rows = [];
let order = 0;

function add(row) {
  rows.push({ order: (order += 1), checkedAt: new Date().toISOString(), requestId: null, platformId: null,
    actualStatus: null, actualCode: null, ...row });
}
const matches = (expected, actual) => expected.status === actual.status
  && (expected.code === undefined || expected.code === actual.code);

async function http(base, method, path, { token, deviceSession, body } = {}) {
  const headers = { accept: 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (deviceSession) headers['x-device-session'] = deviceSession;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(new URL(path, base), { method, headers, redirect: 'manual',
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  let json = null;
  try { json = await response.json(); } catch { /* JSON이 아닌 응답 */ }
  return { status: response.status, json, requestId: response.headers.get('x-request-id'),
    platformId: response.headers.get('x-vercel-id') };
}

// 실제 요청 한 건을 보내고 표에 한 줄을 남깁니다.
async function api(base, spec) {
  const { testId, stage, kind, title, method, path, auth, expected, condition, ...options } = spec;
  try {
    const result = await http(base, method, path, options);
    const actual = { status: result.status, code: result.json?.error ?? null };
    add({ testId, stage, kind, title, request: `${method} ${path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/giu, ':id')}`,
      condition, expected: describeExpected(expected), state: 'executed', actualStatus: actual.status,
      actualCode: actual.code, requestId: result.requestId, platformId: result.platformId,
      match: matches(expected, actual) });
    return result;
  } catch (error) {
    add({ testId, stage, kind, title, request: `${method} ${path}`, condition, expected: describeExpected(expected),
      state: 'failed', reason: `요청 실패: ${String(error.message).slice(0, 80)}`, match: false });
    return null;
  }
}
const describeExpected = e => `HTTP ${e.status}${e.code ? ` ${e.code}` : ''}`;
const notRun = (testId, stage, kind, title, reason, extra = {}) =>
  add({ testId, stage, kind, title, state: 'not_run', reason, match: null, ...extra });
const manual = (testId, stage, kind, title, expected, condition) =>
  add({ testId, stage, kind, title, condition, expected, state: 'manual_pending',
    reason: '승인된 기기의 패스키 확인(브라우저)이 필요합니다. docs/OPS_VERIFY.md 순서대로 실행합니다.', match: null });

// ---- 정적 점검: 가산 조건(판정기 계약, step) ----
async function staticChecks() {
  const config = JSON.parse(readFileSync(join(root, 'aleph.config.json'), 'utf8'));
  add({ testId: 'B-3', stage: 12, kind: 'local_file', title: 'aleph.config.json의 step이 12 이상', expected: 'step >= 12',
    state: 'executed', actualStatus: null, actualCode: `step=${config.step}`, match: config.step >= 12 });

  const contract = readFileSync(join(root, 'docs', 'DECIDER_REQUEST.md'), 'utf8');
  const names = new Set([...contract.matchAll(/^\|\s*((?:`[A-Za-z0-9]+`(?:,\s*)?)+)\s*\|/gmu)]
    .flatMap(m => [...m[1].matchAll(/`([A-Za-z0-9]+)`/gu)].map(x => x[1])));
  const source = readFileSync(join(root, 'src', 'decider.mjs'), 'utf8').replace(/^\s*\/\/.*$/gmu, '');
  const used = new Set([...source.matchAll(/\brequest\.([A-Za-z_]+)/gu)].map(m => m[1]));
  for (const m of source.matchAll(/const\s*\{([^}]+)\}\s*=\s*request\s*;/gu)) {
    for (const part of m[1].split(',')) used.add(part.trim().split(':')[0].trim());
  }
  const outside = [...used].filter(name => !names.has(name));
  add({ testId: 'B-2a', stage: 12, kind: 'local_file', title: 'src/decider.mjs가 계약의 요청 이름만 읽음',
    expected: '계약 밖 이름 0개', state: 'executed', actualCode: `계약 ${names.size}개 중 ${used.size}개 사용, 계약 밖: ${outside.join(',') || '없음'}`,
    match: names.size === 18 && outside.length === 0 });

  const { decide, RULE_IDS } = await import(pathToFileURL(join(root, 'src', 'decider.mjs')).href);
  const base = { schema: 'aleph.decision.v1', requestId: randomUUID(), classId: 'c', projectId: 'p', subjectId: 'u_0123456789abcdef',
    deviceId: '0123456789abcdef', service: 'notes', method: 'GET', path: '/notes/abc', route: 'GET /notes/:id',
    queryLength: 0, querySha256: '0'.repeat(64), at: new Date().toISOString(), policyRevision: 1, deviceRegistered: true,
    stepUp: { verified: false, authAgeSeconds: null }, recentEvents: [],
    signals: { source: 'none', region: 'unknown', network: 'unknown', hour: 12 } };
  const routes = [['notes', 'GET /notes/:id', '/notes/abc'], ['notes', 'PUT /notes/:id', '/notes/abc'],
    ['notes', 'GET /notes', '/notes'], ['announcements', 'PUT /announcements/:id', '/announcements/a1'],
    ['notes', 'DELETE /notes/:id', '/notes/abc'], ['notes', 'GET /notes/:id', '/notes/../admin'],
    ['notes', 'GET /notes/:id', '/notes/export'], ['admin', 'GET /admin', '/admin'], ['notes', 'GET /notes/:id', '/notes/a/b'],
    ['notes', 'POST /notes', '/notes'], ['', '', ''], ['notes', 'GET /notes/:id', '/zone/other-user-note']];
  const methods = ['GET', 'PUT', 'POST', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];
  const conditions = [
    {}, { deviceRegistered: false }, { deviceRegistered: undefined }, { subjectId: '' }, { queryLength: 5 },
    { stepUp: { verified: true, authAgeSeconds: 60 } }, { stepUp: { verified: true, authAgeSeconds: 901 } },
    { signals: { source: 'judge_fixture', region: 'foreign', network: 'unusual', hour: 3 } },
    { signals: { source: 'judge_fixture', region: 'local', network: 'unusual', hour: 3 },
      recentEvents: [{ kind: 'risk_signal', ageSeconds: 30, count: 20 }] },
    { signals: { source: 'judge_fixture', region: 'local', network: 'unusual', hour: 3 },
      recentEvents: [{ kind: 'risk_signal', ageSeconds: 30, count: 20 }], stepUp: { verified: true, authAgeSeconds: 10 } },
    { recentEvents: 'x' }, { signals: null },
  ];
  let total = 0;
  let bad = 0;
  const KEYS = 'decision,reasonCode,requestId,ruleIds,schema';
  for (const method of methods) for (const [service, route, path] of routes) for (const cond of conditions) {
    const request = { ...base, requestId: randomUUID(), method, service, route, path, ...cond };
    total += 1;
    let out;
    try { out = await decide(request); } catch { bad += 1; continue; }
    const ok = out && Object.keys(out).sort().join(',') === KEYS && out.schema === 'aleph.decision.v1'
      && out.requestId === request.requestId && ['allow', 'deny', 'step_up'].includes(out.decision)
      && /^[a-z][a-z0-9_]{0,63}$/u.test(out.reasonCode) && Array.isArray(out.ruleIds) && out.ruleIds.length > 0
      && out.ruleIds.every(id => RULE_IDS.includes(id));
    if (!ok) bad += 1;
  }
  add({ testId: 'B-2b', stage: 12, kind: 'local_function', title: '가상 요청 전부에 형식이 맞는 응답, ruleIds ⊂ RULE_IDS',
    expected: '불일치 0건', state: 'executed', actualCode: `가상 요청 ${total}건 중 불일치 ${bad}건`, match: bad === 0 });

  // 구역 밖 조회: 판정기 함수 단위(실제 API 결과가 아님)
  const zone = async (title, patch, decision) => {
    const out = await decide({ ...base, requestId: randomUUID(), ...patch });
    add({ testId: `Z-${rows.length}`, stage: 8, kind: 'local_function', title, expected: decision, state: 'executed',
      actualCode: `${out.decision}/${out.reasonCode}`, match: out.decision === decision });
  };
  await zone('구역 안 본인 메모 한 건 조회(등록 기기)', {}, 'allow');
  await zone('구역 밖: 메모 전체 목록', { route: 'GET /notes', path: '/notes' }, 'deny');
  await zone('구역 밖: 강사 공지 수정', { service: 'announcements', method: 'PUT', route: 'PUT /announcements/:id', path: '/announcements/a1' }, 'deny');
  await zone('구역 밖: 경로 거슬러 올라가기', { path: '/notes/../admin' }, 'deny');
}

// ---- 실제 API 시험 ----
function jwtSubject(token) {
  try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).sub ?? null; } catch { return null; }
}
async function login(base, email, password) {
  if (!email || !password) return { token: null, reason: '계정 환경변수(USERnn_EMAIL/PASSWORD) 없음' };
  const r = await http(base, 'POST', '/api/auth/login', { body: { email, password } });
  return r.status === 200 && r.json?.accessToken ? { token: r.json.accessToken, requestId: r.requestId, platformId: r.platformId }
    : { token: null, reason: `로그인 응답 HTTP ${r.status}` };
}

async function apiChecks(base) {
  const noId = randomUUID(); // 존재하지 않는 메모 ID(자료를 건드리지 않음)
  const A = 'USER01'; const B = 'USER02';
  // 1) 무인증 조회 → 타인 메모 조회 (1첩반상)
  await api(base, { testId: 'F1-1', stage: 3, kind: 'forbidden', title: '무인증으로 내 메모 목록', method: 'GET',
    path: '/api/my-notes', condition: 'Authorization 없음', expected: { status: 401, code: 'unauthorized' } });
  await api(base, { testId: 'F1-2', stage: 4, kind: 'forbidden', title: '무인증으로 메모 한 건 조회', method: 'GET',
    path: `/api/my-notes/${noId}`, condition: 'Authorization 없음', expected: { status: 401, code: 'unauthorized' } });
  await api(base, { testId: 'F1-3', stage: 2, kind: 'forbidden', title: '무인증으로 공용 자료', method: 'GET',
    path: '/api/notes', condition: 'Authorization 없음', expected: { status: 401, code: 'unauthorized' } });
  await api(base, { testId: 'F1-4', stage: 3, kind: 'forbidden', title: '만든 토큰 모양의 가짜 로그인 값', method: 'GET',
    path: '/api/my-notes', token: 'aaaa.bbbb.cccc', condition: 'Bearer 가짜 JWT 모양', expected: { status: 401, code: 'unauthorized' } });

  const a = await login(base, process.env[`${A}_EMAIL`], process.env[`${A}_PASSWORD`]);
  const b = await login(base, process.env[`${B}_EMAIL`], process.env[`${B}_PASSWORD`]);
  add({ testId: 'F1-5', stage: 3, kind: 'normal', title: `${A} 정상 로그인`, request: 'POST /api/auth/login',
    condition: '본인 계정(값은 기록하지 않음)', expected: 'HTTP 200 + 토큰', state: a.token ? 'executed' : 'not_run',
    actualStatus: a.token ? 200 : null, requestId: a.requestId ?? null, platformId: a.platformId ?? null,
    reason: a.token ? undefined : a.reason, match: a.token ? true : null });
  add({ testId: 'F1-6', stage: 3, kind: 'normal', title: `${B} 정상 로그인`, request: 'POST /api/auth/login',
    condition: '본인 계정(값은 기록하지 않음)', expected: 'HTTP 200 + 토큰', state: b.token ? 'executed' : 'not_run',
    actualStatus: b.token ? 200 : null, requestId: b.requestId ?? null, platformId: b.platformId ?? null,
    reason: b.token ? undefined : b.reason, match: b.token ? true : null });

  // 타인 메모 ID 확보: 서버 전용 키로 ID만 조회(본문은 읽지 않음)
  let otherNoteId = null;
  let lookupReason = '서버 전용 키(SUPABASE_URL·SUPABASE_SECRET_KEY) 없음';
  const subA = a.token ? jwtSubject(a.token) : null;
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY && subA) {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } });
    const { data, error } = await supabase.from('t03_personal_notes').select('id').eq('owner_id', subA).limit(1);
    if (!error && data?.length) otherNoteId = data[0].id;
    else lookupReason = error ? '메모 ID 조회 실패' : `${A} 소유 메모가 없음`;
  }

  if (b.token && otherNoteId) {
    await api(base, { testId: 'F1-7', stage: 8, kind: 'forbidden', title: `${B}가 ${A}의 메모 한 건 조회(기기 확인 결과 없음)`,
      method: 'GET', path: `/api/my-notes/${otherNoteId}`, token: b.token,
      condition: `${B} 로그인, X-Device-Session 없음`, expected: { status: 403, code: 'device_not_registered' } });
  } else notRun('F1-7', 8, 'forbidden', `${B}가 ${A}의 메모 한 건 조회(기기 확인 결과 없음)`,
    b.token ? lookupReason : (b.reason ?? '로그인 실패'));
  manual('F1-8', 8, 'forbidden', `승인된 ${B} 기기로 ${A}의 메모 한 건 조회`, 'HTTP 404 (존재 여부 비공개)',
    `${B} 로그인 + 승인된 기기 확인 결과`);
  manual('F1-9', 8, 'normal', `승인된 ${A} 기기로 본인 메모 한 건 조회`, 'HTTP 200', `${A} 로그인 + 승인된 기기 확인 결과`);

  // 2) 미등록 기기 → 회수된 신원
  if (a.token) {
    await api(base, { testId: 'F2-1', stage: 11, kind: 'forbidden', title: '미등록 기기(기기 확인 결과 없음)로 공용 자료', method: 'GET',
      path: '/api/notes', token: a.token, condition: `${A} 로그인, X-Device-Session 없음`,
      expected: { status: 403, code: 'device_not_registered' } });
    await api(base, { testId: 'F2-2', stage: 11, kind: 'forbidden', title: '지어낸 기기 확인 결과로 내 메모 목록', method: 'GET',
      path: '/api/my-notes', token: a.token, deviceSession: 'made-up.value', condition: `${A} 로그인, 위조한 X-Device-Session`,
      expected: { status: 403, code: 'device_not_registered' } });
    await api(base, { testId: 'F2-3', stage: 11, kind: 'normal', title: '로그인한 사용자의 기기 등록부·질문 조회', method: 'GET',
      path: '/api/device/challenge', token: a.token, condition: `${A} 로그인(기기 확인 불필요)`, expected: { status: 200 } });
    await api(base, { testId: 'F2-4', stage: 12, kind: 'forbidden', title: '기기 확인 없이 탈환 작전실 조회', method: 'GET',
      path: '/api/ops/summary', token: a.token, condition: `${A} 로그인, X-Device-Session 없음`,
      expected: { status: 403, code: 'device_not_registered' } });
  } else {
    for (const [id, st, kind, title] of [['F2-1', 11, 'forbidden', '미등록 기기로 공용 자료'], ['F2-2', 11, 'forbidden', '위조 기기 확인 결과'],
      ['F2-3', 11, 'normal', '기기 질문 조회'], ['F2-4', 12, 'forbidden', '기기 확인 없이 작전실']]) {
      notRun(id, st, kind, title, a.reason ?? '로그인 실패');
    }
  }
  manual('F2-5', 12, 'forbidden', '회수된 신원으로 승인된 기기·유효한 확인 결과를 가지고 보호 API 재요청',
    'HTTP 403 identity_revoked (공용 자료·내 메모·복원·작전실 모두)', '관리자가 t12_revoked_identities에 회수 행을 추가한 뒤');
  manual('F2-6', 12, 'normal', '회수되지 않은 다른 계정의 정상 요청(같은 시각)', 'HTTP 200', '회수 대상이 아닌 계정 + 승인된 기기');
  manual('F2-7', 12, 'normal', '복권 뒤 같은 계정의 정상 요청', 'HTTP 200', 'restored_at을 채운 뒤');

  // 3) 복구 → 서명 없는 변경 → 구역 밖 조회
  await api(base, { testId: 'F3-1', stage: 10, kind: 'forbidden', title: '무인증 복원 미리보기', method: 'GET',
    path: `/api/note-restore/${noId}`, condition: 'Authorization 없음', expected: { status: 401, code: 'unauthorized' } });
  await api(base, { testId: 'F3-2', stage: 10, kind: 'forbidden', title: '무인증 복원 실행', method: 'POST',
    path: `/api/note-restore/${noId}`, condition: 'Authorization 없음', expected: { status: 401, code: 'unauthorized' } });
  await api(base, { testId: 'F3-3', stage: 4, kind: 'forbidden', title: '서명(로그인·기기 확인) 없는 메모 수정', method: 'PUT',
    path: `/api/my-notes/${noId}`, body: { title: 'x', body: 'x' }, condition: 'Authorization·X-Device-Session 없음',
    expected: { status: 401, code: 'unauthorized' } });
  await api(base, { testId: 'F3-4', stage: 4, kind: 'forbidden', title: '서명 없는 메모 삭제', method: 'DELETE',
    path: `/api/my-notes/${noId}`, condition: 'Authorization 없음', expected: { status: 401, code: 'unauthorized' } });
  if (a.token) {
    await api(base, { testId: 'F3-5', stage: 11, kind: 'forbidden', title: '기기 확인 결과 없는 복원 실행', method: 'POST',
      path: `/api/note-restore/${noId}`, token: a.token, condition: `${A} 로그인, X-Device-Session 없음`,
      expected: { status: 403, code: 'device_not_registered' } });
    await api(base, { testId: 'F3-6', stage: 11, kind: 'forbidden', title: '기기 확인 결과 없는 메모 수정', method: 'PUT',
      path: `/api/my-notes/${noId}`, token: a.token, body: { title: 'x', body: 'x' }, condition: `${A} 로그인, X-Device-Session 없음`,
      expected: { status: 403, code: 'device_not_registered' } });
    await api(base, { testId: 'F3-7', stage: 11, kind: 'forbidden', title: '기기 확인 결과 없는 메모 삭제', method: 'DELETE',
      path: `/api/my-notes/${noId}`, token: a.token, condition: `${A} 로그인, X-Device-Session 없음`,
      expected: { status: 403, code: 'device_not_registered' } });
  } else {
    for (const id of ['F3-5', 'F3-6', 'F3-7']) notRun(id, 11, 'forbidden', '기기 확인 결과 없는 변경 요청', a.reason ?? '로그인 실패');
  }
  manual('F3-8', 10, 'normal', '승인된 기기로 본인 메모 복원(미리보기 → 실행)', '미리보기 200, 실행 200, 감사 기록 1줄',
    '시험용 메모를 직접 수정한 뒤');
  manual('F3-9', 10, 'forbidden', '복원 뒤 다른 사용자의 메모를 복원 경로로 요청', 'HTTP 404 또는 거부(소유자 불일치)',
    '승인된 기기 + 타인 메모 ID');
  manual('F3-10', 8, 'forbidden', '복원 뒤 구역 밖(타인) 메모 한 건 조회', 'HTTP 404', '승인된 기기 + 타인 메모 ID');
  manual('F3-11', 12, 'normal', '복원 뒤 탈환 작전실이 복구 버전·결과를 보여 줌', '화면 값과 요청 ID가 서버 기록과 일치',
    '승인된 기기 + 작전실 화면');
  rows.push(); // (표 순서 유지)
  return { a, b };
}

// ---- 실행 ----
const commit = git('rev-parse', 'HEAD');
const dirty = git('status', '--porcelain', '--untracked-files=all').split(/\r?\n/u).filter(Boolean);
let base = process.env.OPS_BASE_URL;
let local = null;
let targetKind = 'deployed';
const meta = { commit, uncommittedFiles: dirty.length, runAt: new Date().toISOString(), node: process.version };
if (!base) {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY) {
    local = await startLocalServer();
    base = local.baseUrl;
    targetKind = 'local_server_real_supabase';
  } else {
    targetKind = 'none';
  }
}
meta.target = base ?? '(없음)';
meta.targetKind = targetKind;

await staticChecks();
if (base) {
  await apiChecks(base);
} else {
  notRun('API-ALL', 0, 'normal', '실제 API 시험 전체', '대상 서버 없음: OPS_BASE_URL 또는 .env의 SUPABASE_URL·SUPABASE_SECRET_KEY(서버 전용 키)가 필요합니다');
}
if (local) local.server.close();

const summary = rows.reduce((acc, row) => {
  acc[row.state] = (acc[row.state] ?? 0) + 1;
  if (row.state === 'executed') acc[row.match ? 'executed_match' : 'executed_mismatch'] = (acc[row.match ? 'executed_match' : 'executed_mismatch'] ?? 0) + 1;
  return acc;
}, {});
const output = { schema: 'aleph.ops.verify.v1', meta, summary,
  official41: { state: 'not_available', reason: '41종 시험 목록과 실행 도구를 저장소·docs·제공 자료에서 찾지 못했습니다. 임의로 만들거나 통과 처리하지 않습니다.' },
  rows };
const dir = join(root, 'artifacts');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'ops-verify.json'), `${JSON.stringify(output, null, 2)}\n`, 'utf8');

const label = { executed: '실행', not_run: '미실행', manual_pending: '수동 대기', failed: '요청 실패' };
const lines = [`커밋 ${commit.slice(0, 12)} · 미커밋 파일 ${dirty.length}개 · 대상 ${targetKind} ${meta.target}`,
  '| ID | 단계 | 구분 | 시험 | 요청 | 기대 | 실제 | 요청 ID | 시각 | 상태 | 일치 |', '|---|---|---|---|---|---|---|---|---|---|---|'];
for (const row of rows) {
  const actual = row.state === 'executed'
    ? (row.actualStatus !== null ? `HTTP ${row.actualStatus}${row.actualCode ? ` ${row.actualCode}` : ''}` : row.actualCode ?? '')
    : (row.reason ?? '');
  const kind = { normal: '정상', forbidden: '금지' }[row.kind] ?? row.kind;
  lines.push(`| ${row.testId} | ${row.stage} | ${kind} | ${row.title} | ${row.request ?? ''} | ${row.expected ?? ''} | ${actual} | ${row.requestId ?? (row.state === 'executed' && row.kind !== 'local_function' && row.kind !== 'local_file' ? '서버 미제공' : '')} | ${row.checkedAt.slice(11, 19)} | ${label[row.state]} | ${row.match === null ? '-' : row.match ? 'O' : 'X'} |`);
}
lines.push('', `요약: ${JSON.stringify(summary)}`, `41종: ${output.official41.reason}`);
process.stdout.write(`${lines.join('\n')}\n`);
process.exitCode = summary.executed_mismatch || summary.failed ? 1 : 0;
