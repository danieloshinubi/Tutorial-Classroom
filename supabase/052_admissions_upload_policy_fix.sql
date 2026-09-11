-- =============================================================================
-- Fix: the anon storage policy from 051 referenced classroom.schools directly
--
-- Found live, immediately: attaching a file as an anonymous applicant failed
-- with "permission denied for table schools". RLS policies still need the
-- underlying table GRANT for whichever role is running the query — anon was
-- never granted select on classroom.schools (its only select policy is
-- membership-gated, to authenticated), so the plain EXISTS subquery inside
-- the storage.objects policy from 051 could never succeed for anon, no
-- matter how the row looked.
--
-- Same fix as every other cross-table RLS check in this codebase
-- (is_member_of, try_uuid, can_do_admissions, ...): a small SECURITY
-- DEFINER function, run with the definer's privileges rather than the
-- caller's, granted directly to anon.
-- =============================================================================

create or replace function classroom.is_active_school(target_school uuid)
returns boolean
language sql
stable
security definer
set search_path = classroom, public
as $fn$
  select target_school is not null and exists (
    select 1 from classroom.schools s
    where s.id = target_school and s.is_active
  );
$fn$;

grant execute on function classroom.is_active_school(uuid) to anon, authenticated;

drop policy if exists "anyone applying attaches a document" on storage.objects;
create policy "anyone applying attaches a document"
  on storage.objects for insert to anon, authenticated
  with check (
    bucket_id = 'course-materials'
    and (storage.foldername(name))[1] = 'admissions'
    and classroom.is_active_school(classroom.try_uuid((storage.foldername(name))[2]))
    and coalesce((metadata->>'size')::bigint, 0) <= 15728640
    and coalesce(metadata->>'mimetype', '') = any (array[
      'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'
    ])
  );

notify pgrst, 'reload schema';
