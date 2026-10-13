import { createHash } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// 10단계: 침해 전에 검증한 안전 정책 사본과 지금의 시험 정책을 비교하고, 확인을 거쳐
// 지정한 서비스의 규칙만 안전 버전으로 되돌립니다.
//  - 시험 정책: policy/test-policy.json (가상 시험용 정책. 서비스별 규칙과 감사 이력을 담음)
//  - 안전 사본: policy/safe-policy.json, 그 SHA-256과 버전은 policy/safe-policy.manifest.json에 따로 보관
//  - 사본 기록이 없거나, 사본 파일이 없거나, SHA-256·버전이 기록과 다르면 아무것도 바꾸지 않고 중단
//  - 쓰는 파일은 policy/test-policy.json 하나뿐입니다. 실제 운영 정책(src/decider.mjs), 배포된 앱,
//    반 엔진의 정책에는 접근하지 않습니다(읽지도 쓰지도 않음).
//  - 복원은 지정한 서비스의 규칙만 바꿉니다. 다른 서비스 규칙과 이미 있던 감사 이력은 그대로 두고,
//    감사 이력에는 이번 복원 한 줄만 덧붙입니다.
const POLICY_DIR = 'policy';
const TEST_POLICY = 'test-policy.json';
const SAFE_POLICY = 'safe-policy.json';
const MANIFEST = 'safe-policy.manifest.json';
const SCHEMA = 'choi-vault.test-policy.v1';

const stop = message => { throw new Error(message); };
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const lf = text => text.replace(/\r\n/gu, '\n');
export const sha256 = text => createHash('sha256').update(lf(text), 'utf8').digest('hex');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// 안전 사본을 저장된 파일에서 읽어 검증합니다. 부를 때마다 새로 읽습니다.
export function readVerifiedBackup(root) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(root, POLICY_DIR, MANIFEST), 'utf8'));
  } catch {
    stop('안전 정책 사본 기록(policy/safe-policy.manifest.json)을 읽지 못했습니다. 복원을 중단합니다.');
  }
  if (!isObject(manifest) || manifest.backupFile !== `${POLICY_DIR}/${SAFE_POLICY}`
      || !Number.isInteger(manifest.revision) || !/^[0-9a-f]{64}$/u.test(manifest.sha256 ?? '')) {
    stop('안전 정책 사본 기록의 형식이 맞지 않습니다. 복원을 중단합니다.');
  }
  let raw;
  try {
    raw = readFileSync(join(root, POLICY_DIR, SAFE_POLICY), 'utf8');
  } catch {
    stop('안전 정책 사본(policy/safe-policy.json)이 없습니다. 복원을 중단합니다.');
  }
  const hash = sha256(raw);
  if (hash !== manifest.sha256) stop('안전 정책 사본의 SHA-256이 기록과 다릅니다(사본 검증 실패). 복원을 중단합니다.');
  let backup;
  try { backup = JSON.parse(raw); } catch { stop('안전 정책 사본을 해석하지 못했습니다. 복원을 중단합니다.'); }
  if (!isObject(backup) || backup.schema !== SCHEMA || backup.revision !== manifest.revision
      || !isObject(backup.services) || !Object.values(backup.services).every(isObject)) {
    stop('안전 정책 사본의 버전·형식이 기록과 다릅니다(사본 검증 실패). 복원을 중단합니다.');
  }
  return { backup, hash };
}

export function readTestPolicy(root) {
  let raw;
  try { raw = readFileSync(join(root, POLICY_DIR, TEST_POLICY), 'utf8'); } catch {
    stop('시험 정책(policy/test-policy.json)을 읽지 못했습니다.');
  }
  let policy;
  try { policy = JSON.parse(raw); } catch { stop('시험 정책을 해석하지 못했습니다.'); }
  if (!isObject(policy) || policy.schema !== SCHEMA || !isObject(policy.services) || !Array.isArray(policy.audit)) {
    stop('시험 정책의 형식이 맞지 않습니다.');
  }
  return { policy, hash: sha256(raw) };
}

// 실행 전에 보여 줄 내용: 복원할 버전과, 서비스별로 바뀔 규칙 항목.
export function planRestore(root) {
  const { backup, hash } = readVerifiedBackup(root);
  const { policy, hash: currentHash } = readTestPolicy(root);
  const services = Object.keys(backup.services).map(name => {
    const safe = backup.services[name];
    const current = policy.services[name] ?? {};
    const changes = [...new Set([...Object.keys(safe), ...Object.keys(current)])]
      .filter(key => !same(safe[key], current[key]))
      .map(key => ({ key, from: current[key] ?? null, to: safe[key] ?? null }));
    return { name, changes };
  });
  return {
    version: { revision: backup.revision, verifiedAt: backup.verifiedAt ?? null, sha256: hash },
    currentRevision: policy.revision ?? null,
    services,
    // 사본에 없는 서비스(사본을 검증한 뒤에 생긴 규칙)는 비교·복원 대상이 아닙니다.
    onlyInTestPolicy: Object.keys(policy.services).filter(name => !(name in backup.services)),
    auditEntries: policy.audit.length,
    backupHash: hash,
    currentHash,
  };
}

// 지정한 서비스 하나의 규칙만 안전 버전으로 되돌립니다. confirm이 참일 때만 씁니다.
// preview: 앞서 본 미리보기(planRestore 결과)를 넘기면 그때의 사본·시험 정책과 대조합니다.
export function restoreService(root, service, { confirm = false, now = new Date(), preview } = {}) {
  const plan = preview ?? planRestore(root);
  const target = plan.services.find(item => item.name === service);
  if (!target) stop(`안전 정책 사본에 "${service}" 서비스가 없습니다. 복원을 중단합니다.`);
  if (!confirm || !target.changes.length) return { plan, target, applied: false };

  // 쓰기 직전에 사본과 시험 정책을 다시 읽어 다시 검증합니다. 미리보기 뒤에 달라졌으면 중단합니다.
  const { backup, hash } = readVerifiedBackup(root);
  const { policy, hash: currentHash } = readTestPolicy(root);
  if (hash !== plan.backupHash) stop('미리보기 뒤에 안전 정책 사본이 바뀌었습니다. 복원을 중단합니다.');
  if (currentHash !== plan.currentHash) stop('미리보기 뒤에 시험 정책이 바뀌었습니다. 다시 미리보기부터 실행하세요.');

  const entry = {
    at: now.toISOString(), action: 'policy_restored', service,
    toRevision: backup.revision, backupSha256: hash, changedKeys: target.changes.map(item => item.key),
  };
  const next = {
    ...policy,
    services: { ...policy.services, [service]: structuredClone(backup.services[service]) },
    audit: [...policy.audit, entry],
  };
  const file = join(root, POLICY_DIR, TEST_POLICY);
  writeFileSync(`${file}.tmp`, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  renameSync(`${file}.tmp`, file);

  // 쓴 뒤 다시 읽어 확인: 대상 서비스는 사본과 같고, 다른 서비스 규칙과 이전 감사 이력은 그대로여야 합니다.
  const { policy: written } = readTestPolicy(root);
  const othersKept = Object.keys(policy.services).filter(name => name !== service)
    .every(name => same(written.services[name], policy.services[name]));
  const auditKept = same(written.audit.slice(0, policy.audit.length), policy.audit)
    && written.audit.length === policy.audit.length + 1;
  if (!same(written.services[service], backup.services[service]) || !othersKept || !auditKept) {
    stop('복원 뒤 검증에 실패했습니다.');
  }
  return { plan, target, applied: true, entry, otherServices: Object.keys(policy.services).filter(name => name !== service) };
}

// 시험 정책의 메모 규칙으로 가상 요청을 판단합니다(운영 판정기가 아닙니다).
export function allowsNoteRequest(policy, { actor, owner, method = 'GET' }) {
  const rule = policy.services?.notes;
  if (!isObject(rule) || !Array.isArray(rule.methods) || !rule.methods.includes(method)) return false;
  return rule.ownerOnly === true ? actor === owner : true;
}

function printPlan(plan, service) {
  const out = [];
  out.push(`복원할 안전 정책 버전: revision ${plan.version.revision} (검증 시각 ${plan.version.verifiedAt ?? '기록 없음'})`);
  out.push(`사본 검증: SHA-256 일치 (${plan.version.sha256.slice(0, 12)}…) · 지금의 시험 정책 revision ${plan.currentRevision}`);
  out.push('바뀔 항목(실행 전 확인):');
  for (const item of plan.services) {
    const mark = service && item.name !== service ? ' — 이번 복원 대상 아님(그대로 둠)' : '';
    if (!item.changes.length) { out.push(`  ${item.name}: 사본과 같음${mark}`); continue; }
    out.push(`  ${item.name}: ${item.changes.length}개 항목이 사본과 다름${mark}`);
    for (const change of item.changes) {
      out.push(`    ${change.key}: ${JSON.stringify(change.from)} → ${JSON.stringify(change.to)}`);
    }
  }
  if (plan.onlyInTestPolicy.length) out.push(`  사본에 없는 서비스(그대로 둠): ${plan.onlyInTestPolicy.join(', ')}`);
  out.push(`감사 이력: 지금 ${plan.auditEntries}줄 (복원하면 한 줄만 덧붙이고 이전 줄은 그대로 둠)`);
  process.stdout.write(`${out.join('\n')}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(import.meta.dirname, '..');
  const args = process.argv.slice(2);
  const confirm = args.includes('--confirm');
  const service = args.includes('--service') ? args[args.indexOf('--service') + 1] : null;
  const check = label => {
    const { policy } = readTestPolicy(root);
    process.stdout.write(`${label} — B의 A 메모 읽기: ${allowsNoteRequest(policy, { actor: 'B', owner: 'A' }) ? '허용' : '거부'}`
      + ` / A의 자기 메모 읽기: ${allowsNoteRequest(policy, { actor: 'A', owner: 'A' }) ? '허용' : '거부'}\n`);
  };
  try {
    if (confirm && !service) stop('되돌릴 서비스를 지정하세요: npm run policy:restore -- --service notes --confirm');
    const result = service ? restoreService(root, service, { confirm }) : { plan: planRestore(root), applied: false };
    printPlan(result.plan, service);
    if (result.applied) {
      process.stdout.write(`복원 완료: "${service}" 서비스의 규칙 ${result.entry.changedKeys.length}개 항목을 안전 버전으로 되돌렸습니다.\n`
        + `그대로 둔 서비스: ${result.otherServices.join(', ') || '없음'} · 감사 이력 한 줄 추가(이전 ${result.plan.auditEntries}줄 보존)\n`);
      check('복원 뒤 시험 정책');
    } else {
      check('지금의 시험 정책');
      if (service && !result.target.changes.length) process.stdout.write(`"${service}" 서비스는 이미 사본과 같습니다. 바꿀 것이 없습니다.\n`);
      else process.stdout.write('미리보기만 했습니다(아무것도 바꾸지 않음). 되돌리려면: npm run policy:restore -- --service <서비스 이름> --confirm\n');
    }
    process.stdout.write('이 명령은 policy/test-policy.json(시험 정책)만 다루며 운영 정책(src/decider.mjs)·심판 판정과 무관합니다.\n');
  } catch (error) {
    process.stderr.write(`정책 복원 첫 오류: ${error.message}\n`);
    process.exitCode = 1;
  }
}
