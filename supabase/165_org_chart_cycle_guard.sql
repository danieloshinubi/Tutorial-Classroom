-- =============================================================================
-- classroom.school_members.manager_id (161_chat_reactions_and_org_reporting.sql)
-- only ever blocked reporting directly to yourself. Nothing stopped a longer
-- cycle (A reports to B, B reports to A) from being built one edit at a
-- time, which would turn the org chart into an infinite loop. Same trigger,
-- same policy coverage — just a fuller check in the function body.
-- =============================================================================

create or replace function classroom.validate_school_member_manager()
returns trigger
language plpgsql
security definer
set search_path = classroom, public
as $fn$
declare
  current_manager uuid;
  hops int := 0;
begin
  if new.manager_id is null then
    return new;
  end if;
  if new.manager_id = new.user_id then
    raise exception 'A staff member cannot report to themselves';
  end if;
  if not exists (
    select 1 from classroom.school_members
    where school_id = new.school_id and user_id = new.manager_id and is_active
  ) then
    raise exception 'The selected manager is not an active member of this school';
  end if;

  -- Walk up from the proposed manager; if we ever land back on this
  -- member, the assignment would create a cycle. Capped at 50 hops as a
  -- backstop against any pre-existing bad data looping forever.
  current_manager := new.manager_id;
  while current_manager is not null and hops < 50 loop
    if current_manager = new.user_id then
      raise exception 'That would create a reporting cycle — this person already reports, directly or indirectly, to the selected manager';
    end if;
    select manager_id into current_manager
    from classroom.school_members
    where school_id = new.school_id and user_id = current_manager;
    hops := hops + 1;
  end loop;

  return new;
end;
$fn$;

notify pgrst, 'reload schema';
