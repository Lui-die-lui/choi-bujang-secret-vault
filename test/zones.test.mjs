// 8단계 구역 시험. 판정기 시험은 가상 요청이고, API 시험은 인메모리 대역(Supabase·로그인
// 검증을 흉내 낸 것)으로 api/my-notes의 권한 조건을 확인합니다. 둘 다 실제 배포 API나
// 심판 판정이 아닙니다. 실행: npm run test:zones
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mock, test } from 'node:test';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const NOTE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NOTE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

// ---- 인메모리 저장소와 로그인 대역 ----
const rows = [];
const sharedRows = []; // t02_vault_notes 대역
let forceDbError = false; // 진단 로그 시험용: 다음 조회를 DB 오류로 만든다
const resetRows = () => {
  sharedRows.length = 0;
  sharedRows.push({ id: 1, owner_id: null, title: '공용 제목', content: '공용 본문' });
  sharedRows.push({ id: 2, owner_id: A, title: '소유자 있는 행', content: 'A만 볼 본문' });
  rows.length = 0;
  rows.push({ id: NOTE_A, owner_id: A, title: 'A 제목', content: 'A 본문', created_at: 1 });
  rows.push({ id: NOTE_B, owner_id: B, title: 'B 제목', content: 'B 본문', created_at: 2 });
};
function query(table) {
  assert.ok(['t03_personal_notes', 't02_vault_notes'].includes(table));
  const source = table === 't02_vault_notes' ? sharedRows : rows;
  const filters = [];
  let op = 'select';
  let patch;
  let single = false;
  const pick = table === 't02_vault_notes'
    ? row => ({ title: row.title, content: row.content })
    : row => ({ id: row.id, title: row.title, content: row.content });
  const run = () => {
    if (forceDbError) return { data: null, error: { message: 'simulated db failure' } };
    const hit = source.filter(r => filters.every(([k, v]) => r[k] === v));
    if (op === 'update') hit.forEach(r => Object.assign(r, patch));
    if (op === 'delete') hit.forEach(r => source.splice(source.indexOf(r), 1));
    const data = single ? (hit[0] ? pick(hit[0]) : null) : hit.map(pick);
    return { data, error: null };
  };
  const builder = {
    select: () => builder,
    update: p => { op = 'update'; patch = p; return builder; },
    delete: () => { op = 'delete'; return builder; },
    insert: row => {
      const full = { id: row.id ?? randomUUID(), created_at: 9, ...row };
      rows.push(full);
      return { select: () => ({ single: async () => ({ data: { id: full.id }, error: null }) }) };
    },
    eq: (k, v) => { filters.push([k, v]); return builder; },
    is: (k, v) => { filters.push([k, v]); return builder; },
    order: () => builder,
    maybeSingle: async () => { single = true; return run(); },
    then: (resolve, reject) => Promise.resolve(run()).then(resolve, reject),
  };
  return builder;
}
mock.module('@supabase/supabase-js', {
  namedExports: { createClient: () => ({ from: query }) },
});
// 서버가 검증한 신원만 돌려주는 대역: Authorization 값으로만 사용자를 정합니다.
// 11단계 기기 확인 관문은 이 시험의 대상이 아니라서 "등록 기기로 확인됨" 대역으로 둡니다
// (관문 자체는 test/device.test.mjs에서 확인).
mock.module(new URL('../src/device-registry.mjs', import.meta.url).href, {
  namedExports: { requireRegisteredDevice: async () => ({ ok: true }) },
});
mock.module(new URL('../src/notes-auth.mjs', import.meta.url).href, {
  namedExports: {
    verifyRequestLogin: async request => {
      const auth = request.headers.authorization;
      const userId = { 'Bearer token-a': A, 'Bearer token-b': B,
        'Bearer token-judge-a': A, 'Bearer token-judge-b': B }[auth];
      if (!userId) return { ok: false, status: 401, body: { error: 'unauthorized' } };
      // 심판 A/B 토큰 대역: verify-login.mjs는 { kind:'judge', userId, runId, identity:'a'|'b' }를 돌려준다.
      if (auth.startsWith('Bearer token-judge-')) {
        return { ok: true, identity: { kind: 'judge', userId, runId: 'run-fixture',
          identity: auth.endsWith('-a') ? 'a' : 'b' } };
      }
      return { ok: true, identity: { kind: 'student', userId } };
    },
  },
});
process.env.SUPABASE_URL = 'https://example.invalid';
process.env.SUPABASE_SECRET_KEY = 'test-only-not-a-real-key';

const { default: shared } = await import('../api/notes.mjs');
const { default: byId } = await import('../api/my-notes/[id].mjs');
const { default: list } = await import('../api/my-notes/index.mjs');
const { decide, RULE_IDS } = await import('../src/decider.mjs');

function call(handler, { method = 'GET', token, query: q = {}, body } = {}) {
  const request = { method, headers: token ? { authorization: `Bearer ${token}` } : {}, query: q, body };
  const out = { status: null, body: undefined, headers: {} };
  const response = {
    setHeader: (k, v) => { out.headers[k] = v; },
    status(code) { out.status = code; return response; },
    json(payload) { out.body = payload; return response; },
    end() { return response; },
  };
  return handler(request, response).then(() => out);
}

test('API: A는 자기 메모를 조회·수정하고, B는 A 메모를 조회·수정·삭제할 수 없다', async () => {
  resetRows();
  const warn = mock.method(console, 'warn', () => {});
  const own = await call(byId, { token: 'token-a', query: { id: NOTE_A } });
  assert.equal(own.status, 200);
  assert.equal(own.body.body, 'A 본문');
  const edit = await call(byId, { method: 'PUT', token: 'token-a', query: { id: NOTE_A },
    body: { title: '새 제목', body: '새 본문' } });
  assert.equal(edit.status, 200);

  const snapshot = JSON.stringify(rows);
  const read = await call(byId, { token: 'token-b', query: { id: NOTE_A } });
  const write = await call(byId, { method: 'PUT', token: 'token-b', query: { id: NOTE_A },
    body: { title: '탈취', body: '탈취' } });
  const del = await call(byId, { method: 'DELETE', token: 'token-b', query: { id: NOTE_A } });
  assert.deepEqual([read.status, write.status, del.status], [404, 404, 404]);
  assert.deepEqual(read.body, { error: 'not_found' }); // 존재 여부·본문이 드러나지 않음
  assert.equal(JSON.stringify(rows), snapshot); // 거부된 요청 뒤 저장 데이터 그대로
  const logs = warn.mock.calls.map(c => String(c.arguments[0])).join('\n');
  assert.match(logs, /reason=owner_mismatch/u);
  assert.doesNotMatch(logs, /token|탈취|A 본문/u);
  warn.mock.restore();
});

test('진단 로그: GET 상세 조회의 결과를 구조화해 남기고 민감 값은 남기지 않으며 응답은 그대로다', async () => {
  resetRows();
  const info = mock.method(console, 'info', () => {});
  const warn = mock.method(console, 'warn', () => {});
  const error = mock.method(console, 'error', () => {});
  const events = () => info.mock.calls.map(c => JSON.parse(String(c.arguments[0])))
    .filter(e => e.event === 'my-notes.get');
  const fp = id => createHash('sha256').update(id).digest('hex').slice(0, 12);

  const found = await call(byId, { token: 'token-judge-a', query: { id: NOTE_A } });
  const denied = await call(byId, { token: 'token-judge-b', query: { id: NOTE_A } });
  forceDbError = true;
  const broken = await call(byId, { token: 'token-a', query: { id: NOTE_A } });
  forceDbError = false;
  const anonymous = await call(byId, { query: { id: NOTE_A } });
  const badId = await call(byId, { token: 'token-a', query: { id: 'SECRET-TEXT-NOT-UUID' } });

  // 응답은 진단 로그 추가 전과 같다.
  assert.deepEqual([found.status, denied.status, broken.status, anonymous.status, badId.status],
    [200, 404, 500, 401, 400]);
  assert.deepEqual(denied.body, { error: 'not_found' });

  const [e1, e2, e3, e4, e5] = events();
  assert.deepEqual(e1, { event: 'my-notes.get', outcome: 'found', kind: 'judge', identity: 'a',
    uid: fp(A), resource: `note:${NOTE_A}` });
  assert.deepEqual(e2, { event: 'my-notes.get', outcome: 'not_found', kind: 'judge', identity: 'b',
    uid: fp(B), resource: `note:${NOTE_A}` });
  assert.equal(e3.outcome, 'db_error');
  assert.equal(e3.kind, 'student');
  assert.equal(e3.identity, null);
  assert.deepEqual([e4.outcome, e4.status], ['unauthorized', 401]);
  assert.deepEqual(e5, { event: 'my-notes.get', outcome: 'invalid_id', idLength: 'SECRET-TEXT-NOT-UUID'.length });
  assert.notEqual(e1.uid, e2.uid); // A와 B의 지문이 다르다

  // 토큰·원본 사용자 ID·본문·환경 변수·잘못된 ID 원문은 기록에 없다.
  const all = [info, warn, error].flatMap(m => m.mock.calls.map(c => c.arguments.join(' '))).join(' | ');
  for (const secret of ['token-', A, B, 'A 본문', 'B 본문', 'test-only-not-a-real-key',
    'SECRET-TEXT-NOT-UUID', 'example.invalid']) {
    assert.ok(!all.includes(secret), `로그에 남으면 안 되는 값: ${secret}`);
  }
  info.mock.restore(); warn.mock.restore(); error.mock.restore();
});

test('진단 로그: 401의 원인(토큰 없음/검증 실패)을 분류해 남기고 토큰 값은 남기지 않는다', async () => {
  resetRows();
  const { describeAuthorization } = await import('../src/auth-diagnostics.mjs');
  const cfg = JSON.parse((await import('node:fs')).readFileSync(
    new URL('../aleph.config.json', import.meta.url), 'utf8'));
  const host = new URL(cfg.publicAppUrl).hostname;
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jwt = (header, payload) => `${b64(header)}.${b64(payload)}.c2ln`;
  const now = Math.floor(Date.now() / 1000);
  const judgeOk = { iss: cfg.judgeIssuer, aud: host, sub: randomUUID(), aleph_run: randomUUID(),
    aleph_role: 'judge', aleph_identity: 'a', iat: now, exp: now + 600 };

  assert.deepEqual(describeAuthorization(undefined), { present: false, bearer: false, issuer: 'none' });
  assert.equal(describeAuthorization('Basic abc').issuer, 'unparseable');
  assert.equal(describeAuthorization('Bearer a.b').issuer, 'unparseable');

  const good = describeAuthorization(`Bearer ${jwt({ alg: 'ES256' }, judgeOk)}`);
  assert.deepEqual(good, { present: true, bearer: true, issuer: 'judge', expired: false,
    algEs256: true, audOk: true, roleJudge: true, identityAB: true, subV4: true, runV4: true,
    lifetimeOk: true });
  const wrongAud = describeAuthorization(`Bearer ${jwt({ alg: 'ES256' }, { ...judgeOk, aud: 'other.example' })}`);
  assert.equal(wrongAud.audOk, false);
  assert.equal(describeAuthorization(`Bearer ${jwt({ alg: 'HS256' }, judgeOk)}`).algEs256, false);
  assert.equal(describeAuthorization(`Bearer ${jwt({ alg: 'ES256' }, { ...judgeOk, aleph_identity: 'c' })}`).identityAB, false);
  const student = describeAuthorization(`Bearer ${jwt({ alg: 'RS256' }, { iss: cfg.identityProvider.issuer,
    aud: cfg.identityProvider.audience, role: 'authenticated', exp: now + 60 })}`);
  assert.deepEqual([student.issuer, student.audOk, student.roleAuthenticated], ['student', true, true]);
  assert.equal(describeAuthorization(`Bearer ${jwt({ alg: 'ES256' }, { iss: 'https://x.example' })}`).issuer, 'other');

  // 핸들러: 401 응답은 그대로이고, 로그에는 분류만 남고 토큰 원문은 없다.
  const info = mock.method(console, 'info', () => {});
  const token = jwt({ alg: 'ES256' }, { ...judgeOk, aud: 'wrong.example' });
  const detail = await call(byId, { token, query: { id: NOTE_A } });
  const listing = await call(list, { token });
  const sharedRes = await call(shared, { token });
  assert.deepEqual([detail.status, listing.status, sharedRes.status], [401, 401, 401]);
  assert.deepEqual(detail.body, { error: 'unauthorized' });
  const events = info.mock.calls.map(c => JSON.parse(String(c.arguments[0])));
  assert.deepEqual(events.map(e => e.event), ['my-notes.get', 'my-notes.list', 'notes.list']);
  for (const e of events) {
    assert.equal(e.outcome, 'unauthorized');
    assert.equal(e.auth.issuer, 'judge');
    assert.equal(e.auth.audOk, false);
    assert.equal(e.auth.roleJudge, true);
  }
  const text = info.mock.calls.map(c => String(c.arguments[0])).join(' | ');
  for (const secret of [token, token.split('.')[1], judgeOk.sub, judgeOk.aleph_run]) {
    assert.ok(!text.includes(secret));
  }
  const anonymous = await call(byId, { query: { id: NOTE_A } });
  assert.equal(anonymous.status, 401);
  assert.deepEqual(JSON.parse(String(info.mock.calls.at(-1).arguments[0])).auth,
    { present: false, bearer: false, issuer: 'none' });
  info.mock.restore();
});

test('API: 목록은 요청자 본인 메모만 돌려준다', async () => {
  resetRows();
  const asB = await call(list, { token: 'token-b' });
  assert.equal(asB.status, 200);
  assert.deepEqual(asB.body.notes.map(n => n.id), [NOTE_B]);
  assert.ok(!JSON.stringify(asB.body).includes('A 제목'));
  assert.equal((await call(list, {})).status, 401);
});

test('API: 본문의 owner_id·role을 위조해도 소유자 변경·권한 상승이 안 된다', async () => {
  resetRows();
  const forged = await call(byId, { method: 'PUT', token: 'token-b', query: { id: NOTE_A },
    body: { title: 'x', body: 'y', owner_id: B, role: 'instructor' } });
  assert.equal(forged.status, 404);
  assert.equal(rows.find(r => r.id === NOTE_A).owner_id, A);
  const mine = await call(byId, { method: 'PUT', token: 'token-b', query: { id: NOTE_B },
    body: { title: 'ok', body: 'ok', owner_id: A, role: 'instructor' } });
  assert.equal(mine.status, 200);
  assert.equal(rows.find(r => r.id === NOTE_B).owner_id, B); // 소유자는 그대로
  const created = await call(list, { method: 'POST', token: 'token-b',
    body: { title: 't', body: 'b', owner_id: A } });
  assert.equal(rows.find(r => r.id === created.body.id).owner_id, B);
});

test('API: 허용하지 않은 메서드·잘못된 ID·토큰 없음은 거부된다', async () => {
  resetRows();
  assert.equal((await call(byId, { method: 'PATCH', token: 'token-a', query: { id: NOTE_A } })).status, 405);
  assert.equal((await call(byId, { token: 'token-a', query: { id: 'export' } })).status, 400);
  assert.equal((await call(byId, { query: { id: NOTE_A } })).status, 401);
});

test('공용 /api/notes: 소유자 없는 공용 행만 나가고, 개인 메모 테이블·소유자 있는 행은 안 나간다', async () => {
  resetRows();
  const out = await call(shared, { token: 'token-b' });
  assert.equal(out.status, 200);
  assert.deepEqual(out.body.notes, [{ title: '공용 제목', content: '공용 본문' }]);
  const text = JSON.stringify(out.body);
  for (const secret of ['A 제목', 'A 본문', 'B 제목', 'B 본문', '소유자 있는 행', 'A만 볼 본문']) {
    assert.ok(!text.includes(secret), secret);
  }
  assert.equal((await call(shared, {})).status, 401);
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    assert.equal((await call(shared, { method, token: 'token-b' })).status, 405);
  }
});

// ---- 판정기(가상 요청) ----
const base = (over = {}) => ({
  schema: 'aleph.decision.v1', requestId: randomUUID(), classId: 'c', projectId: 'p',
  subjectId: 'learner_fixture', deviceId: 'a'.repeat(16), service: 'notes', method: 'GET',
  path: '/notes/demo', route: 'GET /notes/:id', queryLength: 0,
  querySha256: createHash('sha256').update('').digest('hex'), at: new Date().toISOString(),
  policyRevision: 1, deviceRegistered: true, stepUp: { verified: false, authAgeSeconds: null },
  recentEvents: [], signals: { source: 'none', region: 'unknown', network: 'unknown', hour: 14 },
  ...over,
});
const verdict = async over => (await decide(base(over))).decision;
const composite = { signals: { source: 'judge_fixture', region: 'local', network: 'unusual', hour: 3 },
  recentEvents: [{ kind: 'risk_signal', ageSeconds: 60, count: 20 }] };

test('판정기: 소유자 구분은 미구현 — 같은 모양의 다른 자료 ID도 구분 없이 허용한다(API가 막음)', async () => {
  // 계약에 소유자·역할 필드가 없어 판정기는 A의 메모와 B의 메모를 구분할 수 없다.
  // 이 시험은 그 한계를 그대로 고정해 두어, 판정기가 소유자를 막는다고 오해하지 않게 한다.
  const mine = await decide(base({ path: `/notes/${NOTE_A}`, method: 'PUT', route: 'PUT /notes/:id' }));
  const others = await decide(base({ path: `/notes/${NOTE_B}`, method: 'PUT', route: 'PUT /notes/:id',
    subjectId: 'learner_other' }));
  assert.equal(mine.decision, 'allow');
  assert.equal(others.decision, 'allow');
});

test('판정기: 자기 메모 읽기·수정은 허용, 메모 전체 목록 경로는 거부', async () => {
  assert.equal(await verdict({}), 'allow');
  assert.equal(await verdict({ method: 'PUT', route: 'PUT /notes/:id' }), 'allow');
  assert.equal(await verdict({ path: '/notes', route: 'GET /notes' }), 'deny');
  assert.equal(await verdict({ path: '/notes/', route: 'GET /notes' }), 'deny');
  assert.equal(await verdict({ path: '/notes/list', route: 'GET /notes/:id' }), 'deny');
  assert.equal(await verdict({ path: '/notes', route: 'GET /notes',
    stepUp: { verified: true, authAgeSeconds: 5 } }), 'deny');
});

test('판정기: 공지 쓰기는 POST·PUT·PATCH·DELETE 모두 거부', async () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.equal(await verdict({ service: 'announcements', method, path: '/announcements/n1',
      route: `${method} /announcements/:id` }), 'deny', method);
    assert.equal(await verdict({ service: 'announcements', method, path: '/announcements',
      route: `${method} /announcements` }), 'deny', method);
  }
});

test('판정기: 강사 공지 수정은 학생·재인증과 관계없이 거부', async () => {
  const notice = { service: 'announcements', method: 'PUT', path: '/announcements/n1',
    route: 'PUT /announcements/:id' };
  assert.equal(await verdict(notice), 'deny');
  assert.equal((await decide(base(notice))).reasonCode, 'starter_not_ready');
  assert.equal(await verdict({ ...notice, stepUp: { verified: true, authAgeSeconds: 5 } }), 'deny');
  assert.equal(await verdict({ ...notice, deviceRegistered: false }), 'deny');
  assert.equal(await verdict({ ...notice, method: 'GET', route: 'GET /announcements/:id' }), 'deny');
});

test('판정기: 알 수 없는 경로·메서드·쿼리 선택·기능 경로는 거부', async () => {
  const cases = [
    { path: '/notes/demo/export', route: 'GET /notes/:id/export' },
    { path: '/notes/export', route: 'GET /notes/:id' },
    { path: '/notes/demo', route: 'GET /notes/:id', queryLength: 8 },
    { path: '/notes/../admin', route: 'GET /notes/:id' },
    { path: '/other', route: 'GET /other' },
    { method: 'DELETE', route: 'DELETE /notes/:id' },
    { method: 'POST', route: 'POST /notes', path: '/notes' },
    { path: '/notes/demo', route: 'PUT /notes/:id' }, // method와 route 불일치
  ];
  for (const over of cases) assert.equal(await verdict(over), 'deny', JSON.stringify(over));
});

test('판정기: 미등록 기기는 새 구역으로도, 7단계 추가 인증은 구역 허용으로도 우회되지 않는다', async () => {
  assert.equal(await verdict({ deviceRegistered: false }), 'deny');
  assert.equal(await verdict({ method: 'PUT', route: 'PUT /notes/:id', deviceRegistered: false }), 'deny');
  assert.equal(await verdict(composite), 'step_up');
  assert.equal(await verdict({ ...composite, method: 'PUT', route: 'PUT /notes/:id' }), 'step_up');
  assert.equal(await verdict({ ...composite, stepUp: { verified: true, authAgeSeconds: 60 } }), 'allow');
  const res = await decide(base({ method: 'PUT', route: 'PUT /notes/:id' }));
  assert.ok(res.ruleIds.every(id => RULE_IDS.includes(id)));
});
