-- =============================================================================
-- Tickets — department-scoped visibility. Every staff role except student
-- and parent now handles tickets (teacher included, previously the one
-- staff role left out), but only within their own department: a bursar
-- sees Bursary's queue, not Admissions', a teacher sees Teacher's, not
-- Bursary's. Owner and admin keep seeing every ticket in every department —
-- the same oversight they already have everywhere else in this app (Audit
-- Log, Reports, School Admin) — since coordinating a cross-department
-- handoff (an admissions officer needing bursary to confirm a payment,
-- named as the motivating example) needs someone able to see both sides,
-- or the handoff is just a group re-assignment either side can do to a
-- ticket already in their own department.
--
-- A ticket with no group at all is untriaged — visible to owner/admin only,
-- until it's routed to a department. Self-service ticket creation (059's
-- MyTickets.jsx) and the staff-side New ticket form both let a group be
-- picked at creation, so most tickets never sit untriaged in practice.
--
-- Run after 087. Safe to re-run.
-- =============================================================================

/* ---------------------------------------------------------------------------
   A group can now be a department (tied to one role) or stay a free-form
   label (role left null) — a school can still add its own on top of the
   ones auto-provisioned below.
   --------------------------------------------------------------------------- */
alter table classroom.ticket_groups add column if not exists role classroom.member_role;

insert into classroom.ticket_groups (school_id, name, role)
select s.id, d.label, d.role
from classroom.schools s
cross join (values
  ('principal'::classroom.member_role, 'Principal'),
  ('bursar'::classroom.member_role, 'Bursar'),
  ('admissions'::classroom.member_role, 'Admissions'),
  ('teacher'::classroom.member_role, 'Teacher')
) as d(role, label)
on conflict (school_id, name) do update set role = excluded.role, is_active = true;

/* ---------------------------------------------------------------------------
   Ticket-staff now includes teacher — every role except student and
   parent, per the brief.
   --------------------------------------------------------------------------- */
create or replace function classroom.is_ticket_staff(target_school uuid)
returns boolean
language sql stable security definer
set search_path = classroom, public
as $$
  select classroom.has_role_in(
    target_school,
    array['owner','admin','principal','bursar','admissions','teacher']::classroom.member_role[]
  );
$$;

/* ---------------------------------------------------------------------------
   The one predicate deciding "can this caller see/manage this specific
   ticket" — used by the RLS policy below (for direct PostgREST reads) and
   by update_ticket()/add_ticket_message()'s own checks (for the RPC path,
   which bypasses RLS as a SECURITY DEFINER function and so needs the same
   rule enforced again inside it, not just at the table).
   --------------------------------------------------------------------------- */
create or replace function classroom.can_access_ticket(target_ticket uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = classroom, public
as $fn$
declare
  t classroom.tickets;
begin
  select * into t from classroom.tickets where id = target_ticket;
  if not found then
    return false;
  end if;

  if classroom.has_role_in(t.school_id, array['owner','admin']::classroom.member_role[]) then
    return true;
  end if;

  if not classroom.is_ticket_staff(t.school_id) then
    return false;
  end if;

  if t.group_id is null then
    return false; -- untriaged; only owner/admin until it's routed
  end if;

  return exists (
    select 1 from classroom.ticket_groups tg
    where tg.id = t.group_id
      and tg.role is not null
      and classroom.has_role_in(t.school_id, array[tg.role])
  );
end;
$fn$;

drop policy if exists "ticket staff manage tickets" on classroom.tickets;
create policy "ticket staff manage tickets"
  on classroom.tickets for all to authenticated
  using (classroom.can_access_ticket(id))
  with check (classroom.can_access_ticket(id));

drop policy if exists "ticket staff manage messages" on classroom.ticket_messages;
create policy "ticket staff manage messages"
  on classroom.ticket_messages for all to authenticated
  using (classroom.can_access_ticket(ticket_id))
  with check (classroom.can_access_ticket(ticket_id));

/* ---------------------------------------------------------------------------
   create_ticket — validates a picked group actually belongs to this school
   (a bare FK never checked that — a latent cross-tenant gap, fixed while
   already in here) and lets the self-service form route a new ticket
   straight to the right department at creation, same as staff already
   could.
   --------------------------------------------------------------------------- */
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
  if group_id_in is not null and not exists (
    select 1 from classroom.ticket_groups where id = group_id_in and school_id = target_school
  ) then
    raise exception 'That group does not belong to this school';
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

/* ---------------------------------------------------------------------------
   update_ticket / add_ticket_message — the RPC path bypasses RLS as
   SECURITY DEFINER, so the department check has to be re-asserted here,
   not just at the table.
   --------------------------------------------------------------------------- */
create or replace function classroom.update_ticket(
  target_ticket uuid,
  status_in     text default null,
  priority_in   text default null,
  group_id_in   uuid default null,
  assigned_to_in uuid default null,
  tags_in       text[] default null,
  clear_group   boolean default false,
  clear_assignee boolean default false
) returns classroom.tickets
language plpgsql
security definer
set search_path = classroom, public
as $fn$
declare
  t classroom.tickets;
begin
  select * into t from classroom.tickets where id = target_ticket;
  if not found or not classroom.can_access_ticket(target_ticket) then
    raise exception 'You cannot update this ticket';
  end if;
  if group_id_in is not null and not exists (
    select 1 from classroom.ticket_groups where id = group_id_in and school_id = t.school_id
  ) then
    raise exception 'That group does not belong to this school';
  end if;

  update classroom.tickets set
    status       = coalesce(status_in, status),
    priority     = coalesce(priority_in, priority),
    group_id     = case when clear_group then null when group_id_in is not null then group_id_in else group_id end,
    assigned_to  = case when clear_assignee then null when assigned_to_in is not null then assigned_to_in else assigned_to end,
    tags         = coalesce(tags_in, tags),
    resolved_at  = case
                     when status_in = 'resolved' and status <> 'resolved' then now()
                     when status_in is not null and status_in <> 'resolved' then null
                     else resolved_at
                   end,
    closed_at    = case
                     when status_in = 'closed' and status <> 'closed' then now()
                     when status_in is not null and status_in <> 'closed' then null
                     else closed_at
                   end,
    updated_at   = now()
  where id = target_ticket
  returning * into t;

  return t;
end;
$fn$;

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

  if classroom.can_access_ticket(target_ticket) then
    null; -- ticket-staff in this ticket's own department, or owner/admin
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

notify pgrst, 'reload schema';
