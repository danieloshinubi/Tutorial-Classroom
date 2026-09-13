-- =============================================================================
-- Tickets, phase 2 continued — ticket_mailboxes has no GRANT to service_role
-- either (only `authenticated`, and only select/update(is_active) — see
-- 080), so ticket-mail-poll's service-role client cannot record how a poll
-- went with a raw table update any more than it could insert one. Same
-- reasoning as create_ticket_mailbox/get_mailbox_secret: a SECURITY DEFINER
-- function granted to service_role alone.
--
-- Run after 082. Safe to re-run.
-- =============================================================================

create or replace function classroom.record_mailbox_poll_result(
  target_mailbox uuid,
  status_in      text,
  error_in       text
) returns void
language sql
security definer
set search_path = classroom, public
as $$
  update classroom.ticket_mailboxes
  set last_poll_at = now(), last_poll_status = status_in, last_poll_error = error_in, updated_at = now()
  where id = target_mailbox;
$$;

revoke all on function classroom.record_mailbox_poll_result(uuid, text, text) from public;
grant execute on function classroom.record_mailbox_poll_result(uuid, text, text) to service_role;

-- Same gap, same reason: service_role has no select grant on
-- ticket_mailboxes either, so ticket-mail-poll cannot list what to poll
-- with a raw .from("ticket_mailboxes").select(...).
create or replace function classroom.list_active_ticket_mailboxes(provider_filter text)
returns setof classroom.ticket_mailboxes
language sql
security definer
set search_path = classroom, public
as $$
  select * from classroom.ticket_mailboxes
  where is_active and provider = provider_filter;
$$;

revoke all on function classroom.list_active_ticket_mailboxes(text) from public;
grant execute on function classroom.list_active_ticket_mailboxes(text) to service_role;

-- ticket-mail-send needs the same two reads once it has already verified
-- the caller is ticket-staff — same gap again: service_role has no select
-- grant on ticket_mailboxes, and ticket_messages was only ever granted to
-- authenticated (077).
create or replace function classroom.get_ticket_mailbox(target_mailbox uuid)
returns classroom.ticket_mailboxes
language sql
security definer
set search_path = classroom, public
as $$
  select * from classroom.ticket_mailboxes where id = target_mailbox;
$$;

revoke all on function classroom.get_ticket_mailbox(uuid) from public;
grant execute on function classroom.get_ticket_mailbox(uuid) to service_role;

create or replace function classroom.last_ticket_email_message_id(target_ticket uuid)
returns text
language sql
security definer
set search_path = classroom, public
as $$
  select email_message_id from classroom.ticket_messages
  where ticket_id = target_ticket and email_message_id is not null
  order by created_at desc
  limit 1;
$$;

revoke all on function classroom.last_ticket_email_message_id(uuid) from public;
grant execute on function classroom.last_ticket_email_message_id(uuid) to service_role;

notify pgrst, 'reload schema';
