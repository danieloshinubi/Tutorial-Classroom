-- =============================================================================
-- Storage for uploaded course materials
--
-- The `storage` schema is owned by supabase_storage_admin, so the SQL editor
-- cannot create the bucket — that step is done in the dashboard.
--
-- STEP 1 (dashboard, not SQL):
--   Storage → New bucket
--     Name:   course-materials
--     Public: OFF   (downloads go through short-lived signed URLs)
--     File size limit: 50 MB
--
-- STEP 2: run this file.
--
-- If step 2 also fails with "must be owner of table objects", your project
-- restricts storage policies to the dashboard as well. In that case skip this
-- file and add the three policies by hand under
-- Storage → course-materials → Policies, using the definitions in the comments
-- below. Everything else in the app works either way.
-- =============================================================================

do $storage$
begin
  if not exists (
    select 1 from storage.buckets where id = 'course-materials'
  ) then
    raise exception
      'Bucket "course-materials" does not exist. Create it in the dashboard first (Storage → New bucket, public OFF).';
  end if;
end $storage$;

-- Files are stored as <course_id>/<uuid>-<filename>, so the first path segment
-- identifies the course and therefore who is allowed to write there.

-- READ: any signed-in user may read. Course membership is not enforced here
-- because the bucket is private and the app only ever hands out signed URLs
-- from pages that already check access.
drop policy if exists "signed-in users read course files" on storage.objects;
create policy "signed-in users read course files"
  on storage.objects for select to authenticated
  using (bucket_id = 'course-materials');

-- WRITE: only the tutor who owns the course, or an admin.
drop policy if exists "course managers upload files" on storage.objects;
create policy "course managers upload files"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'course-materials'
    and classroom.can_manage_course(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "course managers delete files" on storage.objects;
create policy "course managers delete files"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'course-materials'
    and classroom.can_manage_course(((storage.foldername(name))[1])::uuid)
  );
