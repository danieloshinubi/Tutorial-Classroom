-- =============================================================================
-- Tickets, phase 2 continued — schedules ticket-mail-poll every 5 minutes,
-- the same pg_cron pattern generate_due_reminders() already uses
-- (017_course_access_and_activity.sql), extended with pg_net so the cron
-- job can actually reach an Edge Function over HTTP rather than only ever
-- calling a SQL function.
--
-- The shared secret pg_cron sends as `x-cron-secret` lives in Supabase
-- Vault, not in this file — the same reason a mailbox's app password does.
-- It still has to match whatever is set as the Edge Function's own
-- TICKET_MAIL_CRON_SECRET environment secret (a separate step, since that
-- one is set via the Supabase CLI/dashboard, not a migration).
--
-- Run after 083. Safe to re-run.
-- =============================================================================

create extension if not exists pg_net;

do $secret$
begin
  if not exists (select 1 from vault.secrets where name = 'ticket_mail_cron_secret') then
    perform vault.create_secret(
      'ecdf75298550cc46cc2a703c3269278174c9584df7491fefd4820d0172fcd6aa',
      'ticket_mail_cron_secret',
      'Shared secret pg_cron sends to the ticket-mail-poll Edge Function as x-cron-secret'
    );
  end if;
end;
$secret$;

do $cron$
begin
  perform cron.unschedule('ticket-mail-poll')
  where exists (select 1 from cron.job where jobname = 'ticket-mail-poll');

  perform cron.schedule(
    'ticket-mail-poll',
    '*/5 * * * *',
    $job$
      select net.http_post(
        url := 'https://nulvsbapllfxvhdmyudt.supabase.co/functions/v1/ticket-mail-poll',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'ticket_mail_cron_secret')
        ),
        body := '{}'::jsonb
      );
    $job$
  );
  raise notice 'ticket-mail-poll scheduled every 5 minutes with pg_cron.';
exception when others then
  -- Same fallback generate_due_reminders() takes: some environments don't
  -- have pg_cron/pg_net available, and this should not block the rest of
  -- the migration from applying.
  raise notice 'Could not schedule ticket-mail-poll: %', sqlerrm;
end;
$cron$;
