-- =============================================================================
-- Tickets — staff raising a ticket on someone else's behalf (a phone call,
-- a walk-in) need to say who it's actually for, not have it default to
-- themselves. A name alone keeps the ticket an internal record; an email
-- also marks it channel='email' so the existing Reply composer's To/Cc/Bcc
-- and real-send machinery just works — no separate "compose new email"
-- path to build, since ticket-mail-send already covers it.
--
-- Same email-match-or-raw-name-and-email pattern ingest_inbound_ticket_email
-- already uses for an unregistered sender.
--
-- Run after 086. Safe to re-run.
-- =============================================================================

drop function if exists classroom.create_ticket(uuid, text, text, text, uuid);

create or replace function classroom.create_ticket(
  target_school     uuid,
  subject_in        text,
  description_in    text,
  priority_in       text default 'low',
  group_id_in       uuid default null,
  requester_name_in text default null,
  requester_email_in text default null
) returns classroom.tickets
language plpgsql
security definer
set search_path = classroom, public
as $fn$
declare
  ticket classroom.tickets;
  resolved_requester uuid := auth.uid();
  resolved_channel    text := 'web';
  resolved_mailbox    uuid;
  clean_email         text := nullif(btrim(coalesce(requester_email_in, '')), '');
  clean_name          text := nullif(btrim(coalesce(requester_name_in, '')), '');
begin
  if not classroom.is_member_of(target_school) then
    raise exception 'You must be a member of this school to raise a ticket';
  end if;
  if btrim(coalesce(subject_in, '')) = '' then
    raise exception 'A ticket needs a subject';
  end if;

  if clean_email is not null then
    select p.id into resolved_requester
    from classroom.profiles p
    join classroom.school_members sm on sm.user_id = p.id and sm.school_id = target_school and sm.is_active
    where lower(p.email) = lower(clean_email)
    limit 1;

    resolved_channel := 'email';
    select id into resolved_mailbox from classroom.ticket_mailboxes
      where school_id = target_school and is_active and provider = 'imap_smtp'
      order by created_at limit 1;
  elsif clean_name is not null then
    -- Named, but no email to link or send through — an internal record
    -- staff-only (no linked account means no self-service visibility).
    resolved_requester := null;
  end if;

  insert into classroom.tickets
    (school_id, number, subject, description, priority, group_id, requester_id,
     requester_email, requester_name, channel, mailbox_id)
  values
    (target_school, classroom.next_ticket_number(target_school), btrim(subject_in),
     coalesce(description_in, ''), coalesce(priority_in, 'low'), group_id_in,
     resolved_requester,
     case when resolved_requester is null then clean_email else null end,
     case when resolved_requester is null then clean_name else null end,
     resolved_channel, resolved_mailbox)
  returning * into ticket;

  return ticket;
end;
$fn$;

notify pgrst, 'reload schema';
