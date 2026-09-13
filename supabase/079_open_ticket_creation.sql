-- =============================================================================
-- Tickets, phase 1 of the email-integration plan — open ticket creation
--
-- Raising a ticket was staff-only (classroom.is_ticket_staff). Every school
-- member — students, parents, teachers included — should be able to raise
-- their own ticket and follow its thread, while ticket-staff keep seeing and
-- managing the whole school-wide queue exactly as before. This does NOT
-- touch email (that's phase 2) — it only opens the existing in-app flow to
-- everyone for their own tickets.
--
-- Run after 078. Safe to re-run.
-- =============================================================================

/* ---------------------------------------------------------------------------
   create_ticket — anyone who belongs to the school may raise one now, not
   just ticket-staff. Still stamps requester_id as the caller; still can't
   raise a ticket pretending to be someone else.
   --------------------------------------------------------------------------- */
create or replace function classroom.create_ticket(
  target_school uuid,
  subject_in    text,
  description_in text,
  priority_in   text default 'low',
  group_id_in   uuid default null
) returns classroom.tickets
language plpgsql
security definer
set search_path = classroom, public
as $fn$
declare
  ticket classroom.tickets;
begin
  if not classroom.is_member_of(target_school) then
    raise exception 'You must be a member of this school to raise a ticket';
  end if;
  if btrim(coalesce(subject_in, '')) = '' then
    raise exception 'A ticket needs a subject';
  end if;

  insert into classroom.tickets
    (school_id, number, subject, description, priority, group_id, requester_id)
  values
    (target_school, classroom.next_ticket_number(target_school), btrim(subject_in),
     coalesce(description_in, ''), coalesce(priority_in, 'low'), group_id_in, auth.uid())
  returning * into ticket;

  return ticket;
end;
$fn$;

/* ---------------------------------------------------------------------------
   add_ticket_message — ticket-staff can still post a reply or an internal
   note to any ticket in their school. The ticket's own requester can now
   also reply to their own ticket (never a note — notes stay staff-only).
   --------------------------------------------------------------------------- */
create or replace function classroom.add_ticket_message(
  target_ticket uuid,
  kind_in       text,
  body_in       text
) returns classroom.ticket_messages
language plpgsql
security definer
set search_path = classroom, public
as $fn$
declare
  msg classroom.ticket_messages;
  t   classroom.tickets;
  effective_kind text := coalesce(kind_in, 'reply');
begin
  select * into t from classroom.tickets where id = target_ticket;
  if not found then
    raise exception 'You cannot post to this ticket';
  end if;

  if classroom.is_ticket_staff(t.school_id) then
    null; -- staff may post either kind, to any ticket in their school
  elsif t.requester_id = auth.uid() and effective_kind = 'reply' then
    null; -- the ticket's own requester may reply to their own ticket only
  else
    raise exception 'You cannot post to this ticket';
  end if;

  if btrim(coalesce(body_in, '')) = '' then
    raise exception 'A message needs some content';
  end if;

  insert into classroom.ticket_messages (ticket_id, author_id, kind, body)
  values (target_ticket, auth.uid(), effective_kind, btrim(body_in))
  returning * into msg;

  if effective_kind = 'reply' and t.first_response_at is null and t.requester_id <> auth.uid() then
    update classroom.tickets set first_response_at = now(), updated_at = now() where id = target_ticket;
  end if;

  return msg;
end;
$fn$;

/* ---------------------------------------------------------------------------
   RLS — a member may see their own ticket and its non-note messages. The
   existing "for all" staff policies are untouched and still apply (a row is
   visible if either policy's using-clause is true), so staff keep seeing
   and managing everything school-wide, notes included.
   --------------------------------------------------------------------------- */
drop policy if exists "members view own tickets" on classroom.tickets;
create policy "members view own tickets"
  on classroom.tickets for select to authenticated
  using (requester_id = auth.uid() and classroom.is_member_of(school_id));

drop policy if exists "members view own ticket messages" on classroom.ticket_messages;
create policy "members view own ticket messages"
  on classroom.ticket_messages for select to authenticated
  using (
    kind <> 'note'
    and exists (
      select 1 from classroom.tickets t
      where t.id = ticket_id and t.requester_id = auth.uid() and classroom.is_member_of(t.school_id)
    )
  );

notify pgrst, 'reload schema';
