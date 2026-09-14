-- =============================================================================
-- Scope ticket_group_history() and delete_ticket_mailbox() to the caller's
-- current school — same class of gap as 095-102.
-- =============================================================================

drop function if exists classroom.ticket_group_history(uuid);

create or replace function classroom.ticket_group_history(target_ticket uuid, target_school uuid)
returns table (
  changed_at      timestamptz,
  actor_label     text,
  from_group_name text,
  to_group_name   text
)
language plpgsql
stable
security definer
set search_path = classroom, public
as $fn$
declare
  t classroom.tickets;
begin
  select * into t from classroom.tickets where id = target_ticket;
  if not found or t.school_id <> target_school then
    raise exception 'This ticket does not belong to the current school';
  end if;
  if not classroom.can_access_ticket(target_ticket) then
    raise exception 'You cannot view this ticket''s history';
  end if;

  return query
  select
    al.created_at,
    al.actor_label,
    fg.name as from_group_name,
    tg.name as to_group_name
  from classroom.audit_log al
  left join classroom.ticket_groups fg on fg.id = nullif(al.old_data ->> 'group_id', '')::uuid
  left join classroom.ticket_groups tg on tg.id = nullif(al.new_data ->> 'group_id', '')::uuid
  where al.table_name = 'tickets'
    and al.record_id = target_ticket::text
    and al.action = 'UPDATE'
    and al.changed_fields is not null
    and 'group_id' = any(al.changed_fields)
  order by al.created_at;
end;
$fn$;

grant execute on function classroom.ticket_group_history(uuid, uuid) to authenticated;

drop function if exists classroom.delete_ticket_mailbox(uuid);

create or replace function classroom.delete_ticket_mailbox(target_mailbox uuid, target_school uuid)
returns void
language plpgsql
security definer
set search_path = classroom, public, vault
as $fn$
declare
  mb classroom.ticket_mailboxes;
begin
  select * into mb from classroom.ticket_mailboxes where id = target_mailbox;
  if not found
     or mb.school_id <> target_school
     or not classroom.has_role_in(target_school, array['owner','admin']::classroom.member_role[]) then
    raise exception 'You cannot remove this mailbox';
  end if;

  if mb.secret_vault_id is not null then delete from vault.secrets where id = mb.secret_vault_id; end if;
  if mb.oauth_vault_id is not null then delete from vault.secrets where id = mb.oauth_vault_id; end if;
  delete from classroom.ticket_mailboxes where id = target_mailbox;
end;
$fn$;

grant execute on function classroom.delete_ticket_mailbox(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
