-- 10단계: 메모 복원 감사 기록 표 (Supabase SQL Editor에서 한 번 실행. 메모 내용·비밀값 없음)
-- 복원 시도마다 한 줄씩 덧붙이기만 합니다. 서버 함수(service_role)도 조회·추가만 할 수 있고
-- 고치거나 지울 수 없습니다. 메모 제목·본문은 담지 않습니다(ID·결과·내용 해시만).
-- 기존 표(t02_vault_notes, t03_personal_notes, t10_note_backups)와 그 행·정책은 바꾸지 않습니다.

create table if not exists public.t10_restore_audit (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  note_id uuid not null,
  owner_id uuid not null,
  outcome text not null,
  reason text,
  backup_sha256 text,
  before_sha256 text,
  after_sha256 text
);

alter table public.t10_restore_audit enable row level security;
revoke all on table public.t10_restore_audit from public, anon, authenticated, service_role;
grant select, insert on table public.t10_restore_audit to service_role;

-- 확인: 표 권한 (service_role에 SELECT·INSERT만 있어야 합니다)과 지금까지의 기록 수
select grantee, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name = 't10_restore_audit' order by grantee, privilege_type;
select count(*) as audit_count from public.t10_restore_audit;
