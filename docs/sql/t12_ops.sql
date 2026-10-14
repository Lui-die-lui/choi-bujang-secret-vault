-- 12단계: 신원 회수 등록부와 접근 사건 기록 (Supabase SQL Editor에서 한 번 실행. 메모 내용·비밀값 없음)
-- 서버 함수(service_role)는 두 표를 조회하고 사건을 추가만 합니다. 회수와 복권은 아래 [회수]·[복권]처럼
-- 관리자가 이 편집기에서 직접 실행할 때뿐이며 이 앱의 API에는 회수 상태를 바꾸는 경로가 없습니다.
-- 기존 표(t02·t03·t10·t11)와 그 행·정책은 바꾸지 않습니다.
-- 주의: 이 SQL을 실행하기 전에는 보호 API가 "회수 등록부를 읽을 수 없음"(503)으로 닫힙니다(fail-closed).

create table if not exists public.t12_revoked_identities (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null,
  reason_code text not null,
  revoked_at timestamptz not null default now(),
  restored_at timestamptz
);
create index if not exists t12_revoked_identities_subject on public.t12_revoked_identities (subject_id);

create table if not exists public.t12_access_events (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  subject_hash text not null,   -- 사용자 번호의 SHA-256 앞 16자리(원본 번호 아님)
  method text not null,
  route text not null,          -- 경로 모양(UUID는 :id로 바꿔 저장), 쿼리·본문 없음
  outcome text not null,        -- allowed | device_not_registered | identity_revoked
  status integer not null,
  request_id text,              -- 서버가 만든 요청 추적 ID
  platform_id text              -- 배포 플랫폼이 붙인 요청 ID(있을 때만)
);
create index if not exists t12_access_events_subject_at on public.t12_access_events (subject_hash, at desc);

alter table public.t12_revoked_identities enable row level security;
alter table public.t12_access_events enable row level security;
revoke all on table public.t12_revoked_identities from public, anon, authenticated, service_role;
revoke all on table public.t12_access_events from public, anon, authenticated, service_role;
grant select on table public.t12_revoked_identities to service_role;
grant select, insert on table public.t12_access_events to service_role;

-- 확인: 표 권한 (revoked는 SELECT만, events는 SELECT·INSERT만 있어야 합니다)
select table_name, grantee, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name in ('t12_revoked_identities', 't12_access_events')
order by table_name, grantee, privilege_type;

-- [회수] 시험 계정 한 명의 신원을 회수합니다. 'USER-UUID'를 그 사용자의 번호로 바꿉니다.
-- insert into public.t12_revoked_identities (subject_id, reason_code) values ('USER-UUID', 'operator_revoke');

-- [복권] 회수를 거둡니다(기록은 남기고 restored_at만 채움).
-- update public.t12_revoked_identities set restored_at = now()
-- where subject_id = 'USER-UUID' and restored_at is null;

-- [확인] 회수 기록과 최근 사건 수
-- select left(subject_id::text, 8) as subject, reason_code, revoked_at, restored_at from public.t12_revoked_identities order by revoked_at desc;
-- select outcome, count(*) from public.t12_access_events where at > now() - interval '1 hour' group by outcome;
