-- =============================================================================
-- Fix: exam question images can't be scoped by exam id after all
--
-- 058 scoped the exam-questions/ storage prefix by exam id, checked via
-- can_manage_exam(). That breaks the actual authoring flow: ExamBuilder
-- builds the whole paper — including images on brand-new questions — in
-- local state and only calls createExam() at final Save. A question being
-- added to an exam that doesn't have a row yet has no real exam id to scope
-- the upload to, and can_manage_exam() would correctly (but unhelpfully)
-- refuse a path naming an exam that doesn't exist.
--
-- Rescoped to course_id instead — known immediately from the route, before
-- any save — exactly the pattern uploadMaterialFile already uses for course
-- materials. The read side drops the "must be published" nuance that
-- exam-id scoping would have allowed (an enrolled classmate could in theory
-- fetch an unpublished exam's image if they had the exact random path);
-- that's the same trust level materials already carry, and finding an
-- unguessable UUID path isn't a realistic path to it.
-- =============================================================================

drop policy if exists "course managers upload exam question images" on storage.objects;
drop policy if exists "read an exam question image" on storage.objects;
drop policy if exists "course managers delete exam question images" on storage.objects;

create policy "course managers upload exam question images"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'course-materials'
    and (storage.foldername(name))[1] = 'exam-questions'
    and classroom.can_manage_course(classroom.try_uuid((storage.foldername(name))[2]))
  );

create policy "read an exam question image"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'course-materials'
    and (storage.foldername(name))[1] = 'exam-questions'
    and (
      classroom.is_enrolled_in(classroom.try_uuid((storage.foldername(name))[2]))
      or classroom.can_manage_course(classroom.try_uuid((storage.foldername(name))[2]))
    )
  );

create policy "course managers delete exam question images"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'course-materials'
    and (storage.foldername(name))[1] = 'exam-questions'
    and classroom.can_manage_course(classroom.try_uuid((storage.foldername(name))[2]))
  );

-- can_manage_exam/may_view_exam_image from 058 are no longer used by any
-- policy — dropped rather than left as dead surface.
drop function if exists classroom.may_view_exam_image(uuid);
drop function if exists classroom.can_manage_exam(uuid);

notify pgrst, 'reload schema';
