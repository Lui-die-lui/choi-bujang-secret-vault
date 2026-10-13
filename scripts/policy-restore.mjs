import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// 10단계: 침해 전에 검증한 안전 정책 사본과 지금의 시험 정책(이 폴더의 src/decider.mjs)을
// 비교하고, --confirm을 붙였을 때만 그 파일 하나를 안전 버전으로 되돌립니다.
//  - 안전 사본: backup/policy-safe.json이 가리키는 Git 커밋의 판정기 파일. 내용의 SHA-256이
//    기록과 다르거나 사본을 읽지 못하면 아무것도 바꾸지 않고 중단합니다.
//  - 바꾸는 것은 판정기 파일 하나뿐입니다. 다른 파일, Git 기록(커밋·로그), 배포된 앱,
//    반 엔진의 운영 정책에는 접근하지 않습니다. git reset도 쓰지 않습니다.
const root = resolve(import.meta.dirname, '..');
const confirm = process.argv.includes('--confirm');
const fail = message => { throw new Error(message); };
const git = (...args) => execFileSync('git', ['-C', root, ...args], {
  encoding: 'buffer', timeout: 5000, maxBuffer: 4 * 1024 * 1024, windowsHide: true,
  stdio: ['ignore', 'pipe', 'ignore'],
});
const lf = text => text.replace(/\r\n/gu, '\n');
const sha256 = text => createHash('sha256').update(text, 'utf8').digest('hex');

async function ruleIds(source, dir, name) {
  const file = join(dir, name);
  writeFileSync(file, source, 'utf8');
  const { RULE_IDS } = await import(pathToFileURL(file).href);
  return Array.isArray(RULE_IDS) ? [...RULE_IDS] : fail('RULE_IDS를 읽지 못했습니다.');
}

try {
  // 1) 안전 사본 기록 읽기와 검증
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(root, 'backup', 'policy-safe.json'), 'utf8'));
  } catch {
    fail('안전 정책 사본 기록(backup/policy-safe.json)을 읽지 못했습니다. 복원을 중단합니다.');
  }
  if (manifest.policyFile !== 'src/decider.mjs' || !/^[0-9a-f]{40}$/u.test(manifest.version ?? '')
      || !/^[0-9a-f]{64}$/u.test(manifest.sha256 ?? '')) {
    fail('안전 정책 사본 기록의 형식이 맞지 않습니다. 복원을 중단합니다.');
  }
  let safe;
  try {
    safe = lf(git('show', `${manifest.version}:${manifest.policyFile}`).toString('utf8'));
  } catch {
    fail('안전 정책 사본을 Git에서 읽지 못했습니다. 복원을 중단합니다.');
  }
  if (sha256(safe) !== manifest.sha256) {
    fail('안전 정책 사본의 SHA-256이 기록과 다릅니다(사본 검증 실패). 복원을 중단합니다.');
  }

  // 2) 지금의 시험 정책과 비교
  const target = join(root, manifest.policyFile);
  const raw = readFileSync(target, 'utf8');
  const current = lf(raw);
  process.stdout.write(`복원할 안전 정책 버전: ${manifest.version.slice(0, 12)} (${manifest.policyFile})\n`);
  process.stdout.write(`사본 검증: SHA-256 일치 (${manifest.sha256.slice(0, 12)}…)\n`);
  if (current === safe) {
    process.stdout.write('차이 없음: 지금의 시험 정책이 안전 정책 사본과 같습니다. 바꿀 것이 없습니다.\n');
  } else {
    const dir = mkdtempSync(join(tmpdir(), 'policy-restore-'));
    try {
      const [safeRules, currentRules] = [await ruleIds(safe, dir, 'safe.mjs'),
        await ruleIds(current, dir, 'current.mjs')];
      const dropped = currentRules.filter(id => !safeRules.includes(id));
      const returned = safeRules.filter(id => !currentRules.includes(id));
      process.stdout.write(`규칙 이름 — 복원하면 사라짐: ${dropped.join(', ') || '없음'} / 복원하면 돌아옴: ${returned.join(', ') || '없음'}\n`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    const safeLines = safe.split('\n');
    const currentLines = current.split('\n');
    const removed = currentLines.filter(line => !safeLines.includes(line));
    const added = safeLines.filter(line => !currentLines.includes(line));
    process.stdout.write(`바뀔 항목 (${manifest.policyFile} 한 파일): 사라질 줄 ${removed.length}개 · 돌아올 줄 ${added.length}개\n`);
    for (const line of removed) process.stdout.write(`  - ${line.trim()}\n`);
    for (const line of added) process.stdout.write(`  + ${line.trim()}\n`);

    // 3) 확인을 거친 경우에만 그 파일 하나를 되돌립니다
    if (confirm) {
      // 줄바꿈 모양은 지금 파일의 것을 따릅니다(Git이 내용 변화로 보지 않도록).
      writeFileSync(target, raw.includes('\r\n') ? safe.replace(/\n/gu, '\r\n') : safe, 'utf8');
      if (sha256(lf(readFileSync(target, 'utf8'))) !== manifest.sha256) fail('복원 뒤 검증에 실패했습니다.');
      process.stdout.write('복원 완료: 시험 정책이 안전 정책 사본과 같아졌습니다. 다른 파일과 Git 기록은 그대로입니다.\n');
    } else {
      process.stdout.write('미리보기만 했습니다(아무것도 바꾸지 않음). 되돌리려면: npm run policy:restore -- --confirm\n');
    }
  }
  process.stdout.write('이 명령은 이 폴더의 시험 정책만 다루며 운영 정책·심판 판정과 무관합니다.\n');
} catch (error) {
  process.stderr.write(`정책 복원 첫 오류: ${error.message}\n`);
  process.exitCode = 1;
}
