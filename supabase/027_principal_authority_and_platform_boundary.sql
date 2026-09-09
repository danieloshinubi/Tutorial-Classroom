-- =============================================================================
-- Two decisions, made explicit
--
-- 1. A principal is the academic head, so they decide admissions and may
--    manage any course in their school — not only ones they own. They still
--    do NOT administer accounts or school settings: that stays with the
--    proprietor and administrators.
--
-- 2. A Schoolivio platform administrator is no longer an invisible super-user
--    inside every tenant.
--
--    has_role_in() answered true for any platform admin, in every school, for
--    every role. That one line meant vendor staff passed every check at every
--    tenant: unreleased results, applicants' birth certificates, fees, all of
--    it. The console does not need that — it reads its cross-tenant figures
--    through SECURITY DEFINER functions that check is_platform_admin()
--    themselves — so the blanket bypass is removed here.
--
--    Consequence, stated plainly: after this, a platform admin who needs to
--    act inside a school must be given a membership of that school like
--    anybody else. That is the point.
-- =============================================================================

/* -----------------------------------------------------------------------------
   1 — The platform boundary
   -------------------------------------------------------------------------- */
create or replace function classroom.has_role_in(
  target_school uuid,
  roles classroom.member_role[]
)
returns boolean
language sql
stable
security definer
set search_path = classroom, public
as $fn$
  -- Membership only. Being a platform administrator is not a role at any
  -- school and no longer satisfies one; see the header.
  select target_school is not null and exists (
    select 1 from classroom.school_members
    where user_id = auth.uid()
      and school_id = target_school
      and is_active
      and role = any(roles)
  );
$fn$;

/* -----------------------------------------------------------------------------
   2 — Who may act on an application

   One helper instead of the same four-role array written out at eight
   different sites, so widening or narrowing admissions authority is a
   one-line change next time rather than an archaeology exercise.
   -------------------------------------------------------------------------- */
create or replace function classroom.can_do_admissions(target_school uuid)
returns boolean
language sql
stable
security definer
set search_path = classroom, public
as $fn$
  select classroom.has_role_in(
    target_school,
    array['owner', 'admin', 'principal', 'admissions']::classroom.member_role[]
  );
$fn$;

grant execute on function classroom.can_do_admissions(uuid) to authenticated;

/* --- applications --------------------------------------------------------- */
drop policy if exists "admissions staff read applications" on classroom.applications;
create policy "admissions staff read applications"
  on classroom.applications for select to authenticated
  using (
    classroom.can_do_admissions(school_id)
    or student_id = auth.uid()
    or lower(guardian_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

drop policy if exists "admissions staff update applications" on classroom.applications;
create policy "admissions staff update applications"
  on classroom.applications for update to authenticated
  using (classroom.can_do_admissions(school_id))
  with check (classroom.can_do_admissions(school_id));

/* --- documents and events ------------------------------------------------- */
drop policy if exists "read documents of readable applications" on classroom.application_documents;
create policy "read documents of readable applications"
  on classroom.application_documents for select to authenticated
  using (
    exists (
      select 1 from classroom.applications a
      where a.id = application_documents.application_id
        and (
          classroom.can_do_admissions(a.school_id)
          or lower(a.guardian_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
        )
    )
  );

drop policy if exists "admissions staff manage documents" on classroom.application_documents;
create policy "admissions staff manage documents"
  on classroom.application_documents for all to authenticated
  using (
    exists (
      select 1 from classroom.applications a
      where a.id = application_documents.application_id
        and classroom.can_do_admissions(a.school_id)
    )
  )
  with check (
    exists (
      select 1 from classroom.applications a
      where a.id = application_documents.application_id
        and classroom.can_do_admissions(a.school_id)
    )
  );

drop policy if exists "read events of readable applications" on classroom.application_events;
create policy "read events of readable applications"
  on classroom.application_events for select to authenticated
  using (
    exists (
      select 1 from classroom.applications a
      where a.id = application_events.application_id
        and (
          classroom.can_do_admissions(a.school_id)
          or lower(a.guardian_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
        )
    )
  );

/* --- the documents themselves, in storage --------------------------------- */
drop policy if exists "admissions staff upload documents" on storage.objects;
create policy "admissions staff upload documents"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'course-materials'
    and (storage.foldername(name))[1] = 'admissions'
    and classroom.can_do_admissions(classroom.try_uuid((storage.foldername(name))[2]))
  );

drop policy if exists "admissions staff delete documents" on storage.objects;
create policy "admissions staff delete documents"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'course-materials'
    and (storage.foldername(name))[1] = 'admissions'
    and classroom.can_do_admissions(classroom.try_uuid((storage.foldername(name))[2]))
  );

drop policy if exists "read course files and admissions documents" on storage.objects;
create policy "read course files and admissions documents"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'course-materials'
    and case
      when (storage.foldername(name))[1] = 'admissions' then
        classroom.can_do_admissions(classroom.try_uuid((storage.foldername(name))[2]))
      else
        classroom.is_enrolled_in(classroom.try_uuid((storage.foldername(name))[1]))
        or classroom.can_manage_course(classroom.try_uuid((storage.foldername(name))[1]))
    end
  );

/* --- the decision itself -------------------------------------------------- */
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
as $fn$
declare
  app     classroom.applications;
  allowed classroom.application_status[];
  was     classroom.application_status;
  who     text;
begin
  select * into app from classroom.applications where id = target_application;
  if not found then
    raise exception 'No such application';
  end if;

  if not classroom.can_do_admissions(app.school_id) then
    raise exception 'Only admissions staff can decide an application';
  end if;

  was := app.status;

  allowed := case was
    when 'submitted' then array['screening','offered','rejected','withdrawn']::classroom.application_status[]
    when 'screening' then array['offered','rejected','withdrawn']::classroom.application_status[]
    when 'offered'   then array['accepted','declined','rejected','withdrawn']::classroom.application_status[]
    when 'accepted'  then array['enrolled','withdrawn']::classroom.application_status[]
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

  insert into classroom.notifications (user_id, school_id, kind, title, body, link)
  select p.id, app.school_id, 'application_' || new_status::text,
         format('%s: application %s', app.reference, new_status),
         format('%s %s', app.first_name, app.surname),
         '/Apply/Status'
  from classroom.profiles p
  where lower(p.email) = lower(app.guardian_email);

  return app;
end;
$fn$;

/* -----------------------------------------------------------------------------
   3 — A principal may manage any course in their school

   Note what this does NOT touch: is_school_admin() still means owner or
   administrator, so account creation, roles and school settings are unchanged.
   -------------------------------------------------------------------------- */
create or replace function classroom.can_manage_course(target_course uuid)
returns boolean
language sql
stable
security definer
set search_path = classroom, public
as $fn$
  select exists (
    select 1 from classroom.courses c
    where c.id = target_course
      and (
        c.owner_id = auth.uid()
        or classroom.is_school_admin(c.school_id)
        or classroom.has_role_in(
             c.school_id, array['principal']::classroom.member_role[]
           )
      )
  );
$fn$;

/* --- and hears about submitted results, and applications ------------------ */
-- The notification fan-out lists roles literally in a few places; a principal
-- who approves results and decides admissions needs to be told about both.
create or replace function classroom.submit_result_sheet(
  target_sheet uuid,
  note         text default null
)
returns classroom.result_sheets
language plpgsql security definer
set search_path = classroom, public as $fn$
declare
  sheet  classroom.result_sheets;
  was    classroom.result_status;
  blanks int;
begin
  select * into sheet from classroom.result_sheets where id = target_sheet;
  if not found then
    raise exception 'No such result sheet';
  end if;

  if not classroom.can_manage_course(sheet.course_id) then
    raise exception 'Only the teacher of this course can submit its results';
  end if;

  if sheet.status not in ('draft', 'returned') then
    raise exception 'A sheet that is % cannot be submitted', sheet.status;
  end if;

  select count(*) into blanks from classroom.result_entries
  where sheet_id = target_sheet and ca_score is null and exam_score is null;

  if blanks > 0 then
    raise exception '% student(s) have no marks yet', blanks;
  end if;

  was := sheet.status;

  update classroom.result_sheets
  set status = 'submitted', submitted_by = auth.uid(),
      submitted_at = now(), updated_at = now()
  where id = target_sheet
  returning * into sheet;

  insert into classroom.result_events
    (sheet_id, status_from, status_to, actor_id, actor_label, note)
  values (target_sheet, was, 'submitted', auth.uid(), classroom.actor_label(), note);

  insert into classroom.notifications (user_id, school_id, kind, title, body, link)
  select m.user_id, sheet.school_id, 'results_submitted',
         format('Results to approve: %s', c.code),
         format('Submitted by %s', classroom.actor_label()),
         format('/Results/%s', sheet.id)
  from classroom.school_members m, classroom.courses c
  where c.id = sheet.course_id
    and m.school_id = sheet.school_id and m.is_active
    and m.role in ('owner', 'admin', 'principal')
    and m.user_id <> auth.uid();

  return sheet;
end;
$fn$;

notify pgrst, 'reload schema';
