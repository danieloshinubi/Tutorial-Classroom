-- =============================================================================
-- Trial lifecycle — today a self-serve trial (066_self_serve_trial_signup.sql)
-- hard-locks a school out 15 days after signup (TrialGate.jsx) with the only
-- way back in being an email to hello@schoolivio.com, and the only fix on
-- this end being to change the school's plan away from 'trial' entirely —
-- nothing lets platform staff just grant more trial time, and nothing shows
-- which schools are about to hit that wall before they already have and
-- complained. This adds both: platform_schools() now carries trial_ends_at
-- so the console can flag "expiring soon"/"expired" itself, and
-- platform_extend_trial() pushes the date forward without touching plan —
-- an explicit "give them more time", distinct from "convert them to a paid
-- plan".
-- =============================================================================

drop function if exists classroom.platform_schools();

create or replace function classroom.platform_schools()
returns table (
  id             uuid,
  name           text,
  slug           text,
  plan           text,
  is_active      boolean,
  created_at     timestamptz,
  trial_ends_at  timestamptz,
  members        int,
  students       int,
  teachers       int,
  courses        int
)
language sql stable security definer
set search_path = classroom, public as $$
  select
    s.id, s.name, s.slug, s.plan, s.is_active, s.created_at, s.trial_ends_at,
    (select count(*)::int from classroom.school_members m
      where m.school_id = s.id and m.is_active),
    (select count(*)::int from classroom.school_members m
      where m.school_id = s.id and m.is_active and m.role = 'student'),
    (select count(*)::int from classroom.school_members m
      where m.school_id = s.id and m.is_active and m.role = 'teacher'),
    (select count(*)::int from classroom.courses c where c.school_id = s.id)
  from classroom.schools s
  where classroom.is_platform_admin()
  order by s.created_at desc;
$$;

grant execute on function classroom.platform_schools() to authenticated;

-- Pushes trial_ends_at forward by `days` from whichever is later — today,
-- or the school's own current trial_ends_at. The "later of the two" is
-- deliberate: extending an ALREADY-expired trial by 15 days should give it
-- 15 fresh days from now, not 15 days from a date that already passed
-- (which could still land in the past and change nothing).
create or replace function classroom.platform_extend_trial(target_school uuid, days int)
returns classroom.schools
language plpgsql
security definer
set search_path = classroom, public
as $fn$
declare
  row classroom.schools;
begin
  if not classroom.is_platform_admin() then
    raise exception 'Only a platform administrator can extend a trial';
  end if;
  if days is null or days <= 0 then
    raise exception 'Extend by how many days?';
  end if;

  update classroom.schools
  set trial_ends_at = greatest(now(), coalesce(trial_ends_at, now())) + make_interval(days => days)
  where id = target_school and plan = 'trial'
  returning * into row;

  if not found then
    raise exception 'No such school, or it is not on the trial plan';
  end if;

  return row;
end;
$fn$;

grant execute on function classroom.platform_extend_trial(uuid, int) to authenticated;

notify pgrst, 'reload schema';
