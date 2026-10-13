-- Help desk mail in seconds, not up to five minutes (2026-10-08).
--
-- ticket-mail-poll looked at each mailbox once every 5 minutes, so a new
-- email took up to 5 minutes to become a ticket and a customer's reply as
-- long to appear on it. It now runs every minute and watches each mailbox
-- for most of that minute (IMAP IDLE, plus a look every few seconds).
--
-- Two guards come with it: only one watcher per mailbox at a time (a lease,
-- given back when the watch ends), and one email is turned into a ticket or
-- a reply once even if two runs meet it together (a lock per message in
-- ingest_inbound_ticket_email, so the second finds the first's work).

alter table classroom.ticket_mailboxes add column if not exists watch_until timestamptz;

create or replace function classroom.ticket_mailbox_watch(target_mailbox uuid, seconds int)
returns boolean language plpgsql security definer set search_path = classroom, public as $fn$
declare got uuid;
begin
  if seconds <= 0 then
    update classroom.ticket_mailboxes set watch_until = null where id = target_mailbox;
    return true;
  end if;
  update classroom.ticket_mailboxes set watch_until = now() + make_interval(secs => seconds)
   where id = target_mailbox and (watch_until is null or watch_until < now())
  returning id into got;
  return got is not null;
end;
$fn$;
revoke all on function classroom.ticket_mailbox_watch(uuid, int) from public, anon, authenticated;
grant execute on function classroom.ticket_mailbox_watch(uuid, int) to service_role;

do $do$
declare d text;
begin
  d := pg_get_functiondef('classroom.ingest_inbound_ticket_email(uuid,text,text,text[],text,text,text,text,text)'::regprocedure);
  if position('pg_advisory_xact_lock' in d) = 0 then
    d := replace(d, $a$  select * into mb from classroom.ticket_mailboxes where id = target_mailbox and is_active;$a$,
                 $b$  -- The same email met by two runs at once is taken once: the second
  -- waits here, then finds the first one's ticket below.
  perform pg_advisory_xact_lock(hashtextextended('ticket-mail:' || target_mailbox::text || ':' || coalesce(message_id_in, md5(coalesce(subject_in, '') || coalesce(from_email_in, '') || coalesce(body_in, ''))), 0));
  select * into mb from classroom.ticket_mailboxes where id = target_mailbox and is_active;$b$);
    if position('pg_advisory_xact_lock' in d) = 0 then raise exception 'ingest lock patch did not apply'; end if;
    execute d;
  end if;
end;
$do$;

select cron.alter_job(jobid, schedule := '* * * * *') from cron.job where jobname = 'ticket-mail-poll';

notify pgrst, 'reload schema';
