-- =============================================================================
-- Let a school pick its own theme colour
--
-- classroom.schools already has logo_url for a tenant's own mark; nothing
-- lets it recolour the product itself. One nullable hex string is enough —
-- the client derives every shade the UI actually needs (a darker hover, a
-- soft tint, gradient stops) from this single value, so the admin picks one
-- colour, not seven. Null means "no theme_color = the Schoolivio purple",
-- so it stays a placeholder the same way logo_url does today.
--
-- No new RLS: "school admins update their school" (007_tenancy.sql) already
-- covers every column on the row for owner/admin, and "members read their
-- own school" already covers every column for any member. Only the public,
-- unauthenticated surfaces (Login, /Apply, an applicant's own portal) need
-- a new door in — public_school() — since they run before there is a
-- session at all.
-- =============================================================================

alter table classroom.schools
  add column if not exists theme_color text;

alter table classroom.schools
  drop constraint if exists schools_theme_color_format;
alter table classroom.schools
  add constraint schools_theme_color_format
  check (theme_color is null or theme_color ~* '^#[0-9a-f]{6}$');

drop function if exists classroom.public_school(text);

create or replace function classroom.public_school(target_slug text)
returns table (id uuid, name text, slug text, logo_url text, theme_color text)
language sql
stable
security definer
set search_path = classroom, public
as $fn$
  select s.id, s.name, s.slug, s.logo_url, s.theme_color
  from classroom.schools s
  where s.slug = lower(btrim(target_slug))
    and s.is_active;
$fn$;

grant execute on function classroom.public_school(text) to anon, authenticated;

notify pgrst, 'reload schema';
