-- =============================================================================
-- Tickets, phase 2 continued — the service-role-only RPCs the new Edge
-- Functions call.
--
-- service_role has no table-level GRANT on classroom.tickets/ticket_messages
-- /ticket_mailboxes (only `authenticated` does — see 077/080). BYPASSRLS
-- lets service_role skip row level security, but it does not invent a table
-- grant that was never given, so a raw .from(...).insert(...) from a
-- service-role client would fail. Same boundary admin-reset-password draws
-- around record_password_reset(): everything privileged happens through a
-- SECURITY DEFINER function granted to service_role alone, never a direct
-- table write.
--
-- None of these check auth.uid() — there is no caller identity by the time
-- an Edge Function reaches its service-role client; the Edge Function's own
-- earlier check (via a caller-scoped anon+JWT client) is what gates access,
-- exactly like admin-reset-password and pay-init already do.
--
-- Run after 080. Safe to re-run.
-- =============================================================================

/* ---------------------------------------------------------------------------
   Creating a mailbox row. mailbox-connect calls this only after checking
   the caller is owner/admin via its own caller-scoped client — this
   function does no authorization of its own.
   --------------------------------------------------------------------------- */
create or replace function classroom.create_ticket_mailbox(
  target_school     uuid,
  label_in          text,
  address_in        text,
  display_name_in   text,
  provider_in       text,
  imap_host_in      text,
  imap_port_in      int,
  imap_security_in  text,
  smtp_host_in      text,
  smtp_port_in      int,
  smtp_security_in  text,
  username_in       text
) returns classroom.ticket_mailboxes
language plpgsql
security definer
set search_path = classroom, public
as $fn$
declare
  mb classroom.ticket_mailboxes;
begin
  insert into classroom.ticket_mailboxes
    (school_id, label, address, display_name, provider,
     imap_host, imap_port, imap_security, smtp_host, smtp_port, smtp_security, username)
  values
    (target_school, coalesce(nullif(btrim(label_in), ''), 'Support'), btrim(address_in),
     nullif(btrim(display_name_in), ''), provider_in,
     imap_host_in, imap_port_in, imap_security_in, smtp_host_in, smtp_port_in, smtp_security_in,
     nullif(btrim(username_in), ''))
  returning * into mb;
  return mb;
end;
$fn$;

revoke all on function classroom.create_ticket_mailbox(uuid, text, text, text, text, text, int, text, text, int, text, text) from public;
grant execute on function classroom.create_ticket_mailbox(uuid, text, text, text, text, text, int, text, text, int, text, text) to service_role;

/* ---------------------------------------------------------------------------
   Ingesting one inbound email. Thread-matches by In-Reply-To/References
   against a stored outbound Message-ID first, falls back to a "#123" token
   in the subject, and only starts a brand-new ticket if neither matches.
   Links the sender to a real account when their address matches an active
   member of the school; otherwise keeps the raw name/email so the thread
   still reads sensibly with no account behind it.
   --------------------------------------------------------------------------- */
create or replace function classroom.ingest_inbound_ticket_email(
  target_mailbox  uuid,
  message_id_in   text,
  in_reply_to_in  text,
  references_in   text[],
  from_email_in   text,
  from_name_in    text,
  subject_in      text,
  body_in         text
) returns uuid
language plpgsql
security definer
set search_path = classroom, public
as $fn$
declare
  mb                 classroom.ticket_mailboxes;
  existing_ticket_id uuid;
  matched_number     int;
  resolved_requester uuid;
  new_ticket         classroom.tickets;
begin
  select * into mb from classroom.ticket_mailboxes where id = target_mailbox and is_active;
  if not found then
    raise exception 'Unknown or inactive mailbox';
  end if;

  if in_reply_to_in is not null then
    select tm.ticket_id into existing_ticket_id
    from classroom.ticket_messages tm
    join classroom.tickets t on t.id = tm.ticket_id
    where t.school_id = mb.school_id and tm.email_message_id = in_reply_to_in
    limit 1;
  end if;

  if existing_ticket_id is null and references_in is not null then
    select tm.ticket_id into existing_ticket_id
    from classroom.ticket_messages tm
    join classroom.tickets t on t.id = tm.ticket_id
    where t.school_id = mb.school_id and tm.email_message_id = any(references_in)
    limit 1;
  end if;

  if existing_ticket_id is null then
    matched_number := nullif((regexp_match(coalesce(subject_in, ''), '#(\d+)'))[1], '')::int;
    if matched_number is not null then
      select id into existing_ticket_id from classroom.tickets
      where school_id = mb.school_id and number = matched_number;
    end if;
  end if;

  select p.id into resolved_requester
  from classroom.profiles p
  join classroom.school_members sm on sm.user_id = p.id and sm.school_id = mb.school_id and sm.is_active
  where lower(p.email) = lower(from_email_in)
  limit 1;

  if existing_ticket_id is not null then
    insert into classroom.ticket_messages
      (ticket_id, author_id, kind, body, direction, email_message_id, in_reply_to, external_from)
    values
      (existing_ticket_id, resolved_requester, 'reply', coalesce(body_in, ''), 'inbound',
       message_id_in, in_reply_to_in,
       case when resolved_requester is null
            then coalesce(nullif(btrim(from_name_in), ''), from_email_in) || ' <' || from_email_in || '>'
            else null end);

    update classroom.tickets
      set status = case when status in ('resolved', 'closed') then 'open' else status end,
          updated_at = now()
      where id = existing_ticket_id;

    return existing_ticket_id;
  end if;

  insert into classroom.tickets
    (school_id, number, subject, description, priority,
     requester_id, requester_email, requester_name, channel, mailbox_id)
  values
    (mb.school_id, classroom.next_ticket_number(mb.school_id),
     coalesce(nullif(btrim(subject_in), ''), '(no subject)'), coalesce(body_in, ''), 'low',
     resolved_requester,
     case when resolved_requester is null then from_email_in else null end,
     case when resolved_requester is null then nullif(btrim(from_name_in), '') else null end,
     'email', target_mailbox)
  returning * into new_ticket;

  return new_ticket.id;
end;
$fn$;

revoke all on function classroom.ingest_inbound_ticket_email(uuid, text, text, text[], text, text, text, text) from public;
grant execute on function classroom.ingest_inbound_ticket_email(uuid, text, text, text[], text, text, text, text) to service_role;

/* ---------------------------------------------------------------------------
   Recording an outbound reply — called after the actual send attempt
   (success or failure), so a failed send still leaves a record rather than
   silently vanishing.
   --------------------------------------------------------------------------- */
create or replace function classroom.record_outbound_ticket_message(
  target_ticket       uuid,
  body_in             text,
  to_addresses_in     text[],
  cc_addresses_in     text[],
  bcc_addresses_in    text[],
  email_message_id_in text,
  send_status_in      text,
  send_error_in       text,
  actor               uuid
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
    (ticket_id, author_id, kind, body, direction, to_addresses, cc_addresses, bcc_addresses,
     email_message_id, send_status, send_error)
  values
    (target_ticket, actor, 'reply', coalesce(body_in, ''), 'outbound',
     to_addresses_in, cc_addresses_in, bcc_addresses_in,
     email_message_id_in, send_status_in, send_error_in)
  returning * into msg;

  if send_status_in = 'sent' and t.first_response_at is null and t.requester_id is distinct from actor then
    update classroom.tickets set first_response_at = now(), updated_at = now() where id = target_ticket;
  end if;

  return msg;
end;
$fn$;

revoke all on function classroom.record_outbound_ticket_message(uuid, text, text[], text[], text[], text, text, text, uuid) from public;
grant execute on function classroom.record_outbound_ticket_message(uuid, text, text[], text[], text[], text, text, text, uuid) to service_role;

notify pgrst, 'reload schema';
