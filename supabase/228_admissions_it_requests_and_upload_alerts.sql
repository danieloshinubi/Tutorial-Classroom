-- Admissions follow-ups.
--
--   upload alerts        an applicant uploading a document now notifies the
--                        school's admissions staff at once (the bell updates
--                        live through 215's broadcast), instead of nobody
--                        knowing until they reloaded the application.
--   IT is the Administrators
--                        a school's IT department is its admins. Every
--                        school gets an "IT (Administrators)" help desk group
--                        for the admin role, alongside 088's Principal,
--                        Bursar, Admissions and Teacher groups.
--   request_student_account
--                        replaces "Register as a student" reusing the
--                        applicant's own sign-in: admissions asks IT for a
--                        fresh school account, which raises a ticket to the
--                        IT (Administrators) group with the pupil's details. Once IT
--                        has made it, admissions registers the pupil with it.
--   ai_usage             a "compose" surface, for the writing helper on every
--                        note and message box.

-- 1. Upload alerts ------------------------------------------------------------------
-- record_applicant_document_upload (104) marks the applicant's checklist item
-- 'uploaded'; that change is the moment to tell staff. Staff acting on the
-- item themselves (verify, reject) never set it to 'uploaded'.
drop trigger if exists notify_application_document on classroom.application_documents;
drop function if exists classroom.notify_application_document();

create or replace function classroom.notify_applicant_document_uploaded()
returns trigger language plpgsql security definer set search_path = classroom, public as $fn$
declare app classroom.applications; doc_name text; me uuid := (select auth.uid());
begin
  if new.status <> 'uploaded' or old.status is not distinct from new.status and old.document_id is not distinct from new.document_id then
    return null;
  end if;
  select * into app from classroom.applications where id = new.application_id;
  if not found then return null; end if;
  select label into doc_name from classroom.document_requirements where id = new.requirement_id;

  insert into classroom.notifications (user_id, school_id, kind, title, body, link)
  select distinct u.user_id, app.school_id, 'admission_document_uploaded',
         format('%s uploaded a document', app.reference),
         format('%s %s uploaded %s.', app.first_name, app.surname, coalesce(doc_name, 'a document')),
         format('/Admissions/%s', app.id)
    from (
      select app.correction_requested_by as user_id
      union select app.assigned_reviewer_id
      union select m.user_id from classroom.school_members m
       where m.school_id = app.school_id and m.is_active and m.granted_via is null
         and m.role in ('owner', 'admin', 'principal', 'admissions')
    ) u
   where u.user_id is not null
     and u.user_id is distinct from me
     -- One alert per person while they have not looked: several files in a
     -- row do not pile up a stack of identical notices.
     and not exists (
       select 1 from classroom.notifications n
        where n.user_id = u.user_id and n.kind = 'admission_document_uploaded'
          and n.link = format('/Admissions/%s', app.id) and n.read_at is null
          and n.created_at > now() - interval '30 minutes');
  return null;
end;
$fn$;
drop trigger if exists notify_applicant_document_uploaded on classroom.applicant_documents;
create trigger notify_applicant_document_uploaded after insert or update of status, document_id on classroom.applicant_documents
  for each row execute function classroom.notify_applicant_document_uploaded();

-- 2. IT is the Administrators -----------------------------------------------------
create or replace function classroom.ensure_it_group(target_school uuid)
returns uuid language plpgsql security definer set search_path = classroom, public as $fn$
declare g uuid;
begin
  select id into g from classroom.ticket_groups
   where school_id = target_school and role = 'admin'
   order by is_active desc, position, created_at limit 1;
  if g is null then
    insert into classroom.ticket_groups (school_id, name, position, role)
    values (target_school, 'IT (Administrators)',
            coalesce((select max(position) + 1 from classroom.ticket_groups where school_id = target_school), 0), 'admin')
    on conflict (school_id, name) do update set role = 'admin', is_active = true
    returning id into g;
  else
    update classroom.ticket_groups set is_active = true where id = g and not is_active;
  end if;
  return g;
end;
$fn$;
revoke all on function classroom.ensure_it_group(uuid) from public, anon, authenticated;

select classroom.ensure_it_group(id) from classroom.schools;

-- 3. Asking IT for a pupil's school account -----------------------------------------
alter table classroom.applications add column if not exists it_ticket_id uuid references classroom.tickets (id) on delete set null;

create or replace function classroom.request_student_account(target_application uuid, note_in text default null)
returns jsonb language plpgsql security definer set search_path = classroom, public as $fn$
declare
  app classroom.applications;
  it_group uuid;
  t classroom.tickets;
  me uuid := auth.uid();
  level_label text;
  class_name text;
  body text;
  existing classroom.tickets;
begin
  select * into app from classroom.applications where id = target_application;
  if not found then raise exception 'No such application'; end if;
  if not (classroom.has_role_in(app.school_id, array['owner','admin','admissions']::classroom.member_role[])
          or coalesce(classroom.module_access(app.school_id, 'admissions') = 'edit', false)) then
    raise exception 'Only admissions staff can ask for a pupil''s account';
  end if;
  if app.status <> 'accepted' then
    raise exception 'Only an accepted applicant can have a school account requested';
  end if;

  -- Already asked, and the ticket is still open: say so rather than ask twice.
  if app.it_ticket_id is not null then
    select * into existing from classroom.tickets where id = app.it_ticket_id;
    if found and existing.status in ('open', 'pending') then
      return jsonb_build_object('ticket_id', existing.id, 'number', existing.number, 'status', existing.status, 'already', true);
    end if;
  end if;

  -- IT is the school's admins.
  it_group := classroom.ensure_it_group(app.school_id);

  select label into level_label from classroom.levels where school_id = app.school_id and year = app.applying_for_level;
  select name into class_name from classroom.classes where id = app.class_id;

  body := concat_ws(E'\n',
    'Please create a school account for a newly admitted pupil.',
    '',
    'Pupil: ' || concat_ws(' ', app.first_name, app.middle_name, app.surname),
    'Application: ' || app.reference,
    case when app.date_of_birth is not null then 'Date of birth: ' || to_char(app.date_of_birth, 'FMDD Mon YYYY') end,
    case when app.gender is not null then 'Gender: ' || initcap(app.gender) end,
    case when coalesce(level_label, app.applying_for_level::text) is not null then 'Level: ' || coalesce(level_label, 'Year ' || app.applying_for_level) end,
    case when class_name is not null then 'Class: ' || class_name end,
    case when app.previous_school is not null then 'Previous school: ' || app.previous_school end,
    '',
    'Parent or guardian: ' || coalesce(app.guardian_name, '—') || case when app.guardian_relation is not null then ' (' || app.guardian_relation || ')' else '' end,
    case when app.guardian_email is not null then 'Guardian email: ' || app.guardian_email end,
    case when app.guardian_phone is not null then 'Guardian phone: ' || app.guardian_phone end,
    case when nullif(btrim(note_in), '') is not null then E'\nNote from admissions: ' || btrim(note_in) end,
    '',
    'When the account is ready, reply here with the pupil''s sign-in email so admissions can register them.');

  t := classroom.create_ticket(
    app.school_id,
    left('New pupil account: ' || concat_ws(' ', app.first_name, app.surname) || ' (' || app.reference || ')', 200),
    body, 'medium', it_group, null, null);

  update classroom.applications set it_ticket_id = t.id where id = app.id;

  -- Tell IT, the school's admins (the owner when it has none).
  insert into classroom.notifications (user_id, school_id, kind, title, body, link)
  select distinct m.user_id, app.school_id, 'ticket_assigned',
         format('New pupil account needed: %s %s', app.first_name, app.surname),
         format('Ticket #%s from admissions.', t.number),
         format('/Tickets/%s', t.id)
    from classroom.school_members m
   where m.school_id = app.school_id and m.is_active and m.granted_via is null
     and (m.role = 'admin'
          or (m.role = 'owner' and not exists (select 1 from classroom.school_members a
                                                where a.school_id = app.school_id and a.role = 'admin' and a.is_active and a.granted_via is null)))
     and m.user_id is distinct from me;

  return jsonb_build_object('ticket_id', t.id, 'number', t.number, 'status', t.status, 'already', false);
end;
$fn$;
revoke all on function classroom.request_student_account(uuid, text) from public, anon;
grant execute on function classroom.request_student_account(uuid, text) to authenticated;

-- 4. The writing helper's usage ------------------------------------------------------
alter table classroom.ai_usage drop constraint if exists ai_usage_surface_check;
alter table classroom.ai_usage add constraint ai_usage_surface_check
  check (surface in ('admissions', 'assistant', 'helpdesk', 'reporting', 'compose'));

notify pgrst, 'reload schema';
