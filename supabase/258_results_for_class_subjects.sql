-- Term results for a class's subject, not only a course (2026-10-14).
--
-- 024 built result sheets (CA + exam, draft → submitted → approved →
-- released, families see only released) for one COURSE and one term, filled
-- from the course's enrolments. A secondary school runs on classes and their
-- subjects instead (JSS 1A: Mathematics, English…; supabase/012), whose
-- pupils are in class_students and whose courses have no enrolments, so a
-- course sheet would have no one on it. A sheet now belongs to either a
-- course or a class's subject; for a subject its roster is the class.
--
-- Who enters the marks of a subject's sheet: its teacher, or the class's
-- form teacher; and, for a subject no teacher has yet, the principal, an
-- owner (proprietor) or an admin, so a sheet is never stuck. Who approves,
-- returns, releases and withdraws: the principal, an owner (proprietor) or
-- an admin (can_release_results, unchanged) — never the person who submitted.
-- Everything else in 024 stands: no UPDATE policy on sheets, families read
-- only what is released, and every move is in the trail.

alter table classroom.result_sheets alter column course_id drop not null;
alter table classroom.result_sheets add column if not exists class_subject_id uuid references classroom.class_subjects (id) on delete cascade;
alter table classroom.result_sheets drop constraint if exists result_sheets_one_owner;
alter table classroom.result_sheets add constraint result_sheets_one_owner check ((course_id is null) <> (class_subject_id is null));
create unique index if not exists result_sheets_subject_once on classroom.result_sheets (class_subject_id, term_id) where class_subject_id is not null;

-- May the viewer enter marks on this sheet's course or subject?
create or replace function classroom.can_teach_result(target_course uuid, target_class_subject uuid)
returns boolean language sql stable security definer set search_path = classroom, public as $fn$
  select case
    when target_course is not null then classroom.can_manage_course(target_course)
    else exists (
      select 1 from classroom.class_subjects cs join classroom.classes c on c.id = cs.class_id
       where cs.id = target_class_subject
         and (cs.teacher_id = (select auth.uid())
              or c.form_teacher_id = (select auth.uid())
              or (cs.teacher_id is null and classroom.can_release_results(cs.school_id))))
  end;
$fn$;
grant execute on function classroom.can_teach_result(uuid, uuid) to authenticated;

-- How a sheet is named in notices: "Mathematics · JSS 1A", or the course code.
create or replace function classroom.result_sheet_label(sheet classroom.result_sheets)
returns text language sql stable security definer set search_path = classroom, public as $fn$
  select coalesce(
    (select coalesce(s.name, 'Subject') || ' · ' || c.name from classroom.class_subjects cs
       join classroom.subjects s on s.id = cs.subject_id join classroom.classes c on c.id = cs.class_id
      where cs.id = sheet.class_subject_id),
    (select coalesce(co.code, co.title) from classroom.courses co where co.id = sheet.course_id),
    'Results');
$fn$;

-- Who teaches it, to tell them when it comes back.
create or replace function classroom.result_sheet_teachers(sheet classroom.result_sheets)
returns setof uuid language sql stable security definer set search_path = classroom, public as $fn$
  select co.owner_id from classroom.courses co where co.id = sheet.course_id and co.owner_id is not null
  union
  select cs.teacher_id from classroom.class_subjects cs where cs.id = sheet.class_subject_id and cs.teacher_id is not null
  union
  select c.form_teacher_id from classroom.class_subjects cs join classroom.classes c on c.id = cs.class_id
   where cs.id = sheet.class_subject_id and cs.teacher_id is null and c.form_teacher_id is not null;
$fn$;

/* --- policies: "the teacher" now means either kind ---------------------- */
drop policy if exists "staff read result sheets" on classroom.result_sheets;
create policy "staff read result sheets" on classroom.result_sheets for select to authenticated
  using (classroom.can_teach_result(course_id, class_subject_id) or classroom.can_release_results(school_id));

drop policy if exists "teachers open a draft sheet" on classroom.result_sheets;
create policy "teachers open a draft sheet" on classroom.result_sheets for insert to authenticated
  with check (false);  -- opened only by open_result_sheet / open_subject_result_sheet

drop policy if exists "teachers discard a draft sheet" on classroom.result_sheets;
create policy "teachers discard a draft sheet" on classroom.result_sheets for delete to authenticated
  using (classroom.can_teach_result(course_id, class_subject_id) and status = 'draft');

drop policy if exists "staff read result entries" on classroom.result_entries;
create policy "staff read result entries" on classroom.result_entries for select to authenticated
  using (exists (select 1 from classroom.result_sheets s where s.id = result_entries.sheet_id
                  and (classroom.can_teach_result(s.course_id, s.class_subject_id) or classroom.can_release_results(s.school_id))));

drop policy if exists "teachers enter marks while editable" on classroom.result_entries;
create policy "teachers enter marks while editable" on classroom.result_entries for insert to authenticated
  with check (exists (select 1 from classroom.result_sheets s where s.id = result_entries.sheet_id
                       and classroom.can_teach_result(s.course_id, s.class_subject_id) and s.status in ('draft', 'returned')));

drop policy if exists "teachers correct marks while editable" on classroom.result_entries;
create policy "teachers correct marks while editable" on classroom.result_entries for update to authenticated
  using (exists (select 1 from classroom.result_sheets s where s.id = result_entries.sheet_id
                  and classroom.can_teach_result(s.course_id, s.class_subject_id) and s.status in ('draft', 'returned')))
  with check (exists (select 1 from classroom.result_sheets s where s.id = result_entries.sheet_id
                       and classroom.can_teach_result(s.course_id, s.class_subject_id) and s.status in ('draft', 'returned')));

drop policy if exists "teachers remove marks while editable" on classroom.result_entries;
create policy "teachers remove marks while editable" on classroom.result_entries for delete to authenticated
  using (exists (select 1 from classroom.result_sheets s where s.id = result_entries.sheet_id
                  and classroom.can_teach_result(s.course_id, s.class_subject_id) and s.status in ('draft', 'returned')));

drop policy if exists "staff read the result trail" on classroom.result_events;
create policy "staff read the result trail" on classroom.result_events for select to authenticated
  using (exists (select 1 from classroom.result_sheets s where s.id = result_events.sheet_id
                  and (classroom.can_teach_result(s.course_id, s.class_subject_id) or classroom.can_release_results(s.school_id))));

-- Marks are checked against the sheet's own maximums, and who last touched
-- a mark is always the person signed in.
create or replace function classroom.result_entries_guard()
returns trigger language plpgsql security definer set search_path = classroom, public as $fn$
declare sheet classroom.result_sheets;
begin
  select * into sheet from classroom.result_sheets where id = new.sheet_id;
  if new.ca_score is not null and new.ca_score > sheet.ca_max then
    raise exception 'A CA score cannot be more than %', sheet.ca_max;
  end if;
  if new.exam_score is not null and new.exam_score > sheet.exam_max then
    raise exception 'An exam score cannot be more than %', sheet.exam_max;
  end if;
  if (select auth.uid()) is not null then new.updated_by := (select auth.uid()); end if;
  new.updated_at := now();
  return new;
end;
$fn$;
drop trigger if exists result_entries_guard on classroom.result_entries;
create trigger result_entries_guard before insert or update on classroom.result_entries
  for each row execute function classroom.result_entries_guard();

/* --- opening a subject's sheet ------------------------------------------- */
create or replace function classroom.open_subject_result_sheet(target_class_subject uuid, target_term uuid, ca_max int default 40, exam_max int default 60)
returns classroom.result_sheets language plpgsql security definer set search_path = classroom, public as $fn$
declare
  cs classroom.class_subjects;
  sheet classroom.result_sheets;
begin
  select * into cs from classroom.class_subjects where id = target_class_subject;
  if not found then raise exception 'No such subject for this class'; end if;
  if not classroom.can_teach_result(null, target_class_subject) then
    raise exception 'Only the teacher of this subject (or the class''s form teacher) can open its result sheet';
  end if;
  if not exists (select 1 from classroom.terms t where t.id = target_term and t.school_id = cs.school_id) then
    raise exception 'No such term';
  end if;
  if ca_max < 0 or exam_max < 0 or ca_max + exam_max <= 0 or ca_max > 100 or exam_max > 100 then
    raise exception 'Choose how many marks the CA and the exam are out of';
  end if;

  select * into sheet from classroom.result_sheets where class_subject_id = target_class_subject and term_id = target_term;
  if found then
    -- Pupils who joined the class since the sheet was opened are added.
    if sheet.status in ('draft', 'returned') then
      insert into classroom.result_entries (sheet_id, student_id, updated_by)
      select sheet.id, s.student_id, auth.uid() from classroom.class_students s
       where s.class_id = cs.class_id
      on conflict (sheet_id, student_id) do nothing;
    end if;
    return sheet;
  end if;

  insert into classroom.result_sheets (school_id, class_subject_id, term_id, ca_max, exam_max, created_by)
  values (cs.school_id, target_class_subject, target_term, ca_max, exam_max, auth.uid())
  returning * into sheet;

  insert into classroom.result_entries (sheet_id, student_id, updated_by)
  select sheet.id, s.student_id, auth.uid() from classroom.class_students s where s.class_id = cs.class_id;

  insert into classroom.result_events (sheet_id, status_to, actor_id, actor_label, note)
  values (sheet.id, 'draft', auth.uid(), classroom.actor_label(), 'Sheet opened');
  return sheet;
end;
$fn$;
revoke all on function classroom.open_subject_result_sheet(uuid, uuid, int, int) from public, anon;
grant execute on function classroom.open_subject_result_sheet(uuid, uuid, int, int) to authenticated;

-- The split can change while nobody has submitted yet.
create or replace function classroom.set_result_sheet_split(target_sheet uuid, ca_max_in int, exam_max_in int)
returns classroom.result_sheets language plpgsql security definer set search_path = classroom, public as $fn$
declare sheet classroom.result_sheets;
begin
  select * into sheet from classroom.result_sheets where id = target_sheet for update;
  if not found then raise exception 'No such result sheet'; end if;
  if not classroom.can_teach_result(sheet.course_id, sheet.class_subject_id) then raise exception 'Only the teacher can change this sheet'; end if;
  if sheet.status not in ('draft', 'returned') then raise exception 'A sheet that is % cannot be changed', sheet.status; end if;
  if ca_max_in < 0 or exam_max_in < 0 or ca_max_in + exam_max_in <= 0 or ca_max_in > 100 or exam_max_in > 100 then
    raise exception 'Choose how many marks the CA and the exam are out of';
  end if;
  if exists (select 1 from classroom.result_entries e where e.sheet_id = sheet.id and (e.ca_score > ca_max_in or e.exam_score > exam_max_in)) then
    raise exception 'Some marks already entered are higher than that. Lower them first.';
  end if;
  update classroom.result_sheets set ca_max = ca_max_in, exam_max = exam_max_in, updated_at = now() where id = sheet.id returning * into sheet;
  return sheet;
end;
$fn$;
revoke all on function classroom.set_result_sheet_split(uuid, int, int) from public, anon;
grant execute on function classroom.set_result_sheet_split(uuid, int, int) to authenticated;

/* --- the transitions, for either kind of sheet --------------------------- */
create or replace function classroom.submit_result_sheet(target_sheet uuid, note text default null)
returns classroom.result_sheets language plpgsql security definer set search_path = classroom, public as $fn$
declare
  sheet classroom.result_sheets;
  was classroom.result_status;
  blanks int;
begin
  select * into sheet from classroom.result_sheets where id = target_sheet;
  if not found then raise exception 'No such result sheet'; end if;
  if not classroom.can_teach_result(sheet.course_id, sheet.class_subject_id) then
    raise exception 'Only the teacher of this subject can submit its results';
  end if;
  if sheet.status not in ('draft', 'returned') then
    raise exception 'A sheet that is % cannot be submitted', sheet.status;
  end if;
  select count(*) into blanks from classroom.result_entries where sheet_id = target_sheet and ca_score is null and exam_score is null;
  if blanks > 0 then raise exception '% student(s) have no marks yet', blanks; end if;
  if not exists (select 1 from classroom.result_entries where sheet_id = target_sheet) then raise exception 'There is nobody on this sheet'; end if;

  was := sheet.status;
  update classroom.result_sheets set status = 'submitted', submitted_by = auth.uid(), submitted_at = now(), updated_at = now()
   where id = target_sheet returning * into sheet;
  insert into classroom.result_events (sheet_id, status_from, status_to, actor_id, actor_label, note)
  values (target_sheet, was, 'submitted', auth.uid(), classroom.actor_label(), note);

  insert into classroom.notifications (user_id, school_id, kind, title, body, link)
  select m.user_id, sheet.school_id, 'results_submitted', format('Results to approve: %s', classroom.result_sheet_label(sheet)),
         format('Submitted by %s', classroom.actor_label()), format('/Results/%s', sheet.id)
    from (select distinct sm.user_id from classroom.school_members sm
           where sm.school_id = sheet.school_id and sm.is_active and sm.role in ('owner', 'admin', 'principal') and sm.user_id <> auth.uid()) m;
  return sheet;
end;
$fn$;

do $do$
declare d text;
begin
  -- return: tell whoever teaches it, either kind.
  d := pg_get_functiondef('classroom.return_result_sheet(uuid,text)'::regprocedure);
  d := replace(d, $a$  select c.owner_id, sheet.school_id, 'results_returned',
         format('Results sent back: %s', c.code), note,
         format('/Results/%s', sheet.id)
  from classroom.courses c
  where c.id = sheet.course_id and c.owner_id is not null;$a$,
  $b$  select t, sheet.school_id, 'results_returned',
         format('Results sent back: %s', classroom.result_sheet_label(sheet)), note,
         format('/Results/%s', sheet.id)
  from classroom.result_sheet_teachers(sheet) t;$b$);
  if position('result_sheet_teachers(sheet)' in d) = 0 then raise exception 'return patch did not apply'; end if;
  execute d;

  -- release: name the subject and class, either kind.
  d := pg_get_functiondef('classroom.release_result_sheet(uuid,text)'::regprocedure);
  d := replace(d, $a$         format('%s results published', c.code),
         format('%s -- %s', t.name, coalesce(c.title, c.code)),
         '/Reports'
  from classroom.result_entries e
  join classroom.courses c on c.id = sheet.course_id
  join classroom.terms   t on t.id = sheet.term_id$a$,
  $b$         format('%s results published', classroom.result_sheet_label(sheet)),
         format('%s results are ready to view.', t.name),
         '/Reports/' || e.student_id
  from classroom.result_entries e
  join classroom.terms   t on t.id = sheet.term_id$b$);
  if position('result_sheet_label(sheet)' in d) = 0 then raise exception 'release patch did not apply'; end if;
  execute d;
end;
$do$;

/* --- what families (and staff) read --------------------------------------- */
create or replace view classroom.result_slips with (security_invoker = true) as
  select e.id as entry_id,
         s.id as sheet_id,
         s.status,
         s.school_id,
         s.released_at,
         e.student_id,
         c.id as course_id,
         coalesce(c.code, sub.code) as course_code,
         coalesce(c.title, sub.name) as course_title,
         t.id as term_id,
         t.name as term_name,
         sess.name as session_name,
         s.ca_max,
         s.exam_max,
         e.ca_score,
         e.exam_score,
         e.total,
         round(e.total * 100.0 / nullif(s.ca_max + s.exam_max, 0)::numeric, 1) as percentage,
         classroom.grade_for(round(e.total * 100.0 / nullif(s.ca_max + s.exam_max, 0)::numeric, 1)) as grade,
         e.remark,
         s.class_subject_id,
         cl.name as class_name
    from classroom.result_entries e
    join classroom.result_sheets s on s.id = e.sheet_id
    left join classroom.courses c on c.id = s.course_id
    left join classroom.class_subjects cs on cs.id = s.class_subject_id
    left join classroom.subjects sub on sub.id = cs.subject_id
    left join classroom.classes cl on cl.id = cs.class_id
    join classroom.terms t on t.id = s.term_id
    left join classroom.sessions sess on sess.id = t.session_id;
grant select on classroom.result_slips to authenticated;

notify pgrst, 'reload schema';
