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
const tables = { t11_devices: [], t03_personal_notes: [], t02_vault_notes: [], t10_note_backups: [] };
function query(table) {
  assert.ok(table in tables, table);
  const filters = [];
  let op = 'select';
  let patch;
  const run = single => {
    const source = tables[table];
    if (op === 'insert') {
      if (table === 't11_devices' && source.some(r => r.credential_id === patch.credential_id)) {
        return { data: null, error: { message: 'duplicate key' } };
      }
      source.push({ ...patch });
      return { data: single ? { ...patch } : [{ ...patch }], error: null };
    }
    const hit = source.filter(r => filters.every(([k, v]) => r[k] === v));
    return { data: single ? (hit[0] ? { ...hit[0] } : null) : hit.map(r => ({ ...r })), error: null };
  };
  const builder = {
    select: () => builder,
    insert: row => { op = 'insert'; patch = row; return builder; },
    eq: (k, v) => { filters.push([k, v]); return builder; },
    is: (k, v) => { filters.push([k, v]); return builder; },
    order: () => builder,
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
const { relyingParty, issueDeviceSession } = await import('../src/device-registry.mjs');

function call(handler, { method = 'GET', token, deviceSession, query: q = {}, body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (deviceSession) headers['x-device-session'] = deviceSession;
  const request = { method, headers, query: q, body };
  const out = { status: null, body: undefined };
  const response = {
    setHeader: () => {},
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
  const snapshot = JSON.stringify(tables);
  for (const [handler, options] of dataRequests()) {
    const out = await call(handler, options);
    assert.equal(out.status, 403, `${options.method ?? 'GET'}`);
    assert.deepEqual(out.body, { error: 'device_not_registered' });
  }
  // 심판 신원 토큰도 같은 규칙이고, 비로그인은 전과 같이 401이다
  assert.equal((await call(listApi, { token: 'token-judge-a' })).status, 403);
  assert.equal((await call(listApi, {})).status, 401);
  assert.equal(JSON.stringify(tables), snapshot);
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
