-- =============================================================================
-- Tickets, phase 2 continued — rich-text email replies. A staff reply on an
-- email-channel ticket is now composed with formatting (bold, lists, links)
-- rather than a bare textarea, matching what an actual email client offers.
-- Internal notes and web-channel tickets are untouched — they're staff
-- shorthand, not something a family ever reads.
--
-- Run after 084. Safe to re-run.
-- =============================================================================

alter table classroom.ticket_messages add column if not exists body_format text not null default 'plain' check (body_format in ('plain', 'html'));

drop function if exists classroom.record_outbound_ticket_message(uuid, text, text[], text[], text[], text, text, text, uuid);

create or replace function classroom.record_outbound_ticket_message(
  target_ticket       uuid,
  body_in             text,
  to_addresses_in     text[],
  cc_addresses_in     text[],
  bcc_addresses_in    text[],
  email_message_id_in text,
  send_status_in      text,
  send_error_in       text,
  actor               uuid,
  body_format_in      text default 'plain'
) returns classroom.ticket_messages
language plpgsql
security definer
set search_path = classroom, public
as $fn$
declare
  msg classroom.ticket_messages;
  t   classroom.tickets;
begin
  select * into t from classroom.tickets where id = target_ticket;
  if not found then
    raise exception 'Unknown ticket';
  end if;

  insert into classroom.ticket_messages
    (ticket_id, author_id, kind, body, body_format, direction, to_addresses, cc_addresses, bcc_addresses,
     email_message_id, send_status, send_error)
  values
    (target_ticket, actor, 'reply', coalesce(body_in, ''), coalesce(body_format_in, 'plain'), 'outbound',
     to_addresses_in, cc_addresses_in, bcc_addresses_in,
     email_message_id_in, send_status_in, send_error_in)
  returning * into msg;

  if send_status_in = 'sent' and t.first_response_at is null and t.requester_id is distinct from actor then
    update classroom.tickets set first_response_at = now(), updated_at = now() where id = target_ticket;
  end if;

  return msg;
end;
$fn$;

revoke all on function classroom.record_outbound_ticket_message(uuid, text, text[], text[], text[], text, text, text, uuid, text) from public;
grant execute on function classroom.record_outbound_ticket_message(uuid, text, text[], text[], text[], text, text, text, uuid, text) to service_role;

notify pgrst, 'reload schema';
