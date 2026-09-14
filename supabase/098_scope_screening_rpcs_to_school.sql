-- =============================================================================
-- Scope create_application_screening_items() and set_screening_item_status()
-- to the caller's current school — same class of gap as 095/096/097: each
-- authorizes via can_do_admissions(row's real school_id), correct for that
-- row's school but blind to which tenant the caller currently has open.
-- =============================================================================

drop function if exists classroom.create_application_screening_items(uuid);

create or replace function classroom.create_application_screening_items(
  target_application uuid,
  target_school      uuid
) returns setof classroom.application_screening_items
language plpgsql security definer
set search_path = classroom, public
as $fn$
declare
  app classroom.applications;
begin
  select * into app from classroom.applications where id = target_application;
  if not found then
    raise exception 'No such application';
  end if;
  if app.school_id <> target_school then
    raise exception 'Application does not belong to this school';
  end if;
  if not classroom.can_do_admissions(app.school_id) then
    raise exception 'Only admissions staff can prepare screening items';
  end if;

  insert into classroom.application_screening_items
    (application_id, requirement_id, kind, label, is_required, position)
  select
    target_application, r.id, r.kind, r.label, r.is_required, r.position
  from classroom.screening_requirements r
  where r.school_id = app.school_id
    and (r.session_id is null   or r.session_id   = app.session_id)
    and (r.programme_id is null or r.programme_id = app.programme_id)
    and not exists (
      select 1 from classroom.application_screening_items i
      where i.application_id = target_application and i.kind = r.kind
    );

  return query
    select * from classroom.application_screening_items
    where application_id = target_application
    order by position, label;
end;
$fn$;

grant execute on function classroom.create_application_screening_items(uuid, uuid) to authenticated;

drop function if exists classroom.set_screening_item_status(uuid, text, text);

create or replace function classroom.set_screening_item_status(
  target_item   uuid,
  target_school uuid,
  new_status    text,
  note_in       text default null
) returns classroom.application_screening_items
language plpgsql security definer
set search_path = classroom, public
as $fn$
declare
  item classroom.application_screening_items;
  app  classroom.applications;
  was  text;
  new_screening_state text;
begin
  select * into item from classroom.application_screening_items where id = target_item;
  if not found then
    raise exception 'No such screening item';
  end if;
  select * into app from classroom.applications where id = item.application_id;

  if app.school_id <> target_school then
    raise exception 'Screening item does not belong to the current school';
  end if;

  if not classroom.can_do_admissions(app.school_id) then
    raise exception 'Only admissions staff can move a screening item';
  end if;

  if new_status not in ('pending','passed','failed','waived','correction_required') then
    raise exception 'Unknown screening status: %', new_status;
  end if;

  if new_status = 'failed' and btrim(coalesce(note_in, '')) = '' then
    raise exception 'A failed screening item must carry a reason';
  end if;
  if new_status = 'correction_required' and btrim(coalesce(note_in, '')) = '' then
    raise exception 'A correction request must carry a reason';
  end if;

  was := item.status;

  if was = new_status then
    return item;
  end if;

  update classroom.application_screening_items
  set status = new_status,
      decided_by = auth.uid(),
      decided_at = now(),
      decision_note = coalesce(note_in, decision_note),
      updated_at = now()
  where id = target_item
  returning * into item;

  -- Aggregate state.
  new_screening_state := case
    when exists (
      select 1 from classroom.application_screening_items i
      where i.application_id = app.id and i.is_required
        and i.status not in ('passed','waived')
    ) and exists (
      select 1 from classroom.application_screening_items i
      where i.application_id = app.id and i.status = 'failed'
    ) then 'failed'
    when exists (
      select 1 from classroom.application_screening_items i
      where i.application_id = app.id and i.status = 'correction_required'
    ) then 'correction_required'
    when not exists (
      select 1 from classroom.application_screening_items i
      where i.application_id = app.id and i.is_required
        and i.status not in ('passed','waived')
    ) then 'passed'
    else 'in_progress'
  end;

  update classroom.applications
  set screening_state = new_screening_state,
      screening_completed_at = case
        when new_screening_state in ('passed','failed') then now()
        else null
      end,
      updated_at = now()
  where id = app.id;

  insert into classroom.application_events
    (application_id, status_from, status_to, actor_id, actor_label, note)
  values
    (app.id, app.status, app.status, auth.uid(), classroom.admissions_actor_label(),
     format('Screening item %s → %s%s', item.kind, new_status,
            case when note_in is not null then ' — ' || note_in else '' end));

  return item;
end;
$fn$;

grant execute on function classroom.set_screening_item_status(uuid, uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
