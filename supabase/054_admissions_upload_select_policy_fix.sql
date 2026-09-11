-- =============================================================================
-- Fix: the "Remove" button silently did nothing
--
-- Found live: clicking Remove cleared the row from the page but the file
-- stayed in storage — confirmed by querying storage.objects directly. A raw
-- DELETE call against the object reproduced it outside the app too, with
-- "Access denied", even though the delete policy's own conditions evaluated
-- true in isolation. anon has the base DELETE grant on storage.objects
-- (checked). What's missing is a SELECT policy: Supabase's Storage API
-- resolves the object (a SELECT under the hood) before it will act on it,
-- and the only SELECT policy on this bucket is "read course files and
-- admissions documents" (033), which is `to authenticated` only — anon has
-- no matching SELECT policy on this path at all, so as far as the storage
-- service can tell, the object doesn't exist for that caller.
--
-- Scoped identically to the delete policy (053): only a file nobody has
-- linked to an application yet. Once submit_application() registers it in
-- application_documents, this policy stops matching and the object goes
-- back to being exactly as staff-only-readable as one the school uploaded
-- itself — anon never gains read access to another family's submitted
-- documents, only to the pre-submission file it just uploaded in this same
-- session.
-- =============================================================================

drop policy if exists "an applicant can see their own unsent attachment" on storage.objects;
create policy "an applicant can see their own unsent attachment"
  on storage.objects for select to anon, authenticated
  using (
    bucket_id = 'course-materials'
    and (storage.foldername(name))[1] = 'admissions'
    and classroom.storage_path_unclaimed(name)
  );

notify pgrst, 'reload schema';
