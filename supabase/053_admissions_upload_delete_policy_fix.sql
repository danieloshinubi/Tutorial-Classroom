-- =============================================================================
-- Fix: same bug as 052, in the sibling policy
--
-- The delete policy from 051 ("an applicant withdraws their own unsent
-- attachment") has the identical problem 052 fixed for the insert policy —
-- its NOT EXISTS subquery reads classroom.application_documents directly,
-- and anon has no base grant on that table either (its own policies are all
-- `to authenticated`). Found live: removing an attachment before submitting
-- failed with "permission denied for table application_documents".
-- =============================================================================

create or replace function classroom.storage_path_unclaimed(target_path text)
returns boolean
language sql
stable
security definer
set search_path = classroom, public
as $fn$
  select not exists (
    select 1 from classroom.application_documents d where d.file_path = target_path
  );
$fn$;

grant execute on function classroom.storage_path_unclaimed(text) to anon, authenticated;

drop policy if exists "an applicant withdraws their own unsent attachment" on storage.objects;
create policy "an applicant withdraws their own unsent attachment"
  on storage.objects for delete to anon, authenticated
  using (
    bucket_id = 'course-materials'
    and (storage.foldername(name))[1] = 'admissions'
    and classroom.storage_path_unclaimed(name)
  );

notify pgrst, 'reload schema';
