-- =============================================================================
-- public_school_levels() — the anonymous Apply form's "Applying for class"
-- field was a bare number input, which asks a parent to already know that
-- this school calls its classes "JSS 2" rather than "Grade 8" or "Year 8"
-- and to correctly guess the number that maps to it. classroom.levels
-- already holds exactly that per-school naming (036_principal_manages_levels),
-- but its own RLS is "to authenticated" only — the public Apply form runs
-- fully anonymous, with no session at all. Same shape and threat model as
-- public_school() itself: level names are the same kind of non-sensitive
-- catalogue metadata a school's own admissions page already shows.
-- =============================================================================

create or replace function classroom.public_school_levels(target_slug text)
returns table (year int, label text)
language sql
stable
security definer
set search_path = classroom, public
as $fn$
  select l.year, l.label
  from classroom.levels l
  join classroom.schools s on s.id = l.school_id
  where s.slug = lower(btrim(target_slug))
    and s.is_active
  order by l.year;
$fn$;

grant execute on function classroom.public_school_levels(text) to anon, authenticated;
