-- =============================================================================
-- Scope update_ticket() and add_ticket_message() to the caller's current
-- school — same class of gap as the admissions RPCs fixed in 095-101:
-- can_access_ticket()/the requester check are correct for the ticket's real
-- school, but blind to which tenant the caller currently has open.
-- =============================================================================

drop function if exists classroom.update_ticket(uuid, text, text, uuid, uuid, text[], boolean, boolean);

create or replace function classroom.update_ticket(
  target_ticket  uuid,
  target_school  uuid,
  status_in      text default null,
  priority_in    text default null,
  group_id_in    uuid default null,
  assigned_to_in uuid default null,
  tags_in        text[] default null,
  clear_group    boolean default false,
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
  if not found or t.school_id <> target_school or not classroom.can_access_ticket(target_ticket) then
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

grant execute on function classroom.update_ticket(uuid, uuid, text, text, uuid, uuid, text[], boolean, boolean) to authenticated;

drop function if exists classroom.add_ticket_message(uuid, text, text);

create or replace function classroom.add_ticket_message(
  target_ticket uuid,
  kind_in       text,
  body_in       text,
  target_school uuid
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
  if not found or t.school_id <> target_school then
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

grant execute on function classroom.add_ticket_message(uuid, text, text, uuid) to authenticated;

notify pgrst, 'reload schema';
