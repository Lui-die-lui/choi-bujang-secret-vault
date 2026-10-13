-- 11단계: 기기 승인 등록부 (Supabase SQL Editor에서 한 번 실행. 메모 내용·비밀값 없음)
-- 기기의 공개키와 승인 상태만 담습니다. 기기의 개인키는 이 표에도, 브라우저 저장소에도 없고
-- 기기의 인증 장치(패스키) 안에만 있습니다.
-- 서버 함수(service_role)는 조회와 "pending" 행 추가만 합니다. 상태를 바꾸는 것은 아래
-- [승인]·[회수]처럼 관리자가 이 편집기에서 직접 실행할 때뿐입니다.
-- 기존 표(t02_vault_notes, t03_personal_notes, t10_*)와 그 행·정책은 바꾸지 않습니다.

create table if not exists public.t11_devices (
  credential_id text primary key,
  owner_id uuid not null,
  public_key_spki text not null,
  alg integer not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'revoked')),
  created_at timestamptz not null default now(),
  approved_at timestamptz
);

alter table public.t11_devices enable row level security;
revoke all on table public.t11_devices from public, anon, authenticated, service_role;
grant select, insert on table public.t11_devices to service_role;

-- 확인: 표 권한 (service_role에 SELECT·INSERT만 있어야 합니다)
select grantee, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name = 't11_devices' order by grantee, privilege_type;

-- [목록] 승인을 기다리는 기기 보기. code는 화면에 보이는 "이 기기의 확인 코드"와 같습니다.
-- select left(encode(sha256(convert_to(credential_id, 'UTF8')), 'hex'), 8) as code,
--        left(owner_id::text, 8) as owner, status, created_at
-- from public.t11_devices order by created_at;

-- [승인] 화면의 확인 코드와 같은 기기 한 대만 승인합니다. 'xxxxxxxx'를 그 코드로 바꿉니다.
-- update public.t11_devices set status = 'approved', approved_at = now()
-- where left(encode(sha256(convert_to(credential_id, 'UTF8')), 'hex'), 8) = 'xxxxxxxx' and status = 'pending';

-- [회수] 승인을 거둡니다. 그 기기의 다음 요청부터 자료가 닫힙니다.
-- update public.t11_devices set status = 'revoked'
-- where left(encode(sha256(convert_to(credential_id, 'UTF8')), 'hex'), 8) = 'xxxxxxxx';
