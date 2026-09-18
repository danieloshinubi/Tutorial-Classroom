-- =============================================================================
-- A tenant admin can now upload an authorized signature (image) plus who it
-- belongs to, for use on official documents — starting with the admission
-- letter, which today just prints a blank line under "Yours faithfully" /
-- "For the Principal" with no real signature or name at all.
--
-- Same shape as logo_url exactly: one column per field on classroom.schools,
-- uploaded straight to the public-media bucket the client already uses for
-- logos (073_public_media_storage.sql), under a sibling signatures/<school_id>/
-- prefix guarded by the same classroom.is_school_admin() check.
-- =============================================================================

alter table classroom.schools
  add column if not exists signature_url   text,
  add column if not exists signatory_name  text,
  add column if not exists signatory_title text;

-- signatures/<school_id>/... — an owner/admin of that school, identical
-- shape to "school admins manage their logo" just above it.
drop policy if exists "school admins manage their signature" on storage.objects;
create policy "school admins manage their signature"
  on storage.objects for all to authenticated
  using (
    bucket_id = 'public-media'
    and (storage.foldername(name))[1] = 'signatures'
    and classroom.is_school_admin(((storage.foldername(name))[2])::uuid)
  )
  with check (
    bucket_id = 'public-media'
    and (storage.foldername(name))[1] = 'signatures'
    and classroom.is_school_admin(((storage.foldername(name))[2])::uuid)
  );
