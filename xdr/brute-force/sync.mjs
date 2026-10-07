// npm run xdr:sync -- brute-force [--probe|--confirm]
// 운영 DB(Supabase xdr_brute_force_blocklist)에 손대는 유일한 명령입니다.
// npm run xdr:run은 이 파일을 전혀 부르지 않고, 이 파일도 xdr:run을 자동으로
// 실행하지 않습니다 — 합성 시험 자료가 운영 표에 자동으로 섞여 들어가는 것을
// 막기 위해 둘을 완전히 분리했습니다.
//
// 모드:
//   (플래그 없음) — 미리보기만. DB에 아무것도 쓰지 않음(기본값, 안전).
//   --probe       — 실제 DB 왕복 1회만 자체 점검: 표시용 행 1개를 넣고
//                    → src/xdr-login-guard.mjs의 실제 운영 저장소로 조회해
//                    맞게 읽히는지 확인하고 → 그 행을 지웁니다. 운영 차단
//                    목록에는 끝나고 나면 아무것도 남지 않습니다.
//   --confirm     — xdr/brute-force/blocklist.json(로컬 시험 결과)의 만료
//                    되지 않은 행을 실제로 운영 표에 올립니다. 지금 이
//                    저장소에는 합성 fixture만 있어, --confirm을 쓰면 RFC 5737
//                    문서용 주소가 올라갑니다(실제 사용자 IP와 절대 겹치지
//                    않지만, 운영 표를 깨끗이 두려면 --probe만 쓰는 걸
//                    권장합니다).
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSupabaseBlocklistStore, isSourceBlocked } from '../../src/xdr-login-guard.mjs';
import { loadBlocklist, pruneExpired } from './block-rules.mjs';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const blocklistPath = resolve(moduleDir, 'blocklist.json');

function readEnv() {
  return { supabaseUrl: process.env.SUPABASE_URL, supabaseSecretKey: process.env.SUPABASE_SECRET_KEY };
}

function requireEnv() {
  const env = readEnv();
  if (!env.supabaseUrl || !env.supabaseSecretKey) {
    process.stderr.write('SUPABASE_URL/SUPABASE_SECRET_KEY 환경변수가 없어 실제 DB에 연결할 수 없습니다. Vercel/로컬 환경변수 화면에 직접 넣어 주세요(이 코드에는 적지 않습니다).\n');
    process.exitCode = 1;
    return null;
  }
  return env;
}

async function probe() {
  const env = requireEnv();
  if (!env) return;
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(env.supabaseUrl, env.supabaseSecretKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });

  const sentinelIp = '203.0.113.123'; // RFC 5737 문서용 주소. 실제 사용자 IP와 절대 겹치지 않음.
  const reason = 'xdr-sync-self-probe';
  const expiresAt = new Date(Date.now() + 2 * 60 * 1000).toISOString();

  const { error: upsertError } = await supabase
    .from('xdr_brute_force_blocklist')
    .upsert({ source_ip: sentinelIp, expires_at: expiresAt, basis_alert_ids: ['PROBE'], reason });
  if (upsertError) {
    process.stderr.write(`probe 행 추가 실패: ${upsertError.message}\n`);
    process.exitCode = 1;
    return;
  }

  const store = createSupabaseBlocklistStore(env);
  const blockedDuringWindow = await isSourceBlocked({ store, sourceIp: sentinelIp, nowMs: Date.now() });

  const { error: deleteError } = await supabase
    .from('xdr_brute_force_blocklist')
    .delete()
    .eq('source_ip', sentinelIp)
    .eq('reason', reason);
  if (deleteError) {
    process.stderr.write(`probe 행 삭제 실패 — SQL Editor에서 직접 지워 주세요: delete from public.xdr_brute_force_blocklist where reason = '${reason}'; (${deleteError.message})\n`);
  }

  process.stdout.write(`probe 완료: 실제 Supabase 표에 시험 행 1개를 넣고 지웠습니다. 운영 저장소(src/xdr-login-guard.mjs)가 차단 중으로 읽었는가: ${blockedDuringWindow} (기대값 true)\n`);
  if (!blockedDuringWindow) process.exitCode = 1;
}

async function confirmSync() {
  const env = requireEnv();
  if (!env) return;
  const blocklist = pruneExpired(loadBlocklist(blocklistPath), Date.now());
  if (!blocklist.length) {
    process.stdout.write('로컬 xdr/brute-force/blocklist.json에 만료되지 않은 행이 없어 올릴 것이 없습니다.\n');
    return;
  }
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(env.supabaseUrl, env.supabaseSecretKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  for (const entry of blocklist) {
    const { error } = await supabase.from('xdr_brute_force_blocklist').upsert({
      source_ip: entry.sourceIp,
      expires_at: new Date(entry.expiresAtMs).toISOString(),
      basis_alert_ids: entry.basisAlertIds,
      reason: entry.reason,
    });
    if (error) {
      process.stderr.write(`동기화 실패(${entry.sourceIp}): ${error.message}\n`);
      process.exitCode = 1;
      return;
    }
  }
  process.stdout.write(`운영 표에 ${blocklist.length}개 주소를 올렸습니다: ${blocklist.map((entry) => entry.sourceIp).join(', ')}\n`);
}

function dryRun() {
  const blocklist = pruneExpired(loadBlocklist(blocklistPath), Date.now());
  process.stdout.write(`미리보기만 합니다(DB에 아무것도 쓰지 않음) — 로컬 blocklist.json의 만료되지 않은 주소 ${blocklist.length}개:\n`);
  for (const entry of blocklist) {
    process.stdout.write(`  ${entry.sourceIp} · 만료 ${new Date(entry.expiresAtMs).toISOString()} · 근거 ${entry.basisAlertIds.join(',')}\n`);
  }
  process.stdout.write('운영 DB 연결 자체만 확인하려면 --probe, 위 목록을 실제로 올리려면 --confirm을 붙여 다시 실행하세요.\n');
}

export async function run() {
  if (process.argv.includes('--probe')) await probe();
  else if (process.argv.includes('--confirm')) await confirmSync();
  else dryRun();
}
