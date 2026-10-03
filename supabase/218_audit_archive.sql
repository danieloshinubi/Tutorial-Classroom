-- Audit log retention: 12 months stay in the database, older entries move to
-- private file storage (bucket audit-archive, one JSON file per school per
-- batch), so the log can never fill the database on its own.
--
-- The audit-archive Edge Function does the moving once a month (pg_cron,
-- below): it takes a batch with audit_archive_take, writes it to storage, and
-- only after the upload succeeds removes exactly those rows with
-- audit_archive_remove. Nothing is deleted that was not first saved.
-- Both helpers are for the service role only.

insert into storage.buckets (id, name, public)
values ('audit-archive', 'audit-archive', false)
on conflict (id) do nothing;

create index if not exists audit_log_created_idx on classroom.audit_log (created_at);

create or replace function classroom.audit_archive_take(batch_size integer default 5000)
returns setof classroom.audit_log
language sql
stable
security definer
set search_path = classroom, public
as $fn$
  select * from classroom.audit_log
   where created_at < now() - interval '12 months'
   order by created_at
   limit greatest(1, least(coalesce(batch_size, 5000), 20000));
$fn$;

create or replace function classroom.audit_archive_remove(archived_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = classroom, public
as $fn$
declare n integer;
begin
  delete from classroom.audit_log
   where id = any(archived_ids)
     and created_at < now() - interval '12 months';
  get diagnostics n = row_count;
  return n;
end;
$fn$;

revoke all on function classroom.audit_archive_take(integer) from public, anon, authenticated;
revoke all on function classroom.audit_archive_remove(uuid[]) from public, anon, authenticated;
grant execute on function classroom.audit_archive_take(integer) to service_role;
grant execute on function classroom.audit_archive_remove(uuid[]) to service_role;

-- Monthly, 03:15 on the 1st. Same shared secret the mail poller uses.
select cron.unschedule('schoolivio-audit-archive')
 where exists (select 1 from cron.job where jobname = 'schoolivio-audit-archive');
select cron.schedule(
  'schoolivio-audit-archive',
  '15 3 1 * *',
  $job$
    select net.http_post(
      url := 'https://nulvsbapllfxvhdmyudt.supabase.co/functions/v1/audit-archive',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'ticket_mail_cron_secret')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
  $job$
);

notify pgrst, 'reload schema';
