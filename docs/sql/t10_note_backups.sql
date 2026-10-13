-- 10단계: 비공개 가상 메모 사본 표 (Supabase SQL Editor에서 한 번 실행. 메모 내용·비밀값 없음)
-- 서버 함수(service_role)만 읽고 씁니다. anon·authenticated의 직접 접근은 막습니다.
-- 기존 표(t02_vault_notes, t03_personal_notes)와 그 행·정책은 바꾸지 않습니다.

create table if not exists public.t10_note_backups (
  note_id uuid primary key,
  owner_id uuid not null,
  title text not null,
  content text not null,
  content_sha256 text not null,
  created_at timestamptz not null default now()
);

alter table public.t10_note_backups enable row level security;
revoke all on table public.t10_note_backups from public, anon, authenticated;
grant select, insert on table public.t10_note_backups to service_role;

-- 지금 있는 가상 메모의 사본을 한 번 만듭니다(이미 사본이 있는 메모는 건너뜀).
-- 해시 식은 src/note-backup.mjs의 contentHash와 같아야 합니다:
--   sha256( <제목 바이트 길이> || ':' || 제목 || 본문 )
insert into public.t10_note_backups (note_id, owner_id, title, content, content_sha256)
select id, owner_id, title, content,
       encode(sha256(convert_to(octet_length(title)::text || ':' || title || content, 'UTF8')), 'hex')
from public.t03_personal_notes
on conflict (note_id) do nothing;

-- 확인: 사본 수와 표 권한 (본문은 조회하지 않습니다)
select count(*) as backup_count from public.t10_note_backups;
select grantee, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name = 't10_note_backups' order by grantee, privilege_type;
