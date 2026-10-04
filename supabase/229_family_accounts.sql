-- IT creating a newly admitted pupil's accounts (after 228's request).
--
--   The request ticket now carries the parent's details too (guardian, home
--   address, next of kin, the address they applied with), so IT can make the
--   parent's account and link it to the child.
--   "Create pupil & parent accounts" on the ticket (Edge Function
--   create-family-accounts) makes both logins with temporary passwords,
--   reuses the parent's login if their email already has one, links parent
--   and pupil, emails the sign-in details and the portal address to the
--   family, notes it on the ticket and resolves it, and tells admissions.
--   finish_family_accounts is the database half of that, for the service role.
--   Pupils sign in with a username (their email if they have one):
--   sign_in_email turns a username into the address to sign in with, only for
--   an active member of the school whose address it is.
--   applications.student_account_id remembers the pupil's new account so
--   "Register this pupil" has it chosen already.

alter table classroom.applications add column if not exists student_account_id uuid references auth.users (id) on delete set null;

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
  applied_with text;
  kin jsonb;
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

  applied_with := (select email from classroom.applicant_accounts where id = app.applicant_id);
  kin := coalesce(app.next_of_kin, '{}'::jsonb);
  body := concat_ws(E'\n',
    'Please create school accounts for a newly admitted pupil and their parent, and link the parent to the pupil.',
    'Use "Create pupil & parent accounts" on this ticket: it makes both accounts, links them, and emails the sign-in details to the family.',
    '',
    'PUPIL',
    'Name: ' || concat_ws(' ', app.first_name, app.middle_name, app.surname),
    'Application: ' || app.reference,
    case when app.date_of_birth is not null then 'Date of birth: ' || to_char(app.date_of_birth, 'FMDD Mon YYYY') end,
    case when app.gender is not null then 'Gender: ' || initcap(app.gender) end,
    case when coalesce(level_label, app.applying_for_level::text) is not null then 'Level: ' || coalesce(level_label, 'Year ' || app.applying_for_level) end,
    case when class_name is not null then 'Class: ' || class_name end,
    case when app.previous_school is not null then 'Previous school: ' || app.previous_school end,
    case when nullif(app.personal_info ->> 'email', '') is not null then 'Pupil''s own email: ' || (app.personal_info ->> 'email') end,
    case when applied_with is not null then 'Applied online with: ' || applied_with end,
    '',
    'PARENT / GUARDIAN (to link to the pupil)',
    'Name: ' || coalesce(nullif(btrim(app.guardian_name), ''), '—'),
    case when app.guardian_relation is not null then 'Relationship: ' || app.guardian_relation end,
    case when app.guardian_email is not null then 'Email: ' || app.guardian_email end,
    case when app.guardian_phone is not null then 'Phone: ' || app.guardian_phone end,
    case when coalesce(nullif(app.address, ''), nullif(app.personal_info ->> 'address', '')) is not null
         then 'Home address: ' || coalesce(nullif(app.address, ''), app.personal_info ->> 'address') end,
    case when nullif(kin ->> 'name', '') is not null then E'\nNEXT OF KIN' end,
    case when nullif(kin ->> 'name', '') is not null then 'Name: ' || (kin ->> 'name') || coalesce(' (' || nullif(kin ->> 'relationship', '') || ')', '') end,
    case when nullif(kin ->> 'phone', '') is not null then 'Phone: ' || (kin ->> 'phone') end,
    case when nullif(kin ->> 'email', '') is not null then 'Email: ' || (kin ->> 'email') end,
    case when nullif(kin ->> 'address', '') is not null then 'Address: ' || (kin ->> 'address') end,
    case when nullif(btrim(note_in), '') is not null then E'\nNote from admissions: ' || btrim(note_in) end);

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

-- Username sign-in -------------------------------------------------------------------
create or replace function classroom.sign_in_email(school_slug text, username_in text)
returns text language sql stable security definer set search_path = classroom, public as $fn$
  select p.email
    from classroom.profiles p
    join classroom.school_members m on m.user_id = p.id and m.is_active
    join classroom.schools s on s.id = m.school_id
   where s.slug = lower(btrim(school_slug))
     and lower(p.username) = lower(btrim(username_in))
   limit 1;
$fn$;
revoke all on function classroom.sign_in_email(text, text) from public;
grant execute on function classroom.sign_in_email(text, text) to anon, authenticated;

-- What the Edge Function needs to know, checked as the caller: IT (the
-- school's admins and owners) only.
create or replace function classroom.family_accounts_request(target_ticket uuid)
returns jsonb language plpgsql stable security definer set search_path = classroom, public as $fn$
declare app classroom.applications; s classroom.schools;
begin
  select a.* into app from classroom.applications a where a.it_ticket_id = target_ticket;
  if not found then return null; end if;
  if not classroom.has_role_in(app.school_id, array['owner', 'admin']::classroom.member_role[]) then
    raise exception 'Only IT (the school''s administrators) can create these accounts';
  end if;
  select * into s from classroom.schools where id = app.school_id;
  return jsonb_build_object(
    'application_id', app.id, 'reference', app.reference, 'status', app.status,
    'school_id', s.id, 'school_name', s.name, 'slug', s.slug,
    'first_name', app.first_name, 'middle_name', app.middle_name, 'surname', app.surname,
    'pupil_email', nullif(app.personal_info ->> 'email', ''),
    'guardian_name', app.guardian_name, 'guardian_email', app.guardian_email,
    'guardian_phone', app.guardian_phone, 'guardian_relation', app.guardian_relation,
    'applied_with', (select email from classroom.applicant_accounts where id = app.applicant_id),
    'student_account_id', app.student_account_id,
    'student_username', (select username from classroom.profiles where id = app.student_account_id),
    'parent_linked', exists (select 1 from classroom.guardian_students g where g.student_id = app.student_account_id and g.school_id = app.school_id));
end;
$fn$;
revoke all on function classroom.family_accounts_request(uuid) from public, anon;
grant execute on function classroom.family_accounts_request(uuid) to authenticated;

-- The database half, run by the Edge Function with the service role once the
-- two logins exist.
create or replace function classroom.finish_family_accounts(
  target_application uuid, target_ticket uuid, actor uuid,
  student_user uuid, parent_user uuid, student_username text, parent_new boolean, emailed_to text)
returns void language plpgsql security definer set search_path = classroom, public as $fn$
declare app classroom.applications; t classroom.tickets; actor_name text; requester uuid;
begin
  select * into app from classroom.applications where id = target_application;
  select * into t from classroom.tickets where id = target_ticket;
  if app.it_ticket_id is distinct from target_ticket then raise exception 'That ticket is not this applicant''s'; end if;

  update classroom.profiles set first_name = app.first_name, surname = app.surname, username = student_username,
         must_change_password = true
   where id = student_user;
  insert into classroom.school_members (school_id, user_id, role, is_active)
  values (app.school_id, student_user, 'student', true)
  on conflict (school_id, user_id) do update set is_active = true;

  if parent_new then
    update classroom.profiles
       set first_name = coalesce(nullif(split_part(btrim(app.guardian_name), ' ', 1), ''), first_name),
           surname = coalesce(nullif(btrim(substr(btrim(app.guardian_name), length(split_part(btrim(app.guardian_name), ' ', 1)) + 1)), ''), surname),
           must_change_password = true
     where id = parent_user;
  end if;
  -- A parent here, unless they already hold a role at this school.
  insert into classroom.school_members (school_id, user_id, role, is_active)
  values (app.school_id, parent_user, 'parent', true)
  on conflict (school_id, user_id) do nothing;
  insert into classroom.guardian_students (school_id, guardian_id, student_id, relationship, is_primary)
  values (app.school_id, parent_user, student_user, app.guardian_relation, true)
  on conflict (guardian_id, student_id) do nothing;

  update classroom.applications set student_account_id = student_user where id = app.id;

  actor_name := classroom.person_label(actor);
  insert into classroom.ticket_messages (ticket_id, author_id, kind, body)
  values (t.id, actor, 'reply',
    format(E'Accounts created by %s.\n\nPupil: %s %s, username %s\nParent: %s (%s)%s\nParent linked to pupil.\n\n%s',
      actor_name, app.first_name, app.surname, student_username,
      coalesce(nullif(app.guardian_name, ''), 'parent'), app.guardian_email,
      case when parent_new then ', new account' else ', existing account' end,
      case when emailed_to is not null then 'Sign-in details and the portal address were emailed to ' || emailed_to || '.'
           else 'The sign-in details were given to IT to pass on (no school mailbox to email them from).' end));
  update classroom.tickets set status = 'resolved', resolved_at = now(), updated_at = now(),
         assigned_to = coalesce(assigned_to, actor)
   where id = t.id;

  -- Admissions can now register the pupil.
  requester := coalesce(t.requester_id, app.correction_requested_by);
  insert into classroom.notifications (user_id, school_id, kind, title, body, link)
  select distinct u, app.school_id, 'admission_account_ready',
         format('%s %s''s school account is ready', app.first_name, app.surname),
         'Register the pupil: their account is chosen for you.', format('/Admissions/%s', app.id)
    from (select requester as u
          union select m.user_id from classroom.school_members m
           where m.school_id = app.school_id and m.is_active and m.role = 'admissions' and m.granted_via is null) x
   where u is not null and u is distinct from actor;
end;
$fn$;
revoke all on function classroom.finish_family_accounts(uuid, uuid, uuid, uuid, uuid, text, boolean, text) from public, anon, authenticated;
grant execute on function classroom.finish_family_accounts(uuid, uuid, uuid, uuid, uuid, text, boolean, text) to service_role;

notify pgrst, 'reload schema';
