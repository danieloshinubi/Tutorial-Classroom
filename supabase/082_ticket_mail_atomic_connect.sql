-- =============================================================================
-- Tickets, phase 2 continued — two fixes found before ever calling these
-- from the Edge Functions:
--
-- 1) create_ticket_mailbox() and set_mailbox_secret() were two separate
--    service-role calls. If the secret write failed after the row was
--    already inserted, the planned "rollback" was to call
--    delete_ticket_mailbox() — but that function checks has_role_in(),
--    which needs a real auth.uid(); a service-role call has no caller
--    identity, so the rollback would itself raise "You cannot remove this
--    mailbox" and leave a half-connected mailbox behind. Folding the vault
--    write into the same function as the insert makes them one transaction
--    instead: if the secret write raises, the whole function aborts and
--    the row never existed in the first place.
--
-- 2) ingest_inbound_ticket_email() had no idempotency guard. A poll cycle
--    that overlaps the previous one (or an IMAP UID reset) could ingest the
--    same email twice. Message-ID is the natural dedup key — Paystack
--    settlement already leans on the same idea with its gateway reference.
--
-- Run after 081. Safe to re-run.
-- =============================================================================

alter table classroom.tickets add column if not exists origin_message_id text;

drop function if exists classroom.create_ticket_mailbox(uuid, text, text, text, text, text, int, text, text, int, text, text);

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
  username_in       text,
  password_in       text
) returns classroom.ticket_mailboxes
language plpgsql
security definer
set search_path = classroom, public, vault
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

  -- Same transaction as the insert above — a failure here rolls the row
  -- back too, rather than leaving a mailbox with no usable secret.
  perform classroom.set_mailbox_secret(mb.id, 'password', password_in);

  select * into mb from classroom.ticket_mailboxes where id = mb.id;
  return mb;
end;
$fn$;

revoke all on function classroom.create_ticket_mailbox(uuid, text, text, text, text, text, int, text, text, int, text, text, text) from public;
grant execute on function classroom.create_ticket_mailbox(uuid, text, text, text, text, text, int, text, text, int, text, text, text) to service_role;

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

  -- Idempotency guard: a re-polled message (overlapping poll cycles, an
  -- IMAP UID reset) must not create a second ticket or a duplicate reply.
  if message_id_in is not null then
    select id into existing_ticket_id from classroom.tickets
    where school_id = mb.school_id and origin_message_id = message_id_in;
    if existing_ticket_id is not null then
      return existing_ticket_id;
    end if;

    if exists (
      select 1 from classroom.ticket_messages tm
      join classroom.tickets t on t.id = tm.ticket_id
      where t.school_id = mb.school_id and tm.email_message_id = message_id_in
    ) then
      select tm.ticket_id into existing_ticket_id
      from classroom.ticket_messages tm
      join classroom.tickets t on t.id = tm.ticket_id
      where t.school_id = mb.school_id and tm.email_message_id = message_id_in
      limit 1;
      return existing_ticket_id;
    end if;
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
     requester_id, requester_email, requester_name, channel, mailbox_id, origin_message_id)
  values
    (mb.school_id, classroom.next_ticket_number(mb.school_id),
     coalesce(nullif(btrim(subject_in), ''), '(no subject)'), coalesce(body_in, ''), 'low',
     resolved_requester,
     case when resolved_requester is null then from_email_in else null end,
     case when resolved_requester is null then nullif(btrim(from_name_in), '') else null end,
     'email', target_mailbox, message_id_in)
  returning * into new_ticket;

  return new_ticket.id;
end;
$fn$;

revoke all on function classroom.ingest_inbound_ticket_email(uuid, text, text, text[], text, text, text, text) from public;
grant execute on function classroom.ingest_inbound_ticket_email(uuid, text, text, text[], text, text, text, text) to service_role;

notify pgrst, 'reload schema';
