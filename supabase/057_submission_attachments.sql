-- =============================================================================
-- Attaching a file when turning in an assignment
--
-- submissions already lets a student write text and a link; there was no
-- way to attach a file. Same bucket (course-materials) as everything else,
-- new prefix: submissions/<assignment_id>/<user_id>/<file>. The existing
-- table RLS ("students submit/edit their own work", auth.uid() = user_id,
-- no column restriction) already covers the new columns — only storage
-- needs new policies.
-- =============================================================================

alter table classroom.submissions
  add column if not exists file_path text,
  add column if not exists file_name text,
  add column if not exists file_size bigint;

drop policy if exists "a student attaches their own submission file" on storage.objects;
create policy "a student attaches their own submission file"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'course-materials'
    and (storage.foldername(name))[1] = 'submissions'
    and (storage.foldername(name))[3] = auth.uid()::text
  );

drop policy if exists "read a submission's own file" on storage.objects;
create policy "read a submission's own file"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'course-materials'
    and (storage.foldername(name))[1] = 'submissions'
    and (
      (storage.foldername(name))[3] = auth.uid()::text
      or classroom.can_manage_assignment(classroom.try_uuid((storage.foldername(name))[2]))
    )
  );

drop policy if exists "a student withdraws their own submission file" on storage.objects;
create policy "a student withdraws their own submission file"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'course-materials'
    and (storage.foldername(name))[1] = 'submissions'
    and (storage.foldername(name))[3] = auth.uid()::text
  );

notify pgrst, 'reload schema';
