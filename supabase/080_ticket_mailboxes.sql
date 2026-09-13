-- =============================================================================
-- Tickets, phase 2 of the email-integration plan — mailbox connection + the
-- schema email-originated tickets need. No inbound/outbound wiring yet
-- (that's the Edge Functions, added alongside this migration) — this is the
-- table, the secret storage, and the columns everything else builds on.
--
-- Secrets (an IMAP/SMTP app password, an OAuth refresh token) are never
-- stored in a plain column: classroom.ticket_mailboxes holds only a
-- reference (secret_vault_id / oauth_vault_id) into Supabase Vault, which
-- is already enabled on this project and unused until now. The actual
-- value is written by classroom.set_mailbox_secret() and read back only by
-- classroom.get_mailbox_secret() — both revoked from every role except
-- service_role, so only an Edge Function (never a browser client) can ever
-- see a decrypted secret.
--
-- Run after 079. Safe to re-run.
-- =============================================================================

/* ---------------------------------------------------------------------------
   The mailbox itself. A school connects one (or more) — info@theirdomain,
   on whatever provider they actually use.
   --------------------------------------------------------------------------- */
create table if not exists classroom.ticket_mailboxes (
  id                    uuid primary key default gen_random_uuid(),
  school_id             uuid not null references classroom.schools (id) on delete cascade,
  label                 text not null default 'Support',
  address               text not null,
  display_name          text,
  provider              text not null default 'imap_smtp' check (provider in ('imap_smtp','microsoft365','google')),
  is_active             boolean not null default true,

  -- generic IMAP/SMTP (provider = 'imap_smtp')
  imap_host             text,
  imap_port             int,
  imap_security         text check (imap_security in ('ssl','starttls','none')),
  smtp_host             text,
  smtp_port             int,
  smtp_security         text check (smtp_security in ('ssl','starttls','none')),
  username              text,
  secret_vault_id       uuid,

  -- OAuth (provider = 'microsoft365' or 'google') — phase 3/4
  oauth_vault_id        uuid,
  oauth_connected_email text,
  oauth_tenant_id       text,

  last_poll_at          timestamptz,
  last_poll_status      text check (last_poll_status in ('ok','error')),
  last_poll_error       text,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (school_id, address)
);

alter table classroom.ticket_mailboxes enable row level security;

-- Owner/admin only — narrower than ticket-staff as a whole. A bursar or
-- admissions officer manages tickets, not the school's own mail server
-- credentials.
drop policy if exists "school admins view mailboxes" on classroom.ticket_mailboxes;
create policy "school admins view mailboxes"
  on classroom.ticket_mailboxes for select to authenticated
  using (classroom.has_role_in(school_id, array['owner','admin']::classroom.member_role[]));

-- The only direct write a browser client may make is toggling is_active —
-- connecting (which needs to mint a vault secret) goes through the
-- mailbox-connect Edge Function's service-role client instead, and
-- disconnecting goes through delete_ticket_mailbox() below so the vault
-- row is cleaned up rather than orphaned. No insert/delete grant to
-- authenticated at all.
drop policy if exists "school admins toggle mailboxes" on classroom.ticket_mailboxes;
create policy "school admins toggle mailboxes"
  on classroom.ticket_mailboxes for update to authenticated
  using (classroom.has_role_in(school_id, array['owner','admin']::classroom.member_role[]))
  with check (classroom.has_role_in(school_id, array['owner','admin']::classroom.member_role[]));

grant select on classroom.ticket_mailboxes to authenticated;
grant update (is_active) on classroom.ticket_mailboxes to authenticated;

create trigger audit_trg after insert or update or delete on classroom.ticket_mailboxes
  for each row execute function classroom.write_audit_log();

/* ---------------------------------------------------------------------------
   Vault-backed secret helpers. Both revoked from PUBLIC/authenticated and
   granted only to service_role — an Edge Function's service-role client is
   the only caller that will ever exist for these.
   --------------------------------------------------------------------------- */
create or replace function classroom.set_mailbox_secret(target_mailbox uuid, which text, plaintext text)
returns void
language plpgsql
security definer
set search_path = classroom, public, vault
as $fn$
declare
  new_id uuid;
  old_id uuid;
begin
  if which not in ('password', 'oauth') then
    raise exception 'Unknown secret kind: %', which;
  end if;

  new_id := vault.create_secret(
    plaintext,
    'ticket_mailbox:' || target_mailbox::text || ':' || which || ':' || gen_random_uuid()::text,
    'Ticket mailbox credential'
  );

  if which = 'password' then
    select secret_vault_id into old_id from classroom.ticket_mailboxes where id = target_mailbox;
    update classroom.ticket_mailboxes set secret_vault_id = new_id, updated_at = now() where id = target_mailbox;
  else
    select oauth_vault_id into old_id from classroom.ticket_mailboxes where id = target_mailbox;
    update classroom.ticket_mailboxes set oauth_vault_id = new_id, updated_at = now() where id = target_mailbox;
  end if;

  if old_id is not null then
    delete from vault.secrets where id = old_id;
  end if;
end;
$fn$;

revoke all on function classroom.set_mailbox_secret(uuid, text, text) from public;
grant execute on function classroom.set_mailbox_secret(uuid, text, text) to service_role;

create or replace function classroom.get_mailbox_secret(target_mailbox uuid, which text)
returns text
language plpgsql
security definer
set search_path = classroom, public, vault
as $fn$
declare
  vid uuid;
  val text;
begin
  if which = 'password' then
    select secret_vault_id into vid from classroom.ticket_mailboxes where id = target_mailbox;
  elsif which = 'oauth' then
    select oauth_vault_id into vid from classroom.ticket_mailboxes where id = target_mailbox;
  else
    raise exception 'Unknown secret kind: %', which;
  end if;

  if vid is null then return null; end if;
  select decrypted_secret into val from vault.decrypted_secrets where id = vid;
  return val;
end;
$fn$;

revoke all on function classroom.get_mailbox_secret(uuid, text) from public;
grant execute on function classroom.get_mailbox_secret(uuid, text) to service_role;

-- Disconnecting a mailbox has to clean up its vault secret(s) too, or they
-- sit there forever — a raw table DELETE from the client can't do that
-- (and isn't granted to authenticated at all; see above).
create or replace function classroom.delete_ticket_mailbox(target_mailbox uuid)
returns void
language plpgsql
security definer
set search_path = classroom, public, vault
as $fn$
declare
  mb classroom.ticket_mailboxes;
begin
  select * into mb from classroom.ticket_mailboxes where id = target_mailbox;
  if not found or not classroom.has_role_in(mb.school_id, array['owner','admin']::classroom.member_role[]) then
    raise exception 'You cannot remove this mailbox';
  end if;

  if mb.secret_vault_id is not null then delete from vault.secrets where id = mb.secret_vault_id; end if;
  if mb.oauth_vault_id is not null then delete from vault.secrets where id = mb.oauth_vault_id; end if;
  delete from classroom.ticket_mailboxes where id = target_mailbox;
end;
$fn$;

grant execute on function classroom.delete_ticket_mailbox(uuid) to authenticated;

/* ---------------------------------------------------------------------------
   tickets / ticket_messages — the columns an email-originated ticket needs.
   requester_id becomes nullable: an inbound email may come from someone
   with no Schoolivio account at all, in which case requester_email/
   requester_name hold the raw sender instead.
   --------------------------------------------------------------------------- */
alter table classroom.tickets alter column requester_id drop not null;
alter table classroom.tickets add column if not exists channel text not null default 'web' check (channel in ('web','email'));
alter table classroom.tickets add column if not exists mailbox_id uuid references classroom.ticket_mailboxes (id) on delete set null;
alter table classroom.tickets add column if not exists requester_email text;
alter table classroom.tickets add column if not exists requester_name text;

alter table classroom.ticket_messages add column if not exists direction text not null default 'internal' check (direction in ('internal','inbound','outbound'));
alter table classroom.ticket_messages add column if not exists to_addresses text[];
alter table classroom.ticket_messages add column if not exists cc_addresses text[];
alter table classroom.ticket_messages add column if not exists bcc_addresses text[];
alter table classroom.ticket_messages add column if not exists email_message_id text;
alter table classroom.ticket_messages add column if not exists in_reply_to text;
alter table classroom.ticket_messages add column if not exists external_from text;
alter table classroom.ticket_messages add column if not exists send_status text check (send_status in ('sent','failed'));
alter table classroom.ticket_messages add column if not exists send_error text;

notify pgrst, 'reload schema';
