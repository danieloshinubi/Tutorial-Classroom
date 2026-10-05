-- Schoolivio Mail, step 3: schools without a domain of their own, and the
-- console's view of every school's mail.
--
--   A school with no domain uses <slug>.schoolivio.com, still with its own
--   Resend account. The DNS records Resend asks for live in schoolivio.com's
--   zone (Vercel DNS), so Schoolivio adds them: Console → Mail → "Add DNS
--   records", through the platform-mail Edge Function and a Vercel token kept
--   in Vault (Console → Mail).
--   Console → Mail lists every school: its domain, whether outside sending
--   and receiving are on, its mailboxes and storage, what is waiting or
--   failed, and which schoolivio.com schools still need their records.

-- 1. The Vercel token for schoolivio.com's DNS ------------------------------------------
alter table classroom.platform_settings
  add column if not exists vercel_secret_id uuid,
  add column if not exists vercel_team_id text;
revoke select (vercel_secret_id) on classroom.platform_settings from authenticated;

create or replace function classroom.platform_set_secret(which text, plaintext text)
returns void language plpgsql security definer set search_path = classroom, public, vault as $fn$
declare new_id uuid; old_id uuid;
begin
  if which not in ('smtp', 'paystack', 'vercel') then raise exception 'Unknown secret'; end if;
  new_id := vault.create_secret(plaintext, 'platform:' || which || ':' || gen_random_uuid()::text, 'Schoolivio platform credential');
  select case which when 'smtp' then smtp_secret_id when 'paystack' then paystack_secret_id else vercel_secret_id end
    into old_id from classroom.platform_settings where id;
  update classroom.platform_settings
     set smtp_secret_id = case when which = 'smtp' then new_id else smtp_secret_id end,
         paystack_secret_id = case when which = 'paystack' then new_id else paystack_secret_id end,
         vercel_secret_id = case when which = 'vercel' then new_id else vercel_secret_id end,
         updated_at = now()
   where id;
  if old_id is not null then delete from vault.secrets where id = old_id; end if;
end;
$fn$;

create or replace function classroom.platform_get_secret(which text)
returns text language sql stable security definer set search_path = classroom, public, vault as $fn$
  select s.decrypted_secret from vault.decrypted_secrets s
   where s.id = (select case which when 'smtp' then smtp_secret_id when 'paystack' then paystack_secret_id
                                   when 'vercel' then vercel_secret_id end
                   from classroom.platform_settings where id);
$fn$;
revoke all on function classroom.platform_set_secret(text, text) from public, anon, authenticated;
revoke all on function classroom.platform_get_secret(text) from public, anon, authenticated;
grant execute on function classroom.platform_set_secret(text, text), classroom.platform_get_secret(text) to service_role;

create or replace function classroom.platform_set_vercel_team(team_in text)
returns void language sql security definer set search_path = classroom, public as $fn$
  update classroom.platform_settings set vercel_team_id = nullif(btrim(team_in), ''), updated_at = now() where id;
$fn$;
revoke all on function classroom.platform_set_vercel_team(text) from public, anon, authenticated;
grant execute on function classroom.platform_set_vercel_team(text) to service_role;

create or replace function classroom.platform_vercel_team()
returns text language sql stable security definer set search_path = classroom, public as $fn$
  select vercel_team_id from classroom.platform_settings where id;
$fn$;
revoke all on function classroom.platform_vercel_team() from public, anon, authenticated;
grant execute on function classroom.platform_vercel_team() to service_role;

-- 2. When Schoolivio last added a school's records ---------------------------------------
alter table classroom.mail_settings add column if not exists platform_dns_at timestamptz;

create or replace function classroom.mail_platform_dns_done(target_school uuid)
returns void language sql security definer set search_path = classroom, public as $fn$
  update classroom.mail_settings set platform_dns_at = now(), updated_at = now() where school_id = target_school;
$fn$;
revoke all on function classroom.mail_platform_dns_done(uuid) from public, anon, authenticated;
grant execute on function classroom.mail_platform_dns_done(uuid) to service_role;

-- The school's schoolivio.com name (its slug), for platform-mail.
create or replace function classroom.mail_school_slug(target_school uuid)
returns text language sql stable security definer set search_path = classroom, public as $fn$
  select slug from classroom.schools where id = target_school;
$fn$;
revoke all on function classroom.mail_school_slug(uuid) from public, anon, authenticated;
grant execute on function classroom.mail_school_slug(uuid) to service_role;

-- The school admin's page also says whether Schoolivio has added them yet.
do $do$
declare d text;
begin
  d := pg_get_functiondef('classroom.mail_settings_get(uuid)'::regprocedure);
  if position('platform_dns_at' in d) = 0 then
    d := replace(d, '''checked_at'', s.checked_at,', '''checked_at'', s.checked_at,
    ''platform_dns_at'', s.platform_dns_at,');
    execute d;
  end if;
end
$do$;

-- 3. Console → Mail --------------------------------------------------------------------------
create or replace function classroom.platform_mail_overview()
returns jsonb language plpgsql stable security definer set search_path = classroom, public as $fn$
begin
  if not classroom.is_platform_admin() then raise exception 'Only a platform administrator can see this.'; end if;
  return jsonb_build_object(
    'vercel_connected', (select vercel_secret_id is not null from classroom.platform_settings where id),
    'vercel_team_id', (select vercel_team_id from classroom.platform_settings where id),
    'schools', coalesce((
      select jsonb_agg(row_to_json(x)::jsonb order by x.needs_dns desc, x.name)
        from (
          select s.id as school_id, s.name, s.slug,
                 ms.domain,
                 case when ms.domain is null then 'none'
                      when ms.domain = s.slug || '.schoolivio.com' then 'schoolivio'
                      else 'own' end as kind,
                 coalesce(ms.key_vault_id is not null, false) as has_key,
                 coalesce(ms.domain_status, 'none') as domain_status,
                 coalesce(ms.sending_enabled, false) as sending_enabled,
                 coalesce(ms.receiving_enabled, false) as receiving_enabled,
                 coalesce(ms.receiving_status, 'off') as receiving_status,
                 coalesce(ms.webhook_id is not null, false) as reports_on,
                 ms.checked_at, ms.platform_dns_at, ms.last_error,
                 case when ms.domain = s.slug || '.schoolivio.com' then ms.dns_records else '[]'::jsonb end as dns_records,
                 -- A schoolivio.com school with its Resend connected whose records are not all found yet.
                 (ms.domain = s.slug || '.schoolivio.com' and ms.key_vault_id is not null
                   and exists (select 1 from jsonb_array_elements(ms.dns_records) r where r ->> 'status' <> 'verified')) as needs_dns,
                 (select count(*) from classroom.mail_mailboxes b where b.school_id = s.id) as mailboxes,
                 (select coalesce(sum(b.used_bytes), 0) from classroom.mail_mailboxes b where b.school_id = s.id) as used_bytes,
                 (select count(*) from classroom.mail_outbound o join classroom.mail_messages m on m.id = o.message_id
                    join classroom.mail_mailboxes b on b.id = m.mailbox_id
                   where b.school_id = s.id and o.status in ('pending', 'sending')) as waiting,
                 (select count(*) from classroom.mail_outbound o join classroom.mail_messages m on m.id = o.message_id
                    join classroom.mail_mailboxes b on b.id = m.mailbox_id
                   where b.school_id = s.id and o.status in ('failed', 'bounced', 'complained') and o.updated_at > now() - interval '7 days') as failed_week,
                 (select count(*) from classroom.mail_outbound o join classroom.mail_messages m on m.id = o.message_id
                    join classroom.mail_mailboxes b on b.id = m.mailbox_id
                   where b.school_id = s.id and o.sent_at > now() - interval '7 days') as sent_week,
                 (select count(distinct m.inbound_id) from classroom.mail_messages m join classroom.mail_mailboxes b on b.id = m.mailbox_id
                   where b.school_id = s.id and m.inbound_id is not null and m.created_at > now() - interval '7 days') as received_week
            from classroom.schools s
            left join classroom.mail_settings ms on ms.school_id = s.id
        ) x), '[]'::jsonb));
end;
$fn$;
revoke all on function classroom.platform_mail_overview() from public, anon;
grant execute on function classroom.platform_mail_overview() to authenticated;

notify pgrst, 'reload schema';
