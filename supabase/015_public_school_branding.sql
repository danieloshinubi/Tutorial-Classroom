-- =============================================================================
-- Let the sign-in page say whose school it is
--
-- A visitor at jane-nath.schoolivio.com has not signed in yet, so row level
-- security correctly hides every school from them — including the one whose
-- address they just typed. That leaves the login page unable to name the
-- school it belongs to.
--
-- This exposes the bare minimum for branding, and nothing else: name and
-- logo, for active schools only, one slug at a time. No email, no address, no
-- member counts, and no way to list every school on the platform.
--
-- Run after 014. Safe to re-run.
-- =============================================================================

create or replace function classroom.public_school(target_slug text)
returns table (name text, slug text, logo_url text)
language sql
stable
security definer
set search_path = classroom, public
as $$
  select s.name, s.slug, s.logo_url
  from classroom.schools s
  where s.slug = lower(btrim(target_slug))
    and s.is_active;
$$;

-- Deliberately granted to anon: this is what an unauthenticated login page
-- calls. A school's name and subdomain are public by nature — they are how
-- people reach it.
grant execute on function classroom.public_school(text) to anon, authenticated;

notify pgrst, 'reload schema';
