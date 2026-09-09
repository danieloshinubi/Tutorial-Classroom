-- =============================================================================
-- Proof that a result cannot reach a family early
--
--   node scripts/sql.js --file supabase/tests/results_release_rls.sql
--
-- Runs the whole draft -> submitted -> approved -> released workflow against
-- the real database as five different people, asserting at every step what
-- each of them can and cannot read, then ROLLS BACK. Nothing is left behind.
--
-- The ids below are Jane-Nath's; point them at another tenant to re-run there.
-- The two rows that matter most are "student reads own marks while APPROVED"
-- and "parent reads child marks while APPROVED": if either ever returns a
-- row, results are leaking before the school has published them.
-- =============================================================================

begin;

create temp table findings (seq serial, check_name text, expected text, actual text);
grant insert, select on findings to authenticated;
grant usage, select on all sequences in schema pg_temp to authenticated;

do $test$
declare
  school   uuid := '04ade535-8126-4a33-88f1-6723ff0e0032';
  course   uuid := '49b68739-4c00-49d7-a797-279f8480a079';  -- ISC2 - CC
  teacher  uuid := 'a435e1b7-1665-4278-a8c1-cd6d6feb4ed1';  -- owns the course
  princ    uuid := 'aa1c645f-c1d0-4a90-8cf2-4f9459af1bf7';  -- principal for this test
  student  uuid := 'c888275e-a277-4f04-85fd-565fb79e6f58';  -- Boluwatife, enrolled
  parent   uuid := '7420df02-9305-4fd7-bd5d-09aebf9466ff';  -- guardian of Boluwatife
  other    uuid := '752e52c8-ae23-49bb-b81b-608b7dc81ef9';  -- a different student
  sess     uuid;
  term     uuid;
  sheet    uuid;
  n        int;
  msg      text;

  procedure_note text;
begin
  -- ---------- set the stage, as the owner ----------
  select id into sess from classroom.sessions where school_id = school and is_current limit 1;
  if sess is null then
    select id into sess from classroom.sessions where school_id = school limit 1;
  end if;

  insert into classroom.terms (school_id, session_id, name, position, is_current)
  values (school, sess, 'First Term', 1, true)
  returning id into term;

  -- this test needs an approver who is not the teacher
  insert into classroom.school_members (school_id, user_id, role, is_active)
  values (school, princ, 'principal', true)
  on conflict (school_id, user_id) do update set role = 'principal', is_active = true;

  -- and a parent attached to the student
  insert into classroom.guardian_students (school_id, guardian_id, student_id, relationship)
  values (school, parent, student, 'Father')
  on conflict do nothing;

  -- make sure both students are on the course
  insert into classroom.enrollments (user_id, course_id, status, decided_at)
  values (student, course, 'approved', now()), (other, course, 'approved', now())
  on conflict (user_id, course_id) do update set status = 'approved';

  -- ---------- the teacher opens the sheet ----------
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', teacher, 'role', 'authenticated')::text, true);

  sheet := (classroom.open_result_sheet(course, term, 40, 60)).id;

  select count(*) into n from classroom.result_entries where sheet_id = sheet;
  insert into findings (check_name, expected, actual) values
    ('teacher opens sheet, register auto-filled', '2 students', n || ' students');

  -- ---------- THE GATE: nobody outside staff sees a draft ----------
  perform set_config('request.jwt.claims',
    json_build_object('sub', student, 'role', 'authenticated')::text, true);
  select count(*) into n from classroom.result_entries where sheet_id = sheet;
  insert into findings (check_name, expected, actual) values
    ('student reads own marks while DRAFT', '0 rows', n || ' rows');

  perform set_config('request.jwt.claims',
    json_build_object('sub', parent, 'role', 'authenticated')::text, true);
  select count(*) into n from classroom.result_entries where sheet_id = sheet;
  insert into findings (check_name, expected, actual) values
    ('parent reads child marks while DRAFT', '0 rows', n || ' rows');

  -- ---------- teacher cannot submit a half-marked sheet ----------
  perform set_config('request.jwt.claims',
    json_build_object('sub', teacher, 'role', 'authenticated')::text, true);
  begin
    perform classroom.submit_result_sheet(sheet);
    insert into findings (check_name, expected, actual) values
      ('submit with blank marks', 'refused', 'ALLOWED');
  exception when others then
    insert into findings (check_name, expected, actual) values
      ('submit with blank marks', 'refused', 'refused: ' || SQLERRM);
  end;

  -- ---------- enter marks, then submit ----------
  update classroom.result_entries set ca_score = 32, exam_score = 48
  where sheet_id = sheet and student_id = student;
  update classroom.result_entries set ca_score = 18, exam_score = 21
  where sheet_id = sheet and student_id = other;

  perform classroom.submit_result_sheet(sheet, 'First term marks');
  select status into procedure_note from classroom.result_sheets where id = sheet;
  insert into findings (check_name, expected, actual) values
    ('teacher submits a complete sheet', 'submitted', procedure_note);

  -- ---------- the teacher can no longer change a mark ----------
  update classroom.result_entries set ca_score = 40
  where sheet_id = sheet and student_id = student;
  get diagnostics n = row_count;
  insert into findings (check_name, expected, actual) values
    ('teacher edits a mark after submitting', '0 rows changed', n || ' rows changed');

  -- ---------- the submitter cannot approve their own work ----------
  begin
    perform classroom.approve_result_sheet(sheet);
    insert into findings (check_name, expected, actual) values
      ('submitter approves own sheet', 'refused', 'ALLOWED');
  exception when others then
    insert into findings (check_name, expected, actual) values
      ('submitter approves own sheet', 'refused', 'refused: ' || SQLERRM);
  end;

  -- ---------- a teacher cannot release by writing the column directly ----------
  update classroom.result_sheets set status = 'released' where id = sheet;
  get diagnostics n = row_count;
  insert into findings (check_name, expected, actual) values
    ('teacher UPDATEs status straight to released', '0 rows changed', n || ' rows changed');

  -- ---------- a parent cannot call the release function ----------
  perform set_config('request.jwt.claims',
    json_build_object('sub', parent, 'role', 'authenticated')::text, true);
  begin
    perform classroom.release_result_sheet(sheet);
    insert into findings (check_name, expected, actual) values
      ('parent calls release_result_sheet', 'refused', 'ALLOWED');
  exception when others then
    insert into findings (check_name, expected, actual) values
      ('parent calls release_result_sheet', 'refused', 'refused: ' || SQLERRM);
  end;

  -- ---------- the principal approves ----------
  perform set_config('request.jwt.claims',
    json_build_object('sub', princ, 'role', 'authenticated')::text, true);

  begin
    perform classroom.release_result_sheet(sheet);
    insert into findings (check_name, expected, actual) values
      ('release a sheet that is only SUBMITTED', 'refused', 'ALLOWED');
  exception when others then
    insert into findings (check_name, expected, actual) values
      ('release a sheet that is only SUBMITTED', 'refused', 'refused: ' || SQLERRM);
  end;

  perform classroom.approve_result_sheet(sheet, 'Checked against the scripts');
  select status into procedure_note from classroom.result_sheets where id = sheet;
  insert into findings (check_name, expected, actual) values
    ('principal approves', 'approved', procedure_note);

  -- ---------- THE GATE AGAIN: approved is still not released ----------
  perform set_config('request.jwt.claims',
    json_build_object('sub', student, 'role', 'authenticated')::text, true);
  select count(*) into n from classroom.result_entries where sheet_id = sheet;
  insert into findings (check_name, expected, actual) values
    ('student reads own marks while APPROVED', '0 rows', n || ' rows');

  perform set_config('request.jwt.claims',
    json_build_object('sub', parent, 'role', 'authenticated')::text, true);
  select count(*) into n from classroom.result_entries where sheet_id = sheet;
  insert into findings (check_name, expected, actual) values
    ('parent reads child marks while APPROVED', '0 rows', n || ' rows');

  -- ---------- released ----------
  perform set_config('request.jwt.claims',
    json_build_object('sub', princ, 'role', 'authenticated')::text, true);
  perform classroom.release_result_sheet(sheet, 'Published to parents');

  perform set_config('request.jwt.claims',
    json_build_object('sub', student, 'role', 'authenticated')::text, true);
  select count(*) into n from classroom.result_entries where sheet_id = sheet;
  insert into findings (check_name, expected, actual) values
    ('student reads own marks once RELEASED', '1 row', n || ' rows');

  select count(*) into n from classroom.result_slips
  where sheet_id = sheet and student_id <> student;
  insert into findings (check_name, expected, actual) values
    ('student reads a classmate''s released marks', '0 rows', n || ' rows');

  perform set_config('request.jwt.claims',
    json_build_object('sub', parent, 'role', 'authenticated')::text, true);
  select count(*) into n from classroom.result_slips
  where sheet_id = sheet and student_id = student;
  insert into findings (check_name, expected, actual) values
    ('parent reads their own child once RELEASED', '1 rows', n || ' rows');

  -- This parent already guardians another student on this course, so the
  -- honest question is not "how many rows" but "any row that is not theirs".
  select count(*) into n from classroom.result_slips s
  where s.sheet_id = sheet
    and not exists (
      select 1 from classroom.guardian_students g
      where g.student_id = s.student_id and g.guardian_id = parent
    );
  insert into findings (check_name, expected, actual) values
    ('parent reads a child who is not theirs', '0 rows', n || ' rows');

  select grade || ' at ' || percentage || '%' into procedure_note
  from classroom.result_slips where sheet_id = sheet and student_id = student;
  insert into findings (check_name, expected, actual) values
    ('what the parent actually sees', 'A at 80.0%', procedure_note);

  -- ---------- a parent of nobody sees nothing ----------
  perform set_config('request.jwt.claims',
    json_build_object('sub', '1d21bb42-f43e-4443-b323-d064d53daeae', 'role', 'authenticated')::text, true);
  select count(*) into n from classroom.result_slips where sheet_id = sheet;
  insert into findings (check_name, expected, actual) values
    ('an unrelated parent reads the sheet', '0 rows', n || ' rows');

  -- ---------- nobody may rewrite the audit trail ----------
  perform set_config('request.jwt.claims',
    json_build_object('sub', princ, 'role', 'authenticated')::text, true);
  delete from classroom.result_events where sheet_id = sheet;
  get diagnostics n = row_count;
  insert into findings (check_name, expected, actual) values
    ('principal deletes the audit trail', '0 rows deleted', n || ' rows deleted');

  reset role;
end;
$test$;

select check_name, expected, actual,
       case when actual like expected || '%' or actual like 'refused%' then 'PASS' else 'FAIL' end as verdict
from findings order by seq;

rollback;
