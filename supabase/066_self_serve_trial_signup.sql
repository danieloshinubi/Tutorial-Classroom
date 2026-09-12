-- =============================================================================
-- Self-serve trial signup
--
-- classroom.create_school() (011_close_tenancy.sql) is the vendor's own tool
-- — it checks is_platform_admin() and stays exactly as it is. This is the
-- public front door instead: anyone can start their own school on a 15-day
-- trial and become its owner in the same breath, no platform staff involved.
-- =============================================================================

alter table classroom.schools
  add column if not exists trial_ends_at timestamptz;

-- A school on a live (non-expired) trial, or on a paid plan, is functional.
-- A school whose trial has lapsed is not — read anywhere that needs to tell
-- the difference (the app gates on this via SchoolContext).
comment on column classroom.schools.trial_ends_at is
  'When this school''s trial period ends. Null for a school that was never on a trial (created directly via the platform console with a paid plan). Irrelevant once plan is no longer ''trial''.';


/* -------------------------------------------------------------------------- */
/* Slug availability — checked before signup ever creates an auth user, so    */
/* the visitor finds out their chosen subdomain is taken before anything     */
/* else happens. schools.slug can't be read by anon (RLS scopes it to        */
/* members), so this is a narrow SECURITY DEFINER answer: true/false only,   */
/* never the row itself.                                                     */
/* -------------------------------------------------------------------------- */
create or replace function classroom.slug_available(candidate text)
returns boolean
language sql stable security definer
set search_path = classroom, public
as $fn$
  select
    candidate ~ '^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])?$'
    and candidate <> all (array['www','app','api','admin','static','cdn','mail'])
    and not exists (select 1 from classroom.schools where slug = lower(candidate));
$fn$;

grant execute on function classroom.slug_available(text) to anon, authenticated;


/* -------------------------------------------------------------------------- */
/* start_trial_school — the actual signup action. Any signed-in user (they   */
/* must already have an auth session — the signup form creates that first)  */
/* who is not yet a member of any school under this name/slug becomes the   */
/* owner of a brand-new one, on a 15-day trial, self-configured from there   */
/* via School administration → Admissions settings and everything else —    */
/* no platform staff, no code, ever involved.                               */
/* -------------------------------------------------------------------------- */
create or replace function classroom.start_trial_school(
  school_name text,
  school_slug text
) returns classroom.schools
language plpgsql security definer
set search_path = classroom, public
as $fn$
declare
  clean_slug text := lower(btrim(school_slug));
  clean_name text := btrim(school_name);
  new_school classroom.schools;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to start a trial';
  end if;

  if clean_name = '' then
    raise exception 'Give your school a name';
  end if;

  if clean_slug !~ '^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])?$' then
    raise exception 'Your subdomain must be 3-40 characters: lowercase letters, numbers and hyphens, and can''t start or end with a hyphen';
  end if;

  if clean_slug = any (array['www','app','api','admin','static','cdn','mail']::text[]) then
    raise exception 'That subdomain is reserved';
  end if;

  if exists (select 1 from classroom.schools where slug = clean_slug) then
    raise exception 'That subdomain is already taken';
  end if;

  insert into classroom.schools (name, slug, plan, trial_ends_at, is_active)
  values (clean_name, clean_slug, 'trial', now() + interval '15 days', true)
  returning * into new_school;

  insert into classroom.school_members (school_id, user_id, role)
  values (new_school.id, auth.uid(), 'owner')
  on conflict (school_id, user_id) do nothing;

  return new_school;
end;
$fn$;

grant execute on function classroom.start_trial_school(text, text) to authenticated;

notify pgrst, 'reload schema';
