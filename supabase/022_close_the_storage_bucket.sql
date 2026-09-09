-- =============================================================================
-- Security: any signed-in user could read every file in the bucket
--
-- The read policy was only
--
--   bucket_id = 'course-materials'
--
-- with no check on the path at all. Both kinds of file live in this one
-- bucket — course material at <course_id>/... and admissions documents at
-- admissions/<school_id>/<application_id>/... — so a signed-in student at ANY
-- tenant could fetch an applicant's birth certificate, or the material of a
-- course they are not on, given the path. The paths contain uuids, which
-- makes that hard to do by accident and no protection at all against anyone
-- who has seen one.
--
-- Reading is now scoped the same way writing already was: an admissions
-- document is for that school's admissions staff, and course material is for
-- people actually on the course.
-- =============================================================================

drop policy if exists "signed-in users read course files" on storage.objects;

create policy "read course files and admissions documents"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'course-materials'
    and case
      when (storage.foldername(name))[1] = 'admissions' then
        classroom.has_role_in(
          classroom.try_uuid((storage.foldername(name))[2]),
          array['owner','admin','admissions']::classroom.member_role[]
        )
      else
        classroom.is_enrolled_in(classroom.try_uuid((storage.foldername(name))[1]))
        or classroom.can_manage_course(classroom.try_uuid((storage.foldername(name))[1]))
    end
  );
