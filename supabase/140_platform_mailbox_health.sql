-- =============================================================================
-- Integration health — ticket_mailboxes (080_ticket_mailboxes.sql) already
-- records last_poll_at/last_poll_status/last_poll_error every time
-- ticket-mail-poll runs, entirely so a broken IMAP/SMTP credential has
-- somewhere to show up. Today it only shows up inside that one school's own
-- Mailboxes settings tab — a school with a silently-broken connection has
-- to notice missing support emails before anyone looks. This surfaces the
-- same status fields platform-wide: never the mailbox's own credentials
-- (secret_vault_id stays untouched), just whether the connection is
-- currently healthy.
-- =============================================================================

create or replace function classroom.platform_mailbox_health()
returns table (
  school_id        uuid,
  school_name      text,
  mailbox_id       uuid,
  address          text,
  provider         text,
  is_active        boolean,
  last_poll_at     timestamptz,
  last_poll_status text,
  last_poll_error  text
)
language sql
stable
security definer
set search_path = classroom, public
as $fn$
  select s.id, s.name, m.id, m.address, m.provider, m.is_active,
         m.last_poll_at, m.last_poll_status, m.last_poll_error
  from classroom.ticket_mailboxes m
  join classroom.schools s on s.id = m.school_id
  where classroom.is_platform_admin()
  order by
    -- Broken connections first, then never-yet-polled, then healthy ones —
    -- the point of this view is "which of these needs my attention", not
    -- an alphabetical directory.
    (m.last_poll_status = 'error') desc,
    (m.last_poll_at is null) desc,
    m.last_poll_at asc nulls first;
$fn$;

grant execute on function classroom.platform_mailbox_health() to authenticated;

notify pgrst, 'reload schema';
