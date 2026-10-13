// 10단계 정책 복원 시험. 임시 폴더에 가상 시험 정책과 안전 사본을 만들어 확인합니다.
// 운영 판정기(src/decider.mjs)나 실제 정책은 읽지도 쓰지도 않습니다. 실행: npm run test:policy
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { allowsNoteRequest, planRestore, readTestPolicy, restoreService, sha256 } from '../scripts/policy-restore.mjs';

const SCHEMA = 'choi-vault.test-policy.v1';
const safe = () => ({ schema: SCHEMA, revision: 8, verifiedAt: '2026-10-13T00:00:00Z', services: {
  notes: { ownerOnly: true, listAll: false, methods: ['GET', 'PUT'] },
  announcements: { write: false },
} });
const breached = () => ({ schema: SCHEMA, revision: 10, services: {
  notes: { ownerOnly: false, listAll: true, methods: ['GET', 'PUT', 'DELETE'] },
  announcements: { write: true }, // 다른 서비스: 이번 복원 대상이 아니면 그대로 남아야 함
  detect: { burstReadLimit: 120 }, // 사본에 없는 서비스
}, audit: [{ at: '2026-10-01T00:00:00Z', action: 'policy_verified', toRevision: 8 }] });

function fixture({ manifest = true, backup = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'policy-restore-test-'));
  mkdirSync(join(root, 'policy'));
  const raw = `${JSON.stringify(safe(), null, 2)}\n`;
  if (backup) writeFileSync(join(root, 'policy', 'safe-policy.json'), raw);
  if (manifest) {
    writeFileSync(join(root, 'policy', 'safe-policy.manifest.json'), JSON.stringify({
      backupFile: 'policy/safe-policy.json', revision: 8, sha256: sha256(raw) }));
  }
  writeFileSync(join(root, 'policy', 'test-policy.json'), `${JSON.stringify(breached(), null, 2)}\n`);
  return root;
}
const read = root => readFileSync(join(root, 'policy', 'test-policy.json'), 'utf8');
const cleanup = root => rmSync(root, { recursive: true, force: true });

test('미리보기: 복원할 버전과 바뀔 항목을 보여 주고 아무것도 쓰지 않는다', () => {
  const root = fixture();
  try {
    const before = read(root);
    const plan = planRestore(root);
    assert.deepEqual(plan.version, { revision: 8, verifiedAt: '2026-10-13T00:00:00Z', sha256: plan.backupHash });
    assert.deepEqual(plan.services.find(s => s.name === 'notes').changes.map(c => c.key).sort(),
      ['listAll', 'methods', 'ownerOnly']);
    assert.deepEqual(plan.onlyInTestPolicy, ['detect']);
    assert.equal(restoreService(root, 'notes').applied, false); // 확인 없이는 쓰지 않음
    assert.equal(read(root), before);
    assert.deepEqual(readdirSync(join(root, 'policy')).sort(),
      ['safe-policy.json', 'safe-policy.manifest.json', 'test-policy.json']);
  } finally { cleanup(root); }
});

test('복원: 지정한 서비스 규칙만 되돌리고 다른 서비스 규칙과 감사 이력은 보존한다', () => {
  const root = fixture();
  try {
    const before = breached();
    assert.equal(allowsNoteRequest(before, { actor: 'B', owner: 'A' }), true); // 침해 상태: B가 A 자료를 읽음
    const result = restoreService(root, 'notes', { confirm: true, now: new Date('2026-10-13T09:00:00Z') });
    assert.equal(result.applied, true);
    const { policy } = readTestPolicy(root);
    assert.deepEqual(policy.services.notes, safe().services.notes);
    assert.deepEqual(policy.services.announcements, before.services.announcements); // 다른 서비스 규칙 그대로
    assert.deepEqual(policy.services.detect, before.services.detect);
    assert.deepEqual(policy.audit.slice(0, 1), before.audit); // 이전 감사 이력 그대로
    assert.equal(policy.audit.length, 2);
    assert.deepEqual(policy.audit[1], { at: '2026-10-13T09:00:00.000Z', action: 'policy_restored', service: 'notes',
      toRevision: 8, backupSha256: result.plan.backupHash, changedKeys: ['ownerOnly', 'listAll', 'methods'] });
    assert.equal(policy.revision, before.revision);
    // B의 A 자료 요청은 다시 거부, A의 정상 요청은 유지
    assert.equal(allowsNoteRequest(policy, { actor: 'B', owner: 'A' }), false);
    assert.equal(allowsNoteRequest(policy, { actor: 'A', owner: 'A' }), true);
    assert.equal(allowsNoteRequest(policy, { actor: 'A', owner: 'A', method: 'DELETE' }), false);
    // 이미 사본과 같으면 다시 실행해도 아무것도 쓰지 않는다(감사 이력도 늘지 않음)
    const again = read(root);
    assert.equal(restoreService(root, 'notes', { confirm: true }).applied, false);
    assert.equal(read(root), again);
  } finally { cleanup(root); }
});

test('중단: 사본 기록·사본 파일이 없거나 검증에 실패하면 시험 정책을 바꾸지 않는다', () => {
  const cases = [
    ['사본 기록 없음', { manifest: false }, () => {}],
    ['사본 파일 없음', { backup: false }, () => {}],
    ['사본 내용이 바뀜(SHA-256 불일치)', {}, root => {
      writeFileSync(join(root, 'policy', 'safe-policy.json'),
        `${JSON.stringify({ ...safe(), services: { notes: { ownerOnly: false } } })}\n`);
    }],
    ['사본 버전이 기록과 다름', {}, root => {
      const raw = `${JSON.stringify({ ...safe(), revision: 9 })}\n`;
      writeFileSync(join(root, 'policy', 'safe-policy.json'), raw);
      writeFileSync(join(root, 'policy', 'safe-policy.manifest.json'), JSON.stringify({
        backupFile: 'policy/safe-policy.json', revision: 8, sha256: sha256(raw) }));
    }],
    ['사본에 없는 서비스를 지정', {}, () => {}, 'detect'],
  ];
  for (const [name, options, breakIt, service = 'notes'] of cases) {
    const root = fixture(options);
    try {
      breakIt(root);
      const before = read(root);
      assert.throws(() => restoreService(root, service, { confirm: true }), /중단/u, name);
      assert.equal(read(root), before, name);
    } finally { cleanup(root); }
  }
});

test('중단: 미리보기 뒤 쓰기 직전에 사본을 다시 읽어, 그사이 바뀌었으면 쓰지 않는다', () => {
  // 사본과 기록을 함께 바꿔치기해도(해시는 서로 맞음) 미리보기 때와 다르면 멈춘다
  const root = fixture();
  try {
    const before = read(root);
    const preview = planRestore(root);
    const swapped = `${JSON.stringify({ ...safe(), services: { ...safe().services, notes: { ownerOnly: false } } })}\n`;
    writeFileSync(join(root, 'policy', 'safe-policy.json'), swapped);
    writeFileSync(join(root, 'policy', 'safe-policy.manifest.json'), JSON.stringify({
      backupFile: 'policy/safe-policy.json', revision: 8, sha256: sha256(swapped) }));
    assert.throws(() => restoreService(root, 'notes', { confirm: true, preview }), /사본이 바뀌었습니다/u);
    assert.equal(read(root), before);
  } finally { cleanup(root); }

  // 미리보기 뒤 시험 정책이 바뀐 경우에도 멈춘다
  const other = fixture();
  try {
    const preview = planRestore(other);
    const changed = `${JSON.stringify({ ...breached(), revision: 11 }, null, 2)}\n`;
    writeFileSync(join(other, 'policy', 'test-policy.json'), changed);
    assert.throws(() => restoreService(other, 'notes', { confirm: true, preview }), /시험 정책이 바뀌었습니다/u);
    assert.equal(read(other), changed);
  } finally { cleanup(other); }
});
