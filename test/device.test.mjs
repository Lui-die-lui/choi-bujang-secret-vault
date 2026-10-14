// 11단계 기기 승인 시험. 인메모리 대역(Supabase·로그인 검증을 흉내 낸 것)과, 인증 장치를
// 흉내 낸 시험용 키로 기기 승인 흐름과 자료 API의 기기 확인 관문을 확인합니다. 실제 배포
// API·DB·브라우저의 패스키 화면이나 심판 판정이 아닙니다. 실행: npm run test:device
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mock, test } from 'node:test';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const NOTE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

// ---- 인메모리 저장소와 로그인 대역 ----
const failing = new Set(); // 이 표를 조회하면 오류를 돌려줌(조회 실패 시험)
const tables = { t11_devices: [], t03_personal_notes: [], t02_vault_notes: [], t10_note_backups: [],
  t12_revoked_identities: [], t12_access_events: [], t10_restore_audit: [] };
function query(table) {
  assert.ok(table in tables, table);
  const filters = [];
  let op = 'select';
  let patch;
  const run = single => {
    const source = tables[table];
    if (failing.has(table)) return { data: null, error: { message: 'injected failure' } };
    if (op === 'insert') {
      if (table === 't11_devices' && source.some(r => r.credential_id === patch.credential_id)) {
        return { data: null, error: { message: 'duplicate key' } };
      }
      source.push({ ...patch });
      return { data: single ? { ...patch } : [{ ...patch }], error: null };
    }
    const hit = source.filter(r => filters.every(([k, v]) => r[k] === v || (v === null && r[k] === undefined)));
    return { data: single ? (hit[0] ? { ...hit[0] } : null) : hit.map(r => ({ ...r })), error: null };
  };
  const builder = {
    select: () => builder,
    insert: row => { op = 'insert'; patch = row; return builder; },
    eq: (k, v) => { filters.push([k, v]); return builder; },
    is: (k, v) => { filters.push([k, v]); return builder; },
    order: () => builder,
    gte: () => builder,
    limit: () => builder,
    single: async () => run(true),
    maybeSingle: async () => run(true),
    then: (resolve, reject) => Promise.resolve(run(false)).then(resolve, reject),
  };
  return builder;
}
mock.module('@supabase/supabase-js', {
  namedExports: { createClient: () => ({ from: query }) },
});
mock.module(new URL('../src/notes-auth.mjs', import.meta.url).href, {
  namedExports: {
    verifyRequestLogin: async request => {
      const auth = request.headers.authorization;
      const userId = { 'Bearer token-a': A, 'Bearer token-b': B, 'Bearer token-judge-a': A }[auth];
      if (!userId) return { ok: false, status: 401, body: { error: 'unauthorized' } };
      return { ok: true, identity: auth.includes('judge')
        ? { kind: 'judge', userId, runId: 'run-fixture', identity: 'a' } : { kind: 'student', userId } };
    },
  },
});
process.env.SUPABASE_URL = 'https://example.invalid';
process.env.SUPABASE_SECRET_KEY = 'test-only-not-a-real-key';

const { default: challengeApi } = await import('../api/device/challenge.mjs');
const { default: requestApi } = await import('../api/device/request.mjs');
const { default: verifyApi } = await import('../api/device/verify.mjs');
const { default: listApi } = await import('../api/my-notes/index.mjs');
const { default: itemApi } = await import('../api/my-notes/[id].mjs');
const { default: sharedApi } = await import('../api/notes.mjs');
const { default: restoreApi } = await import('../api/note-restore/[id].mjs');
const { default: summaryApi } = await import('../api/ops/summary.mjs');
const { relyingParty, issueDeviceSession } = await import('../src/device-registry.mjs');

function call(handler, { method = 'GET', token, deviceSession, query: q = {}, body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (deviceSession) headers['x-device-session'] = deviceSession;
  const request = { method, headers, query: q, body };
  const out = { status: null, body: undefined, headers: {} };
  const response = {
    setHeader: (name, value) => { out.headers[name.toLowerCase()] = value; },
    status(code) { out.status = code; return response; },
    json(payload) { out.body = payload; return response; },
    end() { return response; },
  };
  return handler(request, response).then(() => out);
}

// ---- 인증 장치 대역: 키는 이 객체 안에만 있고, 서버에는 공개키와 서명만 갑니다 ----
const b64u = data => Buffer.from(data).toString('base64url');
const sha256 = data => createHash('sha256').update(data).digest();
function authenticator(credentialId = b64u(Buffer.from('fixture-credential-0001'))) {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const party = relyingParty();
  const clientData = (type, challenge, origin = party.origin) => b64u(JSON.stringify({ type, challenge, origin }));
  return {
    credentialId,
    create: (challenge, challengeToken) => ({ challengeToken, credentialId, alg: -7,
      publicKey: b64u(publicKey.export({ format: 'der', type: 'spki' })),
      clientDataJSON: clientData('webauthn.create', challenge) }),
    get: (challenge, challengeToken, { origin, rpId = party.id } = {}) => {
      const authenticatorData = Buffer.concat([sha256(rpId), Buffer.from([0x05, 0, 0, 0, 1])]);
      const clientDataJSON = clientData('webauthn.get', challenge, origin);
      const signature = sign('sha256', Buffer.concat([authenticatorData, sha256(Buffer.from(clientDataJSON, 'base64url'))]), privateKey);
      return { challengeToken, credentialId, authenticatorData: b64u(authenticatorData), clientDataJSON,
        signature: b64u(signature) };
    },
  };
}
const challengeFor = async token => (await call(challengeApi, { token })).body;
const quiet = () => {
  const mocks = ['info', 'warn', 'error'].map(name => mock.method(console, name, () => {}));
  return { text: () => mocks.flatMap(m => m.mock.calls).map(c => c.arguments.map(String).join(' ')).join('\n'),
    done: () => mocks.forEach(m => m.mock.restore()) };
};
function reset() {
  tables.t11_devices = [];
  tables.t03_personal_notes = [{ id: NOTE_A, owner_id: A, title: 'A 제목', content: 'A 본문', created_at: 1 }];
  tables.t02_vault_notes = [{ id: 1, owner_id: null, title: '공용 제목', content: '공용 본문' }];
  tables.t10_note_backups = [];
  tables.t12_revoked_identities = [];
  tables.t12_access_events = [];
  tables.t10_restore_audit = [];
  failing.clear();
}
const dataRequests = (extra = {}) => [
  [sharedApi, { token: 'token-a', ...extra }],
  [listApi, { token: 'token-a', ...extra }],
  [listApi, { method: 'POST', token: 'token-a', body: { title: '새 제목', body: '새 본문' }, ...extra }],
  [itemApi, { token: 'token-a', query: { id: NOTE_A }, ...extra }],
  [itemApi, { method: 'PUT', token: 'token-a', query: { id: NOTE_A }, body: { title: '바꿈', body: '바꿈' }, ...extra }],
  [itemApi, { method: 'DELETE', token: 'token-a', query: { id: NOTE_A }, ...extra }],
  [restoreApi, { token: 'token-a', query: { id: NOTE_A }, ...extra }],
  [restoreApi, { method: 'POST', token: 'token-a', query: { id: NOTE_A }, ...extra }],
];

test('승인 전: 기기 확인 없이 보낸 보호 요청은 자료 없이 403이고 저장 내용도 그대로다', async () => {
  reset();
  const logs = quiet();
  const stored = () => JSON.stringify({ ...tables, t12_access_events: undefined }); // 접근 사건 기록(12단계)은 자료가 아니라 관측 기록
  const snapshot = stored();
  for (const [handler, options] of dataRequests()) {
    const out = await call(handler, options);
    assert.equal(out.status, 403, `${options.method ?? 'GET'}`);
    assert.deepEqual(out.body, { error: 'device_not_registered' });
  }
  // 심판 신원 토큰도 같은 규칙이고, 비로그인은 전과 같이 401이다
  assert.equal((await call(listApi, { token: 'token-judge-a' })).status, 403);
  assert.equal((await call(listApi, {})).status, 401);
  assert.equal(stored(), snapshot);
  assert.ok(tables.t12_access_events.length > 0 && tables.t12_access_events.every(e => e.outcome === 'device_not_registered' && e.request_id));
  assert.doesNotMatch(logs.text(), /A 본문|공용 본문|token-a/u);
  logs.done();
});

test('승인 요청만으로는 권한이 없다: 등록부에 대기로만 남고 자료는 계속 닫혀 있다', async () => {
  reset();
  const logs = quiet();
  const device = authenticator();
  const first = await challengeFor('token-a');
  assert.deepEqual(first.devices, []);
  // 본문에 승인 상태를 끼워 넣어도 읽지 않는다
  const asked = await call(requestApi, { method: 'POST', token: 'token-a',
    body: { ...device.create(first.challenge, first.challengeToken), status: 'approved', owner_id: B } });
  assert.equal(asked.status, 201);
  assert.equal(asked.body.status, 'pending');
  assert.deepEqual(tables.t11_devices.map(r => [r.owner_id, r.status]), [[A, 'pending']]);

  // 대기 상태의 기기는 서명이 맞아도 기기 확인 결과를 받지 못한다
  const again = await challengeFor('token-a');
  assert.deepEqual(again.devices.map(d => d.status), ['pending']);
  const checked = await call(verifyApi, { method: 'POST', token: 'token-a', body: device.get(again.challenge, again.challengeToken) });
  assert.deepEqual([checked.status, checked.body.status, checked.body.deviceSession], [200, 'pending', undefined]);
  assert.equal((await call(listApi, { token: 'token-a' })).status, 403);
  logs.done();
});

test('서버 등록부에서 승인된 뒤에만 기존 자료실이 열리고, 승인을 거두면 다음 요청에서 닫힌다', async () => {
  reset();
  const logs = quiet();
  const device = authenticator();
  const first = await challengeFor('token-a');
  await call(requestApi, { method: 'POST', token: 'token-a', body: device.create(first.challenge, first.challengeToken) });
  tables.t11_devices[0].status = 'approved'; // 관리자가 DB에서 직접 승인(이 앱의 API에는 없는 동작)

  const next = await challengeFor('token-a');
  const checked = await call(verifyApi, { method: 'POST', token: 'token-a', body: device.get(next.challenge, next.challengeToken) });
  assert.equal(checked.body.status, 'approved');
  const { deviceSession } = checked.body;
  assert.equal(typeof deviceSession, 'string');

  // 기존 정상 요청은 전과 같은 응답이다
  const shared = await call(sharedApi, { token: 'token-a', deviceSession });
  assert.deepEqual([shared.status, shared.body.notes.length], [200, 1]);
  const own = await call(itemApi, { token: 'token-a', deviceSession, query: { id: NOTE_A } });
  assert.deepEqual([own.status, own.body], [200, { id: NOTE_A, title: 'A 제목', body: 'A 본문' }]);
  assert.equal((await call(listApi, { token: 'token-a', deviceSession })).body.notes.length, 1);

  // 기존 거부도 그대로다: 승인된 A의 기기 확인 결과로 B가 요청해도, B가 A의 메모를 요청해도 열리지 않는다
  assert.equal((await call(listApi, { token: 'token-b', deviceSession })).status, 403);
  assert.equal((await call(listApi, {})).status, 401);

  // 승인을 거두면(등록부 상태 변경) 같은 기기 확인 결과로도 다음 요청부터 닫힌다
  tables.t11_devices[0].status = 'revoked';
  assert.equal((await call(listApi, { token: 'token-a', deviceSession })).status, 403);
  const after = await challengeFor('token-a');
  const recheck = await call(verifyApi, { method: 'POST', token: 'token-a', body: device.get(after.challenge, after.challengeToken) });
  assert.deepEqual([recheck.body.status, recheck.body.deviceSession], ['revoked', undefined]);
  logs.done();
});

test('기기 확인 거부: 틀린 서명, 다른 질문·주소, 다른 사용자의 기기, 위조·만료된 확인 결과', async () => {
  reset();
  const logs = quiet();
  const device = authenticator();
  const first = await challengeFor('token-a');
  await call(requestApi, { method: 'POST', token: 'token-a', body: device.create(first.challenge, first.challengeToken) });
  tables.t11_devices[0].status = 'approved';
  const verify = (token, body) => call(verifyApi, { method: 'POST', token, body });

  const c = await challengeFor('token-a');
  const good = device.get(c.challenge, c.challengeToken);
  const stranger = authenticator(device.credentialId); // 같은 식별값을 내세운 다른 키
  const cases = {
    '다른 키로 만든 서명': stranger.get(c.challenge, c.challengeToken),
    '서명 뒤 인증 장치 자료를 바꿈': { ...good, authenticatorData: b64u(Buffer.concat([sha256(relyingParty().id), Buffer.from([0x05, 0, 0, 0, 2])])) },
    '다른 앱 주소에서 만든 서명': device.get(c.challenge, c.challengeToken, { origin: 'https://evil.example' }),
    '서버가 내지 않은 질문': device.get('A'.repeat(43), c.challengeToken),
    '질문 봉합값을 고침': { ...good, challengeToken: `${c.challengeToken.split('.')[0]}.${'A'.repeat(43)}` },
    '서명 없음': { challengeToken: c.challengeToken, credentialId: device.credentialId },
  };
  for (const [name, body] of Object.entries(cases)) {
    const out = await verify('token-a', body);
    assert.deepEqual([out.status, out.body], [401, { error: 'device_not_verified' }], name);
  }
  // B는 A의 기기로 확인받을 수 없다(질문도 사용자에 묶임)
  const cb = await challengeFor('token-b');
  assert.equal((await verify('token-b', device.get(cb.challenge, cb.challengeToken))).status, 401);
  assert.equal((await verify('token-b', device.get(c.challenge, c.challengeToken))).status, 401);

  // 기기 확인 결과: 지어낸 값, 다른 비밀로 만든 값, 만료된 값은 모두 거부
  const expired = issueDeviceSession(process.env.SUPABASE_SECRET_KEY, A, device.credentialId, 1000).deviceSession;
  const otherSecret = issueDeviceSession('another-secret', A, device.credentialId).deviceSession;
  for (const deviceSession of ['made-up', 'a.b', expired, otherSecret]) {
    assert.equal((await call(listApi, { token: 'token-a', deviceSession })).status, 403, deviceSession.slice(0, 12));
  }
  // 등록부에 없는 기기를 가리키는 확인 결과도 거부
  const unknown = issueDeviceSession(process.env.SUPABASE_SECRET_KEY, A, 'not-in-registry-0000').deviceSession;
  assert.equal((await call(listApi, { token: 'token-a', deviceSession: unknown })).status, 403);
  assert.doesNotMatch(logs.text(), /token-a|A 본문/u);
  logs.done();
});

test('승인 요청 거부: 비로그인, 틀린 종류의 서명 자료, 틀린 공개키, 같은 기기 두 번', async () => {
  reset();
  const logs = quiet();
  const device = authenticator();
  const c = await challengeFor('token-a');
  const body = device.create(c.challenge, c.challengeToken);
  assert.equal((await call(challengeApi, {})).status, 401);
  assert.equal((await call(requestApi, { method: 'POST', body })).status, 401);
  assert.equal((await call(verifyApi, { method: 'POST', body })).status, 401);
  const bad = [
    { ...body, publicKey: b64u('not a key') },
    { ...body, alg: -8 },
    { ...body, credentialId: 'short' },
    { ...body, clientDataJSON: device.get(c.challenge, c.challengeToken).clientDataJSON }, // 확인용 자료를 요청에 사용
    { ...body, challengeToken: 'x.y' },
  ];
  for (const item of bad) {
    assert.equal((await call(requestApi, { method: 'POST', token: 'token-a', body: item })).status, 400);
  }
  assert.equal(tables.t11_devices.length, 0);
  assert.equal((await call(requestApi, { method: 'POST', token: 'token-a', body })).status, 201);
  assert.equal((await call(requestApi, { method: 'POST', token: 'token-a', body })).status, 409);
  assert.equal(tables.t11_devices.length, 1);
  assert.equal((await call(requestApi, { method: 'GET', token: 'token-a' })).status, 405);
  logs.done();
});

// ---- 12단계: 신원 회수, 요청 ID, 탈환 작전실 (인메모리 대역. 실제 배포 API·심판 판정이 아님) ----
async function approvedSession(token = 'token-a', userId = A) {
  const device = authenticator(b64u(Buffer.from(`fixture-credential-${userId.slice(0, 4)}`)));
  const first = await challengeFor(token);
  await call(requestApi, { method: 'POST', token, body: device.create(first.challenge, first.challengeToken) });
  tables.t11_devices.find(r => r.credential_id === device.credentialId).status = 'approved';
  const next = await challengeFor(token);
  const checked = await call(verifyApi, { method: 'POST', token,
    body: device.get(next.challenge, next.challengeToken) });
  assert.equal(checked.body.status, 'approved');
  return checked.body.deviceSession;
}

test('회수된 신원: 같은 로그인·승인 기기·기기 확인 결과로도 모든 보호·기기 경로가 닫히고, 다른 정상 사용자는 열린다', async () => {
  reset();
  const logs = quiet();
  const sessionA = await approvedSession('token-a', A);
  const sessionB = await approvedSession('token-b', B);
  // 회수 전: 정상 허용
  assert.equal((await call(listApi, { token: 'token-a', deviceSession: sessionA })).status, 200);
  assert.equal((await call(sharedApi, { token: 'token-b', deviceSession: sessionB })).status, 200);

  tables.t12_revoked_identities.push({ subject_id: A, reason_code: 'operator_revoke', restored_at: null }); // 관리자가 DB에서 회수
  for (const [handler, options] of dataRequests({ deviceSession: sessionA })) {
    const out = await call(handler, options);
    assert.deepEqual([out.status, out.body], [403, { error: 'identity_revoked' }]);
  }
  assert.equal((await call(challengeApi, { token: 'token-a' })).status, 403);
  assert.equal((await call(verifyApi, { method: 'POST', token: 'token-a', body: { credentialId: 'x'.repeat(20) } })).status, 403);
  assert.equal((await call(summaryApi, { token: 'token-a', deviceSession: sessionA })).status, 403);
  // 회수 대상이 아닌 B의 정상 요청은 그대로 허용
  assert.equal((await call(listApi, { token: 'token-b', deviceSession: sessionB })).status, 200);
  assert.equal((await call(sharedApi, { token: 'token-b', deviceSession: sessionB })).status, 200);
  // 비로그인은 여전히 401
  assert.equal((await call(listApi, {})).status, 401);

  // 복권(restored_at)하면 같은 계정이 다시 열린다 — 이전 거부가 영구 상태가 아님을 확인
  tables.t12_revoked_identities[0].restored_at = '2026-10-14T00:00:00Z';
  assert.equal((await call(listApi, { token: 'token-a', deviceSession: sessionA })).status, 200);
  assert.doesNotMatch(logs.text(), /token-a|A 본문/u);
  logs.done();
});

test('회수 등록부를 읽지 못하면 열어 주지 않는다(fail-closed)', async () => {
  reset();
  const logs = quiet();
  const session = await approvedSession('token-a', A);
  failing.add('t12_revoked_identities');
  const out = await call(listApi, { token: 'token-a', deviceSession: session });
  assert.deepEqual([out.status, out.body], [503, { error: 'revocation_registry_unavailable' }]);
  failing.clear();
  assert.equal((await call(listApi, { token: 'token-a', deviceSession: session })).status, 200);
  logs.done();
});

test('요청 ID: 응답마다 서버가 새로 만든 값이 붙고, 접근 사건에 같은 값이 남으며, 본문·토큰은 사건에 없다', async () => {
  reset();
  const logs = quiet();
  const session = await approvedSession('token-a', A);
  tables.t12_access_events = [];
  const one = await call(listApi, { token: 'token-a', deviceSession: session });
  const two = await call(listApi, { token: 'token-a', deviceSession: session });
  assert.match(one.headers['x-request-id'], /^[0-9a-f-]{36}$/u);
  assert.notEqual(one.headers['x-request-id'], two.headers['x-request-id']);
  assert.deepEqual(tables.t12_access_events.map(e => e.request_id),
    [one.headers['x-request-id'], two.headers['x-request-id']]);
  const text = JSON.stringify(tables.t12_access_events);
  assert.doesNotMatch(text, /A 본문|A 제목|token-a|Bearer/u);
  logs.done();
});

test('탈환 작전실: 본인 범위만, 인증·기기·회수 관문을 거치고, 값의 출처 구분과 민감값 제외', async () => {
  reset();
  const logs = quiet();
  assert.equal((await call(summaryApi, {})).status, 401);
  assert.equal((await call(summaryApi, { token: 'token-a' })).status, 403); // 승인 기기 없음
  const sessionA = await approvedSession('token-a', A);
  const sessionB = await approvedSession('token-b', B);
  assert.equal((await call(summaryApi, { method: 'POST', token: 'token-a', deviceSession: sessionA })).status, 405);
  // 본인 사건 121건(GET)을 10분 안에 넣어 탐지 결과를 확인(회수는 집행되지 않음)
  const subject = (await (async () => {
    await call(listApi, { token: 'token-a', deviceSession: sessionA });
    return tables.t12_access_events.at(-1).subject_hash;
  })());
  for (let i = 0; i < 121; i += 1) {
    tables.t12_access_events.push({ at: new Date().toISOString(), subject_hash: subject,
      method: 'GET', route: '/api/notes', outcome: 'allowed', status: 200, request_id: `fixture-${i}` });
  }
  tables.t10_restore_audit.push({ at: '2026-10-13T00:00:00Z', note_id: NOTE_A, owner_id: A, outcome: 'restored', reason: null },
    { at: '2026-10-13T00:00:00Z', note_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', owner_id: B, outcome: 'restored', reason: null });
  const out = await call(summaryApi, { token: 'token-a', deviceSession: sessionA });
  assert.equal(out.status, 200);
  assert.equal(out.body.scope, 'self');
  assert.equal(out.body.requestId, out.headers['x-request-id']);
  assert.equal(out.body.rules.state, 'defined_in_code');
  assert.ok(out.body.rules.ruleIds.includes('device_registered'));
  assert.equal(out.body.detection.state, 'observed', JSON.stringify(out.body.detection));
  assert.equal(out.body.detection.result.action, 'propose_revocation');
  assert.equal(out.body.detection.engineDelivery, 'not_connected');
  assert.equal(out.body.identity.current, 'active'); // 제안만 있고 회수는 집행되지 않음
  assert.deepEqual(out.body.devices.counts, { pending: 0, approved: 1, revoked: 0 });
  assert.equal(out.body.recovery.restoreAudit.length, 1); // B의 복원 기록은 보이지 않음
  const text = JSON.stringify(out.body);
  assert.doesNotMatch(text, /A 본문|A 제목|공용 본문|token-a|Bearer|public_key|credential_id|fixture-credential|test-only-not-a-real-key/u);
  assert.doesNotMatch(text, new RegExp(A, 'u'));

  // 조회 실패는 0건이 아니라 query_failed로 표시한다
  failing.add('t10_note_backups');
  const failed = await call(summaryApi, { token: 'token-b', deviceSession: sessionB });
  assert.equal(failed.status, 200);
  assert.equal(failed.body.recovery.state, 'query_failed');
  assert.equal(failed.body.devices.state, 'observed'); // 기기 등록부가 안 읽히면 관문이 먼저 403으로 닫는다
  logs.done();
});
