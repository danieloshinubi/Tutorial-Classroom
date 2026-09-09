-- =============================================================================
-- The last places the admissions roles were written out by hand
--
-- 027 introduced classroom.can_do_admissions() and moved the policies and
-- decide_application() onto it. These were still carrying their own copy of
-- the array, so a principal could decide an application but not enrol the
-- applicant afterwards, and would not appear on the summary or be told when
-- one arrived. Authority that stops halfway is worse than none.
--
-- is_school_staff() gains principal for the same reason: a principal is
-- plainly staff, and the omission existed only because the role postdated
-- the function.
--
-- The bodies below are the deployed definitions with the role check swapped
-- and nothing else touched.
-- =============================================================================

CREATE OR REPLACE FUNCTION classroom.enrol_applicant(target_application uuid, target_student uuid, target_class uuid DEFAULT NULL::uuid)
 RETURNS classroom.applications
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'classroom', 'public'
AS $function$
declare
  app classroom.applications;
  cls classroom.classes;
  who text;
begin
  select * into app from classroom.applications where id = target_application;
  if app is null then
    raise exception 'No such application';
  end if;

  if not classroom.can_do_admissions(app.school_id) then
    raise exception 'Only admissions staff can enrol an applicant';
  end if;

  if app.status <> 'accepted' then
    raise exception 'Only an accepted application can be enrolled — this one is %', app.status;
  end if;

  if not exists (select 1 from classroom.profiles where id = target_student) then
    raise exception 'That student account does not exist';
  end if;

  if target_class is not null then
    select * into cls from classroom.classes where id = target_class;
    if cls is null or cls.school_id <> app.school_id then
      raise exception 'That class belongs to a different school';
    end if;
  end if;

  -- Make sure they are a member of the school, as a student.
  insert into classroom.school_members (school_id, user_id, role)
  values (app.school_id, target_student, 'student')
  on conflict (school_id, user_id) do nothing;

  if target_class is not null then
    insert into classroom.class_students (class_id, student_id)
    values (target_class, target_student)
    on conflict (class_id, student_id) do nothing;
  end if;

  select coalesce(nullif(btrim(first_name || ' ' || surname), ''), email)
  into who from classroom.profiles where id = auth.uid();

  update classroom.applications
  set status = 'enrolled',
      student_id = target_student,
      class_id = target_class,
      decided_by = auth.uid(),
      decided_at = now(),
      updated_at = now()
  where id = target_application
  returning * into app;

  insert into classroom.application_events
    (application_id, status_from, status_to, actor_id, actor_label, note)
  values (
    target_application, 'accepted', 'enrolled', auth.uid(), who,
    case when cls.name is null then 'Enrolled' else format('Enrolled into %s', cls.name) end
  );

  return app;
end;
$function$
;

CREATE OR REPLACE FUNCTION classroom.admissions_summary(target_school uuid)
 RETURNS TABLE(status classroom.application_status, count integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'classroom', 'public'
AS $function$
  select a.status, count(*)::int
  from classroom.applications a
  where a.school_id = target_school
    and classroom.can_do_admissions(target_school)
  group by a.status;
$function$
;

CREATE OR REPLACE FUNCTION classroom.is_school_staff(target_school uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'classroom', 'public'
AS $function$
  select classroom.has_role_in(
    target_school,
    array['owner','admin','principal','teacher','bursar','admissions']::classroom.member_role[]
  );
$function$
;

CREATE OR REPLACE FUNCTION classroom.submit_application(target_slug text, first_name text, surname text, guardian_name text, guardian_email text, middle_name text DEFAULT NULL::text, date_of_birth date DEFAULT NULL::date, gender text DEFAULT NULL::text, applying_for_level integer DEFAULT NULL::integer, previous_school text DEFAULT NULL::text, guardian_phone text DEFAULT NULL::text, guardian_relation text DEFAULT NULL::text, address text DEFAULT NULL::text, notes text DEFAULT NULL::text, document_links text DEFAULT NULL::text)
 RETURNS TABLE(reference text, school_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'classroom', 'public'
AS $function$
declare
  school   classroom.schools;
  sess     classroom.sessions;
  next_seq int;
  ref      text;
  new_id   uuid;
  prefix   text;
begin
  select * into school from classroom.schools
  where slug = lower(btrim(target_slug)) and is_active;

  if not found then
    raise exception 'No school at %', target_slug;
  end if;

  if btrim(coalesce(first_name, '')) = ''
     or btrim(coalesce(surname, '')) = ''
     or btrim(coalesce(guardian_name, '')) = ''
     or btrim(coalesce(guardian_email, '')) = '' then
    raise exception 'The applicant name, guardian name and guardian email are all required';
  end if;

  -- Applications belong to whichever session is taking them; failing that,
  -- the current one.
  select * into sess from classroom.sessions
  where school_id = school.id and applications_open
  order by starts_on desc nulls last
  limit 1;

  if not found then
    select * into sess from classroom.sessions
    where school_id = school.id and is_current
    limit 1;
  end if;

  if not found then
    raise exception '% is not accepting applications at the moment', school.name;
  end if;

  -- Serialise numbering for this school and session. Held until the
  -- transaction ends, so two submissions cannot take the same number.
  perform pg_advisory_xact_lock(hashtext(school.id::text || ':' || sess.id::text));

  select coalesce(max(a.seq), 0) + 1 into next_seq
  from classroom.applications a
  where a.school_id = school.id and a.session_id = sess.id;

  -- Initials of the school, so a reference is recognisable on a phone call.
  select string_agg(left(word, 1), '')
  into prefix
  from (
    select regexp_split_to_table(upper(school.name), '[^A-Z0-9]+') as word
  ) parts
  where word <> '';

  ref := format('%s/%s/%s',
                coalesce(nullif(left(prefix, 4), ''), 'APP'),
                classroom.reference_year(sess.name),
                lpad(next_seq::text, 4, '0'));

  insert into classroom.applications (
    school_id, session_id, reference, seq,
    first_name, surname, middle_name, date_of_birth, gender,
    applying_for_level, previous_school,
    guardian_name, guardian_email, guardian_phone, guardian_relation,
    address, notes, document_links
  ) values (
    school.id, sess.id, ref, next_seq,
    btrim(first_name), btrim(surname), nullif(btrim(coalesce(middle_name,'')), ''),
    date_of_birth, nullif(btrim(coalesce(gender,'')), ''),
    applying_for_level, nullif(btrim(coalesce(previous_school,'')), ''),
    btrim(guardian_name), lower(btrim(guardian_email)),
    nullif(btrim(coalesce(guardian_phone,'')), ''),
    nullif(btrim(coalesce(guardian_relation,'')), ''),
    nullif(btrim(coalesce(address,'')), ''),
    nullif(btrim(coalesce(notes,'')), ''),
    nullif(btrim(coalesce(document_links,'')), '')
  )
  returning id into new_id;

  insert into classroom.application_events (application_id, status_to, actor_label, note)
  values (new_id, 'submitted', btrim(guardian_name), 'Application submitted online');

  insert into classroom.notifications (user_id, school_id, kind, title, body, link)
  select m.user_id, school.id, 'application_submitted',
         format('New application: %s %s', btrim(first_name), btrim(surname)),
         format('Reference %s', ref),
         format('/Admissions/%s', new_id)
  from classroom.school_members m
  where m.school_id = school.id
    and m.is_active
    and m.role in ('owner', 'admin', 'principal', 'admissions');

  return query select ref, school.name;
end;
$function$
;

notify pgrst, 'reload schema';
