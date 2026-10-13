// 10단계 복원 시험. 인메모리 대역(Supabase·로그인 검증을 흉내 낸 것)으로 메모 사본과
// 복원 경로를 확인합니다. 실제 배포 API·DB나 심판 판정이 아닙니다. 실행: npm run test:restore
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mock, test } from 'node:test';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const NOTE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NOTE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const NOTE_B2 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

// ---- 인메모리 저장소와 로그인 대역 ----
const tables = { t03_personal_notes: [], t10_note_backups: [] };
let failTable = null; // 이 표의 다음 요청을 DB 오류로 만든다
let beforeBackupRead = null;
let backupReads = 0;
function query(table) {
  assert.ok(table in tables, table);
  const filters = [];
  let op = 'select';
  let patch;
  const run = single => {
    if (failTable === table) return { data: null, error: { message: 'simulated db failure' } };
    // 사본 표를 n번째로 읽기 직전에 사본을 바꾸는 장치(쓰기 직전 재검증 시험용)
    if (op === 'select' && table === 't10_note_backups' && beforeBackupRead) {
      backupReads += 1;
      beforeBackupRead(backupReads);
    }
    const source = tables[table];
    const hit = source.filter(r => filters.every(([k, v]) => r[k] === v));
    if (op === 'insert') {
      const key = table === 't10_note_backups' ? 'note_id' : 'id';
      if (source.some(r => r[key] === patch[key])) return { data: null, error: { message: 'duplicate key' } };
      source.push({ ...patch });
      return { data: single ? { ...patch } : [{ ...patch }], error: null };
    }
    if (op === 'update') hit.forEach(r => Object.assign(r, patch));
    return { data: single ? (hit[0] ? { ...hit[0] } : null) : hit.map(r => ({ ...r })), error: null };
  };
  const builder = {
    select: () => builder,
    insert: row => {
      op = 'insert';
      patch = table === 't03_personal_notes' && !row.id ? { id: randomUUID(), ...row } : row;
      return builder;
    },
    update: p => { op = 'update'; patch = p; return builder; },
    eq: (k, v) => { filters.push([k, v]); return builder; },
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
      const userId = { 'Bearer token-a': A, 'Bearer token-b': B }[request.headers.authorization];
      if (!userId) return { ok: false, status: 401, body: { error: 'unauthorized' } };
      return { ok: true, identity: { kind: 'student', userId } };
    },
  },
});
process.env.SUPABASE_URL = 'https://example.invalid';
process.env.SUPABASE_SECRET_KEY = 'test-only-not-a-real-key';

const { default: restore } = await import('../api/note-restore/[id].mjs');
const { default: list } = await import('../api/my-notes/index.mjs');
const { backupRow, contentHash } = await import('../src/note-backup.mjs');

function call(handler, { method = 'POST', token, query: q = {}, body } = {}) {
  const request = { method, headers: token ? { authorization: `Bearer ${token}` } : {}, query: q, body };
  const out = { status: null, body: undefined };
  const response = {
    setHeader: () => {},
    status(code) { out.status = code; return response; },
    json(payload) { out.body = payload; return response; },
    end() { return response; },
  };
  return handler(request, response).then(() => out);
}

const note = (id, owner, title, content) => ({ id, owner_id: owner, title, content });
function reset() {
  failTable = null;
  beforeBackupRead = null;
  backupReads = 0;
  tables.t03_personal_notes = [note(NOTE_A, A, 'A 제목', 'A 본문'), note(NOTE_B, B, 'B 제목', 'B 본문'),
    note(NOTE_B2, B, 'B 둘째 제목', 'B 둘째 본문')];
  tables.t10_note_backups = tables.t03_personal_notes
    .map(r => backupRow({ id: r.id, ownerId: r.owner_id, title: r.title, content: r.content }));
}
const row = id => tables.t03_personal_notes.find(r => r.id === id);
const others = id => JSON.stringify(tables.t03_personal_notes.filter(r => r.id !== id));
const quiet = () => {
  const info = mock.method(console, 'info', () => {});
  const error = mock.method(console, 'error', () => {});
  return { info, error, text: () => [...info.mock.calls, ...error.mock.calls]
    .map(c => c.arguments.map(String).join(' ')).join('\n'),
  done: () => { info.mock.restore(); error.mock.restore(); } };
}

test('복원: 변조된 B의 메모 한 건이 사본과 같은 ID·소유자·내용 해시로 돌아온다', async () => {
  reset();
  const logs = quiet();
  const expected = contentHash('B 제목', 'B 본문');
  Object.assign(row(NOTE_B), { title: '변조 제목', content: '변조 본문' });
  const before = others(NOTE_B);
  const backups = JSON.stringify(tables.t10_note_backups);

  const out = await call(restore, { token: 'token-b', query: { id: NOTE_B } });
  assert.equal(out.status, 200);
  assert.deepEqual(out.body, { id: NOTE_B, restored: true, backupVerified: true,
    backupVersion: { createdAt: null, contentSha256: expected }, changes: ['title', 'body'], contentSha256: expected });
  assert.deepEqual(row(NOTE_B), note(NOTE_B, B, 'B 제목', 'B 본문'));
  assert.equal(contentHash(row(NOTE_B).title, row(NOTE_B).content), expected);
  assert.equal(others(NOTE_B), before); // 다른 메모·다른 계정 자료는 그대로
  assert.equal(JSON.stringify(tables.t10_note_backups), backups); // 사본도 그대로
  assert.match(logs.text(), /"event":"note-restore.restore","outcome":"restored"/u);
  assert.doesNotMatch(logs.text() + JSON.stringify(out.body), /B 본문|B 제목|변조|token/u);
  logs.done();
});

test('복원: 삭제된 B의 메모 한 건이 같은 ID·소유자로 다시 생긴다', async () => {
  reset();
  const logs = quiet();
  tables.t03_personal_notes = tables.t03_personal_notes.filter(r => r.id !== NOTE_B);
  const before = others(NOTE_B);
  const out = await call(restore, { token: 'token-b', query: { id: NOTE_B } });
  assert.equal(out.status, 200);
  assert.deepEqual(row(NOTE_B), note(NOTE_B, B, 'B 제목', 'B 본문'));
  assert.equal(others(NOTE_B), before);
  assert.equal(tables.t03_personal_notes.length, 3);
  logs.done();
});

test('복원 중단: 사본이 없거나, 검증에 실패하거나, 사본을 읽지 못하면 아무것도 바꾸지 않는다', async () => {
  const logs = quiet();
  const tamper = () => Object.assign(row(NOTE_B), { title: '변조 제목', content: '변조 본문' });
  const copyOf = id => tables.t10_note_backups.find(r => r.note_id === id);
  const cases = [
    ['사본 없음', () => { tables.t10_note_backups = tables.t10_note_backups.filter(r => r.note_id !== NOTE_B); }, 404],
    ['사본 내용이 바뀜(해시 불일치)', () => { copyOf(NOTE_B).content = '바뀐 사본'; }, 409],
    ['사본 해시가 바뀜', () => { copyOf(NOTE_B).content_sha256 = '0'.repeat(64); }, 409],
    ['사본 모양이 깨짐', () => { copyOf(NOTE_B).content = null; }, 409],
    ['사본 표를 읽지 못함', () => { failTable = 't10_note_backups'; }, 500],
    ['같은 ID가 다른 소유자의 행', () => { row(NOTE_B).owner_id = A; }, 409],
  ];
  for (const [name, breakIt, status] of cases) {
    reset();
    tamper();
    breakIt();
    const snapshot = JSON.stringify(tables.t03_personal_notes);
    const out = await call(restore, { token: 'token-b', query: { id: NOTE_B } });
    assert.equal(out.status, status, name);
    assert.equal(out.body.restored, undefined, name);
    assert.equal(JSON.stringify(tables.t03_personal_notes), snapshot, name);
  }
  assert.doesNotMatch(logs.text(), /B 본문|변조|바뀐 사본/u);
  logs.done();
});

test('복원 중단: 쓰기 직전에 사본을 다시 읽어, 그사이 바뀌었거나 없어졌으면 쓰지 않는다', async () => {
  const logs = quiet();
  const copyOf = id => tables.t10_note_backups.find(r => r.note_id === id);
  const changes = [
    ['두 번째 읽기 전에 사본 내용과 해시가 함께 바뀜', () => {
      Object.assign(copyOf(NOTE_B), backupRow({ id: NOTE_B, ownerId: B, title: '바꿔친 제목', content: '바꿔친 본문' }));
    }],
    ['두 번째 읽기 전에 사본 내용만 바뀜', () => { copyOf(NOTE_B).content = '바꿔친 본문'; }],
    ['두 번째 읽기 전에 사본이 없어짐', () => {
      tables.t10_note_backups = tables.t10_note_backups.filter(r => r.note_id !== NOTE_B);
    }],
  ];
  for (const [name, change] of changes) {
    reset();
    Object.assign(row(NOTE_B), { title: '변조 제목', content: '변조 본문' });
    beforeBackupRead = n => { if (n === 2) change(); };
    const snapshot = JSON.stringify(tables.t03_personal_notes);
    const out = await call(restore, { token: 'token-b', query: { id: NOTE_B } });
    assert.equal(backupReads, 2, name); // 사본을 실제로 두 번 읽었다
    assert.equal(out.status, 409, name);
    assert.deepEqual(out.body, { error: 'backup_verification_failed' }, name);
    assert.equal(JSON.stringify(tables.t03_personal_notes), snapshot, name);
  }
  // 정상 복원도 사본을 두 번 읽는다
  reset();
  beforeBackupRead = () => {};
  assert.equal((await call(restore, { token: 'token-b', query: { id: NOTE_B } })).status, 200);
  assert.equal(backupReads, 2);
  assert.doesNotMatch(logs.text(), /바꿔친|변조/u);
  logs.done();
});

test('복원 거부: 다른 계정의 메모, 비로그인, 다른 메서드, 잘못된 ID', async () => {
  reset();
  const logs = quiet();
  Object.assign(row(NOTE_A), { content: 'A 변조' });
  const snapshot = JSON.stringify(tables.t03_personal_notes);
  const cross = await call(restore, { token: 'token-b', query: { id: NOTE_A } });
  assert.equal(cross.status, 404); // B는 A의 사본으로 A의 메모를 되돌릴 수 없다
  assert.deepEqual(cross.body, { error: 'not_found' });
  assert.equal((await call(restore, { query: { id: NOTE_B } })).status, 401);
  assert.equal((await call(restore, { method: 'PUT', token: 'token-b', query: { id: NOTE_B } })).status, 405);
  assert.equal((await call(restore, { method: 'DELETE', token: 'token-b', query: { id: NOTE_B } })).status, 405);
  assert.equal((await call(restore, { token: 'token-b', query: { id: 'export' } })).status, 400);
  // 요청 본문으로 대상·소유자·내용을 바꿀 수 없다(본문은 읽지 않음)
  const forged = await call(restore, { token: 'token-b', query: { id: NOTE_B },
    body: { owner_id: A, title: '위조', body: '위조', role: 'instructor' } });
  assert.equal(forged.status, 200);
  assert.deepEqual(row(NOTE_B), note(NOTE_B, B, 'B 제목', 'B 본문'));
  // 진단 로그에는 본문 항목의 이름과 종류·길이만 남고 값은 남지 않는다
  assert.match(logs.text(), /"request":\{"body":\{"owner_id":"string:36","title":"string:2","body":"string:2","role":"string:10"\}/u);
  assert.doesNotMatch(logs.text(), /위조|instructor|token-b/u);
  assert.equal(JSON.stringify(tables.t03_personal_notes), snapshot);
  logs.done();
});

test('사본: 메모를 처음 만들 때 한 번 남고, 사본을 남기지 못해도 메모 추가는 성공한다', async () => {
  reset();
  const logs = quiet();
  const made = await call(list, { token: 'token-b', body: { title: '새 제목', body: '새 본문' } });
  assert.equal(made.status, 201);
  const copy = tables.t10_note_backups.find(r => r.note_id === made.body.id);
  assert.deepEqual(copy, backupRow({ id: made.body.id, ownerId: B, title: '새 제목', content: '새 본문' }));

  // 그 메모를 변조한 뒤 복원하면 처음 내용으로 돌아온다
  Object.assign(row(made.body.id), { content: '변조 본문' });
  assert.equal((await call(restore, { token: 'token-b', query: { id: made.body.id } })).status, 200);
  assert.equal(row(made.body.id).content, '새 본문');

  failTable = 't10_note_backups';
  const again = await call(list, { token: 'token-b', body: { title: '또 제목', body: '또 본문' } });
  assert.equal(again.status, 201);
  assert.match(logs.text(), /my-notes backup failed/u);
  assert.doesNotMatch(logs.text(), /새 본문|또 본문/u);
  logs.done();
});

test('미리보기: 실행 전에 사본 버전과 바뀔 항목만 보여 주고 아무것도 쓰지 않는다', async () => {
  reset();
  const logs = quiet();
  const version = { createdAt: null, contentSha256: contentHash('B 제목', 'B 본문') };
  const peek = () => call(restore, { method: 'GET', token: 'token-b', query: { id: NOTE_B } });

  // 변조: 본문만 바뀐 경우
  row(NOTE_B).content = '변조 본문';
  let snapshot = JSON.stringify(tables);
  let out = await peek();
  assert.equal(out.status, 200);
  assert.deepEqual(out.body, { id: NOTE_B, backupVerified: true, backupVersion: version,
    changes: ['body'], restored: false });
  assert.equal(JSON.stringify(tables), snapshot); // 메모·사본 모두 그대로

  // 삭제: 지워진 메모를 다시 만들게 됨
  tables.t03_personal_notes = tables.t03_personal_notes.filter(r => r.id !== NOTE_B);
  snapshot = JSON.stringify(tables);
  out = await peek();
  assert.deepEqual(out.body.changes, ['recreate_deleted_note']);
  assert.equal(JSON.stringify(tables), snapshot);

  // 미리보기도 사본이 없거나 검증에 실패하면 멈춘다. 남의 메모는 보이지 않는다.
  tables.t10_note_backups.find(r => r.note_id === NOTE_B).content_sha256 = '0'.repeat(64);
  assert.equal((await peek()).status, 409);
  assert.equal((await call(restore, { method: 'GET', token: 'token-b', query: { id: NOTE_A } })).status, 404);
  assert.equal((await call(restore, { method: 'GET', query: { id: NOTE_B } })).status, 401);
  assert.doesNotMatch(logs.text() + JSON.stringify(out.body), /B 본문|B 제목|변조/u);
  logs.done();
});

test('복원: 본문의 id가 경로의 ID와 다르면 중단하고, 같으면 그대로 복원한다', async () => {
  reset();
  const logs = quiet();
  row(NOTE_B).content = '변조 본문';
  const snapshot = JSON.stringify(tables.t03_personal_notes);
  const wrong = await call(restore, { token: 'token-b', query: { id: NOTE_B }, body: { id: NOTE_B2 } });
  assert.equal(wrong.status, 400);
  assert.equal(JSON.stringify(tables.t03_personal_notes), snapshot);
  const same = await call(restore, { token: 'token-b', query: { id: NOTE_B }, body: { id: NOTE_B } });
  assert.equal(same.status, 200);
  assert.deepEqual(same.body.changes, ['body']);
  assert.equal(row(NOTE_B).content, 'B 본문');
  // 이미 사본과 같은 메모를 다시 복원하면 바뀔 항목이 없다
  const again = await call(restore, { token: 'token-b', query: { id: NOTE_B } });
  assert.deepEqual([again.status, again.body.changes], [200, []]);
  logs.done();
});
