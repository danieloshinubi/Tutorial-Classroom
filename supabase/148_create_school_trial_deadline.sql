-- =============================================================================
-- Bug found while looking at the new Trials page: Jane-Nath, Dowen and LPSS
-- all show "not set" for their trial deadline, while De-Young shows a real
-- date. The difference is which door they came through — 066's own
-- start_trial_school() (the self-serve /StartTrial signup) has always set
-- trial_ends_at = now() + 15 days, but 011's create_school() (the platform
-- console's "Add a school" button, used for the other three) never set it
-- at all. A school created that way has no trial deadline, so TrialGate
-- never locks it out and Overview's/Trials' "at risk" detection can never
-- catch it either — not a display bug, a real gap in the one other place a
-- school gets created. Matches start_trial_school's own default exactly.
-- =============================================================================

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
  values (btrim(school_name), lower(btrim(school_slug)), 'trial', now() + interval '15 days')
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
