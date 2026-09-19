-- =============================================================================
-- Bug found live: News' "email this notice" failed with "That school could
-- not be found" for every notice, and the same bug was silently present in
-- admissions-notify and auth-email-send too. Cause: classroom.schools has a
-- table grant for `authenticated` (and `postgres`) but never for
-- `service_role` — the exact same gap ticket_mailboxes had before
-- get_ticket_mailbox()/get_mailbox_secret() were added as SECURITY DEFINER
-- wrappers. All three edge functions read the school with a service-role
-- client via `.from("schools")`, which PostgREST silently returns zero rows
-- for — never an error, just nothing, which each function correctly (but
-- unhelpfully) reported as "could not be found".
--
-- One RPC for all three: the full set of columns any of admissions-notify,
-- auth-email-send or notice-mail-send needs to render a branded email.
-- =============================================================================

create or replace function classroom.get_school_for_mail(target_school uuid)
returns table (
  id                             uuid,
  name                           text,
  slug                           text,
  logo_url                       text,
  theme_color                    text,
  signatory_name                 text,
  signatory_title                text,
  admission_letter_offer_intro   text,
  admission_letter_enrolled_intro text,
  admission_letter_closing       text
)
language sql
security definer
set search_path = classroom, public
as $$
  select
    id, name, slug, logo_url, theme_color, signatory_name, signatory_title,
    admission_letter_offer_intro, admission_letter_enrolled_intro, admission_letter_closing
  from classroom.schools
  where id = target_school;
$$;

revoke all on function classroom.get_school_for_mail(uuid) from public;
grant execute on function classroom.get_school_for_mail(uuid) to service_role;

notify pgrst, 'reload schema';
