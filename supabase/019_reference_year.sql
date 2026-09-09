-- =============================================================================
-- Cosmetic: an application reference read JNC/20262027/0001
--
-- The year part strips every non-digit out of the session name, so "2026/2027"
-- became "20262027". Take the first four digits — the year the session starts —
-- so the reference reads JNC/2026/0001 and fits on a form.
-- =============================================================================

create or replace function classroom.reference_year(session_name text)
returns text
language sql
immutable
as $$
  select coalesce(
    nullif(left(regexp_replace(coalesce(session_name, ''), '\D', '', 'g'), 4), ''),
    to_char(now(), 'YYYY')
  );
$$;

grant execute on function classroom.reference_year(text) to anon, authenticated;

create or replace function classroom.submit_application(
  target_slug        text,
  first_name         text,
  surname            text,
  guardian_name      text,
  guardian_email     text,
  middle_name        text default null,
  date_of_birth      date default null,
  gender             text default null,
  applying_for_level int  default null,
  previous_school    text default null,
  guardian_phone     text default null,
  guardian_relation  text default null,
  address            text default null,
  notes              text default null,
  document_links     text default null
)
returns table (reference text, school_name text)
language plpgsql
security definer
set search_path = classroom, public
as $$
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
    and m.role in ('owner', 'admin', 'admissions');

  return query select ref, school.name;
end;
$$;

grant execute on function classroom.submit_application(
  text, text, text, text, text, text, date, text, int, text, text, text, text, text, text
) to anon, authenticated;

notify pgrst, 'reload schema';
