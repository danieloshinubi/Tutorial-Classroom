-- =============================================================================
-- Schoolivio's trial period is now 1.5 months (45 days), not 15 — both places
-- that start a fresh trial (self-serve signup and the platform console's own
-- "Add a school") need the same number, or a school made one way would get a
-- shorter runway than one made the other way for no real reason.
-- =============================================================================

create or replace function classroom.start_trial_school(
  school_name text,
  school_slug text
)
returns classroom.schools
language plpgsql security definer
set search_path = classroom, public as $$
declare
  clean_name text := btrim(school_name);
  clean_slug text := lower(btrim(school_slug));
  new_school classroom.schools;
begin
  if clean_name = '' or clean_slug = '' then
    raise exception 'A school needs a name and an address.';
  end if;

  if exists (select 1 from classroom.schools where slug = clean_slug) then
    raise exception 'That subdomain is already taken';
  end if;

  insert into classroom.schools (name, slug, plan, trial_ends_at, is_active)
  values (clean_name, clean_slug, 'trial', now() + interval '45 days', true)
  returning * into new_school;

  insert into classroom.school_members (school_id, user_id, role)
  values (new_school.id, auth.uid(), 'owner')
  on conflict (school_id, user_id) do nothing;

  return new_school;
end;
$$;

grant execute on function classroom.start_trial_school(text, text) to authenticated;

create or replace function classroom.create_school(
  school_name text,
  school_slug text,
  owner_email text default null
)
returns classroom.schools
language plpgsql security definer
set search_path = classroom, public as $$
declare
  created classroom.schools;
  owner   uuid;
begin
  if not classroom.is_platform_admin() then
    raise exception 'Only platform administrators can create a school';
  end if;

  insert into classroom.schools (name, slug, plan, trial_ends_at)
  values (btrim(school_name), lower(btrim(school_slug)), 'trial', now() + interval '45 days')
  returning * into created;

  if owner_email is not null then
    select id into owner from classroom.profiles where email = lower(btrim(owner_email));
  end if;

  insert into classroom.school_members (school_id, user_id, role)
  values (created.id, coalesce(owner, auth.uid()), 'owner')
  on conflict (school_id, user_id) do update set role = 'owner';

  return created;
end;
$$;

grant execute on function classroom.create_school(text, text, text) to authenticated;

notify pgrst, 'reload schema';
