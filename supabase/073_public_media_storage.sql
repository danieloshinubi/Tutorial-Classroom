-- =============================================================================
-- Storage for logos and avatars
--
-- schools.logo_url and profiles.avatar_url were both plain text boxes asking
-- someone to paste a URL from somewhere else — the one thing every other
-- file-bearing feature in this app (course materials, exam question images,
-- admission documents, payment proofs) does properly instead: pick a file,
-- the app uploads it. This is the same treatment, on its own bucket rather
-- than course-materials, because a logo and an avatar are meant to be
-- publicly visible wherever they're already rendered (nav bar, report
-- cards, tutor listings) — unlike course-materials' private+signed-URL
-- model, which exists specifically because admissions/payment documents are
-- not meant to be public. A public bucket means logo_url/avatar_url keep
-- being plain, directly-usable URLs, so nothing that already renders them
-- as a bare <img src> needs to change.
--
-- The bucket itself ("public-media", public ON, 5MB limit, image/png|jpeg|webp
-- only) was created via the Storage Management API, the same limitation
-- 006_storage.sql documents for course-materials: the `storage` schema is
-- owned by supabase_storage_admin, so bucket creation cannot happen from
-- this SQL file. This file only adds the write policies.
--
-- Path convention, same shape as everywhere else in this app:
--   avatars/<user_id>/<uuid>-<filename>
--   logos/<school_id>/<uuid>-<filename>
--
-- Public buckets skip RLS for reads (served straight from the CDN-style
-- public URL) but NOT for writes — insert/update/delete still go through
-- these policies same as a private bucket.
--
-- Run after 070. Safe to re-run.
-- =============================================================================

-- avatars/<user_id>/... — the person themselves, or an admin of any school
-- they belong to (the same reach the People panel's "Edit" already has over
-- the rest of that profile).
drop policy if exists "manage own or managed avatar" on storage.objects;
create policy "manage own or managed avatar"
  on storage.objects for all to authenticated
  using (
    bucket_id = 'public-media'
    and (storage.foldername(name))[1] = 'avatars'
    and (
      auth.uid()::text = (storage.foldername(name))[2]
      or exists (
        select 1 from classroom.school_members m
        where m.user_id = ((storage.foldername(name))[2])::uuid
          and classroom.is_school_admin(m.school_id)
      )
    )
  )
  with check (
    bucket_id = 'public-media'
    and (storage.foldername(name))[1] = 'avatars'
    and (
      auth.uid()::text = (storage.foldername(name))[2]
      or exists (
        select 1 from classroom.school_members m
        where m.user_id = ((storage.foldername(name))[2])::uuid
          and classroom.is_school_admin(m.school_id)
      )
    )
  );

-- logos/<school_id>/... — an owner/admin of that school.
drop policy if exists "school admins manage their logo" on storage.objects;
create policy "school admins manage their logo"
  on storage.objects for all to authenticated
  using (
    bucket_id = 'public-media'
    and (storage.foldername(name))[1] = 'logos'
    and classroom.is_school_admin(((storage.foldername(name))[2])::uuid)
  )
  with check (
    bucket_id = 'public-media'
    and (storage.foldername(name))[1] = 'logos'
    and classroom.is_school_admin(((storage.foldername(name))[2])::uuid)
  );
