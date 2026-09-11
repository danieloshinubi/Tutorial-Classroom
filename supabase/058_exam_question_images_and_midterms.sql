-- =============================================================================
-- Exam question images, and a "mid-exam" kind alongside the regular exam
--
-- Images: a maths or science paper needs a diagram or an equation image a
-- textarea can't express. One column, one storage prefix
-- (exam-questions/<exam_id>/<file>), following the same shape as every
-- other admissions/course upload in this codebase.
--
-- Mid-exams: exams had no way to tell a mid-semester/mid-term paper apart
-- from a regular one. One column with two values; the course page filters
-- on it to show two lists instead of one.
-- =============================================================================

alter table classroom.exam_questions
  add column if not exists image_path text;

alter table classroom.exams
  add column if not exists kind text not null default 'exam'
    check (kind in ('exam', 'midterm'));

create index if not exists exams_course_kind_idx on classroom.exams (course_id, kind);

create or replace function classroom.can_manage_exam(target_exam uuid)
returns boolean
language sql stable security definer
set search_path = classroom, public
as $fn$
  select exists (
    select 1 from classroom.exams e
    where e.id = target_exam and classroom.can_manage_course(e.course_id)
  );
$fn$;

grant execute on function classroom.can_manage_exam(uuid) to authenticated;

-- Same rule the exams table's own SELECT policy already uses: a published
-- exam is visible to an enrolled course member, or to whoever manages it.
create or replace function classroom.may_view_exam_image(target_exam uuid)
returns boolean
language sql stable security definer
set search_path = classroom, public
as $fn$
  select exists (
    select 1 from classroom.exams e
    where e.id = target_exam
      and (
        (e.published and classroom.is_enrolled_in(e.course_id))
        or classroom.can_manage_course(e.course_id)
      )
  );
$fn$;

grant execute on function classroom.may_view_exam_image(uuid) to authenticated;

drop policy if exists "course managers upload exam question images" on storage.objects;
create policy "course managers upload exam question images"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'course-materials'
    and (storage.foldername(name))[1] = 'exam-questions'
    and classroom.can_manage_exam(classroom.try_uuid((storage.foldername(name))[2]))
  );

drop policy if exists "read an exam question image" on storage.objects;
create policy "read an exam question image"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'course-materials'
    and (storage.foldername(name))[1] = 'exam-questions'
    and classroom.may_view_exam_image(classroom.try_uuid((storage.foldername(name))[2]))
  );

drop policy if exists "course managers delete exam question images" on storage.objects;
create policy "course managers delete exam question images"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'course-materials'
    and (storage.foldername(name))[1] = 'exam-questions'
    and classroom.can_manage_exam(classroom.try_uuid((storage.foldername(name))[2]))
  );

notify pgrst, 'reload schema';
