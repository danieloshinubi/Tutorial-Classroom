-- Free trial: 45 days -> 30 days, for schools that start a trial from now on.
--
-- 45 days was judged too generous. Only the length changes: both functions
-- below are the live definitions as read from the database, with the one
-- interval edited and nothing else, so nothing else about starting a school
-- moves. Same signatures, so create or replace updates them in place.
--
-- Schools already on a trial are deliberately NOT shortened. Eight were
-- mid-trial when this ran, told 45 days when they signed up; cutting a
-- promised trial is hard to walk back, and it was not asked for. The
-- platform console can still extend (platform_extend_trial) a trial, and a
-- backfill like 150/152 can shorten them if that is ever decided.
--
-- The wording that states the length lives in the app: TrialGate.jsx,
-- marketing/StartTrial.jsx and marketing/Landing.jsx were changed with this.

CREATE OR REPLACE FUNCTION classroom.create_school(school_name text, school_slug text, owner_email text DEFAULT NULL::text)
 RETURNS classroom.schools
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'classroom', 'public'
AS $function$
declare
  created classroom.schools;
  owner   uuid;
begin
  if not classroom.is_platform_admin() then
    raise exception 'Only platform administrators can create a school';
  end if;

  insert into classroom.schools (name, slug, plan, trial_ends_at)
  values (btrim(school_name), lower(btrim(school_slug)), 'trial', now() + interval '30 days')
  returning * into created;

  if owner_email is not null then
    select id into owner from classroom.profiles where email = lower(btrim(owner_email));
  end if;

  insert into classroom.school_members (school_id, user_id, role)
  values (created.id, coalesce(owner, auth.uid()), 'owner')
  on conflict (school_id, user_id) do update set role = 'owner';

  return created;
end;
$function$;

CREATE OR REPLACE FUNCTION classroom.start_trial_school(school_name text, school_slug text)
 RETURNS classroom.schools
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'classroom', 'public'
AS $function$
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
  values (clean_name, clean_slug, 'trial', now() + interval '30 days', true)
  returning * into new_school;

  insert into classroom.school_members (school_id, user_id, role)
  values (new_school.id, auth.uid(), 'owner')
  on conflict (school_id, user_id) do nothing;

  return new_school;
end;
$function$;

