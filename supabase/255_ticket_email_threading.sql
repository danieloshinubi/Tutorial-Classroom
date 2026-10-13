-- Ticket replies stay in the customer's email conversation (2026-10-08).
--
-- A reply from the help desk arrived as a separate conversation: its subject
-- was "Re: [#8] Service Update Notification" (Gmail, Outlook and Titan only
-- group mail whose subject matches, apart from Re:), and the first reply on a
-- ticket that came in by email pointed at no earlier message, because the
-- original email's Message-ID is kept on the ticket (origin_message_id) and
-- only later messages were looked at.
--
-- Now ticket-mail-send replies with "Re: <original subject>" and links the
-- whole conversation (In-Reply-To the latest, References all of them, the
-- original first), from ticket_thread_message_ids below. Inbound replies are
-- matched by those links, including the original email; and, for mail apps
-- that drop them, by the same sender writing about the same subject on a
-- recent ticket of the same mailbox (which the "[#8]" in the subject used to
-- do; a subject that still carries #N keeps matching too).

create or replace function classroom.ticket_thread_message_ids(target_ticket uuid)
returns text[] language sql stable security definer set search_path = classroom, public as $fn$
  select coalesce(array_agg(mid order by at, n), '{}') from (
    select t.origin_message_id as mid, t.created_at as at, 0 as n from classroom.tickets t
     where t.id = target_ticket and t.origin_message_id is not null
    union all
    select tm.email_message_id, tm.created_at, 1 from classroom.ticket_messages tm
     where tm.ticket_id = target_ticket and tm.email_message_id is not null
  ) x;
$fn$;
revoke all on function classroom.ticket_thread_message_ids(uuid) from public, anon, authenticated;
grant execute on function classroom.ticket_thread_message_ids(uuid) to service_role;

-- The subject without Re:/Fwd:/[#N], for matching a reply to its ticket.
create or replace function classroom.ticket_bare_subject(s text)
returns text language sql immutable as $fn$
  select lower(btrim(regexp_replace(regexp_replace(coalesce(s, ''), '^\s*((re|fw|fwd|aw|sv)\s*:\s*)+', '', 'i'), '\[#\d+\]\s*', '', 'g')));
$fn$;

do $do$
declare d text;
begin
  d := pg_get_functiondef('classroom.ingest_inbound_ticket_email(uuid,text,text,text[],text,text,text,text,text)'::regprocedure);
  -- A reply to the original email (its Message-ID is on the ticket).
  d := replace(d, $a$  if existing_ticket_id is null and references_in is not null then$a$,
               $b$  if existing_ticket_id is null and (in_reply_to_in is not null or references_in is not null) then
    select t.id into existing_ticket_id from classroom.tickets t
     where t.school_id = mb.school_id and t.origin_message_id is not null
       and (t.origin_message_id = in_reply_to_in or t.origin_message_id = any(coalesce(references_in, '{}')))
     limit 1;
  end if;

  if existing_ticket_id is null and references_in is not null then$b$);
  -- A mail app that dropped the links: same sender, same subject, recent.
  d := replace(d, $a$  select p.id into resolved_requester$a$,
               $b$  if existing_ticket_id is null and classroom.ticket_bare_subject(subject_in) <> '' then
    select t.id into existing_ticket_id from classroom.tickets t
     where t.school_id = mb.school_id and t.mailbox_id = target_mailbox
       and classroom.ticket_bare_subject(t.subject) = classroom.ticket_bare_subject(subject_in)
       and t.updated_at > now() - interval '90 days'
       and (lower(t.requester_email) = lower(from_email_in)
            or exists (select 1 from classroom.profiles p where p.id = t.requester_id and lower(p.email) = lower(from_email_in))
            or exists (select 1 from classroom.ticket_messages tm where tm.ticket_id = t.id and tm.direction = 'outbound'
                        and lower(from_email_in) = any (select lower(x) from unnest(tm.to_addresses || tm.cc_addresses) x)))
     order by t.updated_at desc
     limit 1;
  end if;

  select p.id into resolved_requester$b$);
  if position('t.origin_message_id = in_reply_to_in' in d) = 0 or position('ticket_bare_subject(subject_in)' in d) = 0 then
    raise exception 'ingest_inbound_ticket_email patch did not apply';
  end if;
  execute d;
end;
$do$;

notify pgrst, 'reload schema';
