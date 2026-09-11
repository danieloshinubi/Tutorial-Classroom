-- =============================================================================
-- Public Apply form — attach real files, not just pasted links
--
-- The anonymous form has no application_id and no auth.uid() until
-- submit_application() returns, so a file can't be linked to
-- application_documents the normal way (that table's only insert path is
-- the staff-only "admissions staff manage documents" policy from 016).
--
-- The shape that works: upload straight to storage BEFORE the application
-- exists, under the same admissions/<school_id>/... prefix the staff-read
-- policy (033_payment_proof_storage.sql) already understands — it only ever
-- inspects segment [2] (the school id) to decide who may read, never
-- segment [3], so a random per-upload token there instead of an
-- application_id changes nothing for staff reading it back later. Once
-- submit_application() creates the row, it registers each already-uploaded
-- file into application_documents itself, in the same transaction.
--
-- Anonymous write access to storage is new and deliberately narrow:
--   - only under admissions/<a real, active school's id>/...
--   - only PDF/JPEG/PNG/WEBP/HEIC, capped at 15MB (checked from the object's
--     own metadata, which the storage service — not the caller — sets)
--   - delete is allowed only for a file nobody has linked to an application
--     yet, so a family can remove a wrong attachment before submitting, but
--     an already-submitted document is exactly as staff-managed as one
--     uploaded by the school itself.
--
-- What this does NOT defend against: a stranger uploading junk to fill a
-- school's storage quota, since knowing a school's id (already exposed by
-- effective_admission_config and friends, all anon-readable) is all this
-- requires. No rate limiting exists at the RLS layer. Worth revisiting if
-- abuse shows up; not attempting it here.
-- =============================================================================

drop policy if exists "anyone applying attaches a document" on storage.objects;
create policy "anyone applying attaches a document"
  on storage.objects for insert to anon, authenticated
  with check (
    bucket_id = 'course-materials'
    and (storage.foldername(name))[1] = 'admissions'
    and exists (
      select 1 from classroom.schools s
      where s.id = classroom.try_uuid((storage.foldername(name))[2])
        and s.is_active
    )
    and coalesce((metadata->>'size')::bigint, 0) <= 15728640
    and coalesce(metadata->>'mimetype', '') = any (array[
      'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'
    ])
  );

drop policy if exists "an applicant withdraws their own unsent attachment" on storage.objects;
create policy "an applicant withdraws their own unsent attachment"
  on storage.objects for delete to anon, authenticated
  using (
    bucket_id = 'course-materials'
    and (storage.foldername(name))[1] = 'admissions'
    and not exists (
      select 1 from classroom.application_documents d where d.file_path = name
    )
  );


/* =============================================================================
   public_school() — needs to hand back the school's id, not just its name/
   slug/logo. Not a new exposure: admission_config, admission_programmes and
   document_requirements are already anon-selectable by school_id, and every
   one of those ids is already visible to an anonymous applicant through the
   accounted flow's own screens. This is the same fact via a second door.
   ============================================================================= */

drop function if exists classroom.public_school(text);

create or replace function classroom.public_school(target_slug text)
returns table (id uuid, name text, slug text, logo_url text)
language sql
stable
security definer
set search_path = classroom, public
as $fn$
  select s.id, s.name, s.slug, s.logo_url
  from classroom.schools s
  where s.slug = lower(btrim(target_slug))
    and s.is_active;
$fn$;

grant execute on function classroom.public_school(text) to anon, authenticated;


/* =============================================================================
   submit_application() — extended with document_uploads
   ---------------------------------------------------------------------------
   Adds one trailing jsonb parameter, which changes the function's arity —
   same reason as decide_application in 050, the old 15-argument version is
   dropped explicitly so there is only ever one submit_application in the
   schema.

   document_uploads is an array of {path, name, size, mime_type, kind},
   exactly what the client already has in hand right after each successful
   storage upload. Only entries whose path actually sits under this school's
   own admissions/<school_id>/ prefix are registered — anything else is
   silently skipped rather than failing the whole submission over one bad
   entry, the same judgement call reject_document etc. make elsewhere for
   one-bad-field-shouldn't-sink-the-transaction.
   ============================================================================= */

drop function if exists classroom.submit_application(text, text, text, text, text, text, date, text, integer, text, text, text, text, text, text);

CREATE OR REPLACE FUNCTION classroom.submit_application(target_slug text, first_name text, surname text, guardian_name text, guardian_email text, middle_name text DEFAULT NULL::text, date_of_birth date DEFAULT NULL::date, gender text DEFAULT NULL::text, applying_for_level integer DEFAULT NULL::integer, previous_school text DEFAULT NULL::text, guardian_phone text DEFAULT NULL::text, guardian_relation text DEFAULT NULL::text, address text DEFAULT NULL::text, notes text DEFAULT NULL::text, document_links text DEFAULT NULL::text, document_uploads jsonb DEFAULT NULL::jsonb)
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
  doc_count int;
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

  -- Register whatever the family already uploaded to storage before this
  -- call, now that there's an application to attach it to.
  doc_count := 0;
  if document_uploads is not null then
    insert into classroom.application_documents
      (application_id, kind, file_path, file_name, file_size, mime_type)
    select
      new_id,
      case when d->>'kind' in ('birth_certificate','previous_results','passport','transfer_certificate')
           then d->>'kind' else 'other' end,
      d->>'path',
      nullif(d->>'name', ''),
      nullif(d->>'size', '')::bigint,
      nullif(d->>'mime_type', '')
    from jsonb_array_elements(document_uploads) as d
    where d->>'path' like 'admissions/' || school.id::text || '/%';
    get diagnostics doc_count = row_count;
  end if;

  insert into classroom.application_events (application_id, status_to, actor_label, note)
  values (
    new_id, 'submitted', btrim(guardian_name),
    'Application submitted online' ||
      case when doc_count > 0
        then format(', %s document%s attached', doc_count, case when doc_count = 1 then '' else 's' end)
        else '' end
  );

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

grant execute on function classroom.submit_application(text, text, text, text, text, text, date, text, integer, text, text, text, text, text, text, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
