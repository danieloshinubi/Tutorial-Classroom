-- =============================================================================
-- Tickets — a department transfer history, visible on the ticket itself.
--
-- classroom.audit_log already records every change to a ticket (077's
-- audit_trg trigger, generic since 062) — this doesn't duplicate that
-- logging, it reads the slice of it that matters here. audit_log's own
-- RLS is owner/admin only (a compliance surface, not a day-to-day one —
-- see 062's own comment), so any ticket-staff member opening a ticket they
-- can already see would otherwise have no way to read even their own
-- department's transfer history. This is the narrow, purpose-built read
-- instead: exactly which group a ticket moved from and to, and by whom,
-- gated by the same can_access_ticket() check as everything else on a
-- ticket — not a general grant onto audit_log itself.
--
-- Run after 088. Safe to re-run.
-- =============================================================================

create or replace function classroom.ticket_group_history(target_ticket uuid)
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
begin
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

grant execute on function classroom.ticket_group_history(uuid) to authenticated;

notify pgrst, 'reload schema';
