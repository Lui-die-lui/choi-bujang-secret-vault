-- 10단계: 복원 전후 확인용 조회 (읽기 전용. 아무것도 바꾸지 않고, 제목·본문은 출력하지 않습니다)
-- Supabase SQL Editor에서 실행합니다.

-- [가] 복원 전에 실행: 감사 기록 수와 메모 수
select (select count(*) from public.t10_restore_audit) as audit_rows,
       (select count(*) from public.t03_personal_notes) as note_rows;

-- [나] 복원 뒤에 실행: 아래 한 줄의 ID를 복원한 메모의 ID로 바꿉니다.
with target as (select '00000000-0000-4000-8000-000000000000'::uuid as note_id)
select
  -- 복원한 한 건: 메모 표와 사본 표의 ID·소유자·내용 해시가 같은지
  (select n.id = b.note_id from public.t03_personal_notes n
     join public.t10_note_backups b on b.note_id = n.id, target t where n.id = t.note_id) as same_id,
  (select n.owner_id = b.owner_id from public.t03_personal_notes n
     join public.t10_note_backups b on b.note_id = n.id, target t where n.id = t.note_id) as same_owner,
  (select encode(sha256(convert_to(octet_length(n.title)::text || ':' || n.title || n.content, 'UTF8')), 'hex')
            = b.content_sha256 from public.t03_personal_notes n
     join public.t10_note_backups b on b.note_id = n.id, target t where n.id = t.note_id) as same_hash,
  -- 사본 표 전체: 저장된 해시와 다시 계산한 해시가 다른 사본 수 (0이어야 함)
  (select count(*) from public.t10_note_backups
    where encode(sha256(convert_to(octet_length(title)::text || ':' || title || content, 'UTF8')), 'hex')
          <> content_sha256) as hash_mismatch,
  -- 그 메모의 감사 기록을 시간 순서로 (덧붙여지기만 했는지)
  (select array_agg(a.outcome order by a.at) from public.t10_restore_audit a, target t
    where a.note_id = t.note_id) as audit_outcomes,
  -- 전체 건수: [가]와 비교해 감사 기록은 늘기만 하고, 메모는 시험 메모 한 건만 늘어야 함
  (select count(*) from public.t10_restore_audit) as audit_rows,
  (select count(*) from public.t03_personal_notes) as note_rows;
