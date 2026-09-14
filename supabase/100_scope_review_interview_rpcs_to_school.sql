-- =============================================================================
-- Scope assign_review(), schedule_interview() and record_interview_outcome()
-- to the caller's current school — same class of gap as 095-099.
-- =============================================================================

drop function if exists classroom.assign_review(uuid, uuid);

create or replace function classroom.assign_review(
  target_application uuid,
  target_reviewer    uuid,
  target_school      uuid
) returns classroom.application_reviews
language plpgsql security definer
set search_path = classroom, public
as $fn$
declare
  app  classroom.applications;
  rev  classroom.application_reviews;
  reviewer_is_staff boolean;
begin
  select * into app from classroom.applications where id = target_application;
  if not found then
    raise exception 'No such application';
  end if;

  if app.school_id <> target_school then
    raise exception 'Application does not belong to the current school';
  end if;

  if not classroom.can_do_admissions(app.school_id) then
    raise exception 'Only admissions staff can assign a review';
  end if;

  -- The reviewer must be a school member with admissions authority.
  select classroom.has_role_in(app.school_id, array['owner','admin','principal','admissions']::classroom.member_role[])
    from classroom.school_members m
   where m.user_id = target_reviewer and m.school_id = app.school_id and m.is_active
   limit 1
   into reviewer_is_staff;

  if not coalesce(reviewer_is_staff, false) then
    -- Fallback: check role directly on school_members
    if not exists (
      select 1 from classroom.school_members m
      where m.user_id = target_reviewer
        and m.school_id = app.school_id
        and m.is_active
        and m.role in ('owner','admin','principal','admissions')
    ) then
      raise exception 'The reviewer must be an admissions member of this school';
    end if;
  end if;

  -- Close any active review before re-assigning.
  update classroom.application_reviews
  set completed_at = now(), updated_at = now(),
      notes = coalesce(notes, '') || case when notes is null then '' else E'\n' end
              || '[Reassigned]'
  where application_id = target_application and completed_at is null;

  insert into classroom.application_reviews
    (application_id, reviewer_id, assigned_by, assigned_at)
  values (target_application, target_reviewer, auth.uid(), now())
  returning * into rev;

  update classroom.applications
  set review_state = 'assigned',
      assigned_reviewer_id = target_reviewer,
      updated_at = now()
  where id = target_application;

  insert into classroom.application_events
    (application_id, status_from, status_to, actor_id, actor_label, note)
  values
    (target_application, app.status, app.status, auth.uid(), classroom.admissions_actor_label(),
     'Review assigned');

  -- Notify the reviewer.
  insert into classroom.notifications (user_id, school_id, kind, title, body, link)
  values
    (target_reviewer, app.school_id, 'review_assigned',
     format('Review assigned: %s', app.reference),
     'Open the admissions workspace to record your recommendation.',
     format('/Admissions/%s', app.id));

  return rev;
end;
$fn$;

grant execute on function classroom.assign_review(uuid, uuid, uuid) to authenticated;

drop function if exists classroom.schedule_interview(uuid, timestamptz, text, text, uuid);

create or replace function classroom.schedule_interview(
  target_application uuid,
  when_at            timestamptz,
  target_school      uuid,
  location_in        text default null,
  meeting_link_in    text default null,
  interviewer_in     uuid default null
) returns classroom.application_interviews
language plpgsql security definer
set search_path = classroom, public
as $fn$
declare
  app classroom.applications;
  itv classroom.application_interviews;
  cfg jsonb;
begin
  select * into app from classroom.applications where id = target_application;
  if not found then
    raise exception 'No such application';
  end if;
  if app.school_id <> target_school then
    raise exception 'Application does not belong to the current school';
  end if;
  if not classroom.can_do_admissions(app.school_id) then
    raise exception 'Only admissions staff can schedule an interview';
  end if;

  cfg := classroom.effective_admission_config(app.school_id, app.session_id);
  if not coalesce((cfg->>'require_interview')::boolean, false) then
    raise exception 'Interviews are not enabled for this session/programme';
  end if;

  if when_at < now() then
    raise exception 'The interview must be scheduled in the future';
  end if;

  insert into classroom.application_interviews
    (application_id, scheduled_at, location, meeting_link, interviewer_id, scheduled_by)
  values (target_application, when_at, location_in, meeting_link_in, interviewer_in, auth.uid())
  returning * into itv;

  update classroom.applications
  set interview_state = 'scheduled', updated_at = now()
  where id = target_application;

  insert into classroom.application_events
    (application_id, status_from, status_to, actor_id, actor_label, note)
  values
    (target_application, app.status, app.status, auth.uid(), classroom.admissions_actor_label(),
     format('Interview scheduled for %s%s',
       to_char(when_at, 'DD Mon YYYY HH24:MI'),
       case when location_in is not null then ' at ' || location_in else '' end));

  -- Notify the applicant.
  insert into classroom.notifications (user_id, school_id, kind, title, body, link)
  select ac.user_id, app.school_id, 'interview_scheduled',
         format('Interview scheduled: %s', app.reference),
         format('Your interview is scheduled for %s.', to_char(when_at, 'DD Mon YYYY HH24:MI')),
         format('/Applications/%s', app.id)
  from classroom.applicant_accounts ac
  where ac.id = app.applicant_id;

  return itv;
end;
$fn$;

grant execute on function classroom.schedule_interview(uuid, timestamptz, uuid, text, text, uuid) to authenticated;

drop function if exists classroom.record_interview_outcome(uuid, text, text, text);

create or replace function classroom.record_interview_outcome(
  target_interview uuid,
  new_status       text,
  target_school    uuid,
  outcome_in       text default null,
  notes_in         text default null
) returns classroom.application_interviews
language plpgsql security definer
set search_path = classroom, public
as $fn$
declare
  itv classroom.application_interviews;
  app classroom.applications;
begin
  select * into itv from classroom.application_interviews where id = target_interview;
  if not found then
    raise exception 'No such interview';
  end if;
  select * into app from classroom.applications where id = itv.application_id;

  if app.school_id <> target_school then
    raise exception 'Interview does not belong to the current school';
  end if;

  if not (classroom.can_do_admissions(app.school_id)
          or itv.interviewer_id = auth.uid()) then
    raise exception 'Only the interviewer or admissions staff can record the outcome';
  end if;

  if new_status not in ('completed','no_show','cancelled') then
    raise exception 'Unknown interview outcome: %', new_status;
  end if;

  if new_status = 'completed' and outcome_in is null then
    raise exception 'A completed interview needs an outcome (pass/fail/inconclusive)';
  end if;

  update classroom.application_interviews
  set status = new_status,
      outcome = outcome_in,
      notes = coalesce(notes_in, notes),
      decided_by = auth.uid(),
      decided_at = now(),
      updated_at = now()
  where id = target_interview
  returning * into itv;

  update classroom.applications
  set interview_state = new_status, updated_at = now()
  where id = app.id;

  insert into classroom.application_events
    (application_id, status_from, status_to, actor_id, actor_label, note)
  values
    (app.id, app.status, app.status, auth.uid(), classroom.admissions_actor_label(),
     format('Interview %s%s%s',
       new_status,
       case when outcome_in is not null then ' — ' || outcome_in else '' end,
       case when notes_in is not null then E'\n' || notes_in else '' end));

  return itv;
end;
$fn$;

grant execute on function classroom.record_interview_outcome(uuid, text, uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
