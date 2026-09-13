-- =============================================================================
-- Tickets, phase 2 continued — inbound email keeps its own formatting too.
-- Found live: a real reply's HTML (paragraphs, a signature block) was being
-- flattened through a crude tag-strip fallback before ever reaching
-- ingest_inbound_ticket_email(), leaving literal "&nbsp;" entities and a
-- single run-on paragraph — nothing like the message that was actually
-- sent. Outbound replies already carry their real formatting (085); inbound
-- needs the same treatment, not a plain-text approximation.
--
-- The very first message of an email-originated ticket lands in
-- tickets.description, not classroom.ticket_messages — it needs its own
-- format flag for exactly the same reason ticket_messages got one.
--
-- Run after 085. Safe to re-run.
-- =============================================================================

alter table classroom.tickets add column if not exists description_format text not null default 'plain' check (description_format in ('plain', 'html'));

drop function if exists classroom.ingest_inbound_ticket_email(uuid, text, text, text[], text, text, text, text);

create or replace function classroom.ingest_inbound_ticket_email(
  target_mailbox  uuid,
  message_id_in   text,
  in_reply_to_in  text,
  references_in   text[],
  from_email_in   text,
  from_name_in    text,
  subject_in      text,
  body_in         text,
  body_format_in  text default 'plain'
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
  fmt                text := case when body_format_in = 'html' then 'html' else 'plain' end;
begin
  select * into mb from classroom.ticket_mailboxes where id = target_mailbox and is_active;
  if not found then
    raise exception 'Unknown or inactive mailbox';
  end if;

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
      (ticket_id, author_id, kind, body, body_format, direction, email_message_id, in_reply_to, external_from)
    values
      (existing_ticket_id, resolved_requester, 'reply', coalesce(body_in, ''), fmt, 'inbound',
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
    (school_id, number, subject, description, description_format, priority,
     requester_id, requester_email, requester_name, channel, mailbox_id, origin_message_id)
  values
    (mb.school_id, classroom.next_ticket_number(mb.school_id),
     coalesce(nullif(btrim(subject_in), ''), '(no subject)'), coalesce(body_in, ''), fmt, 'low',
     resolved_requester,
     case when resolved_requester is null then from_email_in else null end,
     case when resolved_requester is null then nullif(btrim(from_name_in), '') else null end,
     'email', target_mailbox, message_id_in)
  returning * into new_ticket;

  return new_ticket.id;
end;
$fn$;

revoke all on function classroom.ingest_inbound_ticket_email(uuid, text, text, text[], text, text, text, text, text) from public;
grant execute on function classroom.ingest_inbound_ticket_email(uuid, text, text, text[], text, text, text, text, text) to service_role;

notify pgrst, 'reload schema';
