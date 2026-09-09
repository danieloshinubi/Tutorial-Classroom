-- =============================================================================
-- Fix: every admissions decision failed with
--
--   CASE/WHEN could not convert type text[] to application_status[]
--
-- The state machine built its list of permitted next statuses as
--
--   allowed := case app.status
--     when 'submitted' then array['screening', ...]        -- text[]
--     ...
--     else array[]::classroom.application_status[]         -- application_status[]
--   end::classroom.application_status[];
--
-- Postgres has to settle on ONE result type for the CASE before the trailing
-- cast is applied, and it cannot reconcile text[] with application_status[].
-- Casting each branch instead of the whole expression settles it up front.
--
-- Two further corrections while the function is being rewritten:
--
--   * The history recorded the wrong starting point. `update ... returning *
--     into app` overwrote app with the NEW row, and status_from was read from
--     it afterwards — so every event said it moved from a status to itself.
--     The old status is now captured before the update.
--
--   * `if app is null` is replaced with `if not found`. A composite is NULL
--     only when every one of its fields is null, which is a fragile way to
--     ask whether a row was returned.
-- =============================================================================

create or replace function classroom.decide_application(
  target_application uuid,
  new_status classroom.application_status,
  note text default null,
  offer_expires timestamptz default null
)
returns classroom.applications
language plpgsql
security definer
set search_path = classroom, public
as $$
declare
  app        classroom.applications;
  allowed    classroom.application_status[];
  was        classroom.application_status;
  who        text;
begin
  select * into app from classroom.applications where id = target_application;
  if not found then
    raise exception 'No such application';
  end if;

  if not classroom.has_role_in(
       app.school_id,
       array['owner','admin','admissions']::classroom.member_role[]
     ) then
    raise exception 'Only admissions staff can decide an application';
  end if;

  was := app.status;

  allowed := case was
    when 'submitted' then array['screening','offered','rejected','withdrawn']::classroom.application_status[]
    when 'screening' then array['offered','rejected','withdrawn']::classroom.application_status[]
    when 'offered'   then array['accepted','declined','rejected','withdrawn']::classroom.application_status[]
    when 'accepted'  then array['enrolled','withdrawn']::classroom.application_status[]
    -- A rejected or withdrawn application can be reopened, because schools
    -- change their minds and a family can appeal.
    when 'rejected'  then array['screening']::classroom.application_status[]
    when 'withdrawn' then array['screening']::classroom.application_status[]
    when 'declined'  then array['offered']::classroom.application_status[]
    else array[]::classroom.application_status[]
  end;

  if new_status = was then
    return app;
  end if;

  if not (new_status = any(allowed)) then
    raise exception 'An application that is % cannot become %', was, new_status;
  end if;

  -- Enrolment is not a plain status change: it needs an account and a class,
  -- so it goes through enrol_applicant().
  if new_status = 'enrolled' then
    raise exception 'Use enrol_applicant() to enrol — a student account and class are required';
  end if;

  select coalesce(nullif(btrim(p.first_name || ' ' || p.surname), ''), p.email)
  into who from classroom.profiles p where p.id = auth.uid();

  update classroom.applications
  set status = new_status,
      decided_by = auth.uid(),
      decided_at = now(),
      updated_at = now(),
      offer_expires_at = case
        when new_status = 'offered' then coalesce(offer_expires, now() + interval '14 days')
        else offer_expires_at
      end
  where id = target_application
  returning * into app;

  insert into classroom.application_events
    (application_id, status_from, status_to, actor_id, actor_label, note)
  values (target_application, was, new_status, auth.uid(), who, note);

  -- Keep the family informed if they happen to hold an account here.
  insert into classroom.notifications (user_id, school_id, kind, title, body, link)
  select p.id, app.school_id, 'application_' || new_status::text,
         format('%s: application %s', app.reference, new_status),
         format('%s %s', app.first_name, app.surname),
         '/Apply/Status'
  from classroom.profiles p
  where lower(p.email) = lower(app.guardian_email);

  return app;
end;
$$;

notify pgrst, 'reload schema';
