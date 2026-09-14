-- track_application() only ever returned the applicant's name pre-joined
-- ("First Last") for display — fine for a read-only status page, useless
-- for /Apply/Claim's signup form, which needs first_name and surname apart
-- to pre-fill its own fields (the applicant already typed this once,
-- submitting the public form; no reason to ask again). Splitting the
-- joined string back apart in JS would break on anyone with a multi-word
-- first name or surname, so the columns are added separately instead;
-- `applicant` stays for the status page's own existing display.
drop function if exists classroom.track_application(text, text);

create or replace function classroom.track_application(target_reference text, target_email text)
returns table (
  reference text, status classroom.application_status, applicant text,
  school_name text, session_name text, submitted_at timestamptz,
  decided_at timestamptz, offer_expires_at timestamptz,
  form_state text, correction_reason text, correction_sections text[],
  first_name text, surname text
)
language sql stable security definer set search_path = classroom, public
as $fn$
  select a.reference, a.status, btrim(a.first_name || ' ' || a.surname), s.name, sess.name,
         a.created_at, a.decided_at, a.offer_expires_at,
         a.form_state, a.correction_reason, a.correction_sections,
         a.first_name, a.surname
  from classroom.applications a
  join classroom.schools s on s.id = a.school_id
  left join classroom.sessions sess on sess.id = a.session_id
  where upper(btrim(a.reference)) = upper(btrim(target_reference))
    and lower(a.guardian_email) = lower(btrim(target_email));
$fn$;

grant execute on function classroom.track_application(text, text) to anon, authenticated;
