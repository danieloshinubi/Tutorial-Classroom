-- Schoolivio Mail, step 2: mail from outside lands in the right person's
-- Inbox. Each school turns receiving on for its domain in its own Resend
-- account; Resend tells mail-resend-webhook ("email.received"), which fetches
-- the message and its attachments from Resend and hands them to mail_receive.
--
--   Who gets it   every To / Cc / Bcc / "received for" address that is a
--                 mailbox of that school (its current or an earlier
--                 address), or any name at the school's Resend test address
--                 (<id>.resend.app), matched by the part before the @.
--   Conversation  a reply joins the conversation it answers (In-Reply-To /
--                 References), or failing that the last one with the same
--                 subject and that sender in the past 60 days.
--   Junk          mail failing the sender's own DMARC check goes to Junk.
--   Not delivered addresses with no mailbox, or a full one, are reported
--                 back to the sender by the webhook (only when the sender
--                 proved who they are, so forged senders get nothing).
--   Once only     Resend may send the same report twice; inbound_id keeps
--                 each message to one copy per mailbox.

-- 1. The school's receiving switch -----------------------------------------------------
alter table classroom.mail_settings
  add column if not exists receiving_enabled boolean not null default false,
  add column if not exists receiving_status text not null default 'off';   -- off, not_started, pending, verified, failed

create or replace function classroom.mail_settings_receiving(target_school uuid, enabled_in boolean, status_in text)
returns void language sql security definer set search_path = classroom, public as $fn$
  update classroom.mail_settings
     set receiving_enabled = enabled_in, receiving_status = case when enabled_in then coalesce(status_in, 'not_started') else 'off' end,
         updated_at = now()
   where school_id = target_school;
$fn$;
revoke all on function classroom.mail_settings_receiving(uuid, boolean, text) from public, anon, authenticated;
grant execute on function classroom.mail_settings_receiving(uuid, boolean, text) to service_role;

create or replace function classroom.mail_settings_get(target_school uuid)
returns jsonb language plpgsql stable security definer set search_path = classroom, public as $fn$
declare
  s classroom.mail_settings;
  fallback text;
begin
  if not exists (select 1 from classroom.school_members m where m.school_id = target_school and m.user_id = (select auth.uid()) and m.is_active) then
    raise exception 'Not a member of this school.';
  end if;
  select * into s from classroom.mail_settings where school_id = target_school;
  select slug || '.schoolivio.com' into fallback from classroom.schools where id = target_school;
  if not classroom.is_school_admin(target_school) then
    return jsonb_build_object('domain', coalesce(s.domain, fallback), 'sending_enabled', coalesce(s.sending_enabled, false));
  end if;
  return jsonb_build_object(
    'domain', s.domain,
    'fallback_domain', fallback,
    'region', coalesce(s.region, 'us-east-1'),
    'domain_status', coalesce(s.domain_status, 'none'),
    'dns_records', coalesce(s.dns_records, '[]'::jsonb),
    'has_key', s.key_vault_id is not null,
    'key_hint', s.key_hint,
    'reports_on', s.webhook_id is not null,
    'sending_enabled', coalesce(s.sending_enabled, false),
    'receiving_enabled', coalesce(s.receiving_enabled, false),
    'receiving_status', coalesce(s.receiving_status, 'off'),
    'last_error', s.last_error,
    'checked_at', s.checked_at,
    'connected_at', s.connected_at,
    'received_week', (select count(distinct m.inbound_id) from classroom.mail_messages m join classroom.mail_mailboxes b on b.id = m.mailbox_id
                       where b.school_id = target_school and m.inbound_id is not null and m.created_at > now() - interval '7 days'),
    'waiting', (select count(*) from classroom.mail_outbound o join classroom.mail_messages m on m.id = o.message_id
                  join classroom.mail_mailboxes b on b.id = m.mailbox_id
                 where b.school_id = target_school and o.status in ('pending', 'sending')));
end;
$fn$;
revoke all on function classroom.mail_settings_get(uuid) from public, anon;
grant execute on function classroom.mail_settings_get(uuid) to authenticated;

-- 2. What a received message keeps --------------------------------------------------------
alter table classroom.mail_messages
  add column if not exists inbound_id text,                         -- Resend's id for the received email
  add column if not exists reply_to jsonb not null default '[]'::jsonb;
create unique index if not exists mail_messages_inbound_key on classroom.mail_messages (mailbox_id, inbound_id) where inbound_id is not null;

-- 3. Who a received message is for ----------------------------------------------------------
-- For each address: the mailbox at this school it belongs to, or why not.
create or replace function classroom.mail_inbound_targets(target_school uuid, addresses text[], size_in bigint)
returns table (address text, mailbox_id uuid, outcome text)
language sql stable security definer set search_path = classroom, public as $fn$
  with wanted as (select distinct lower(btrim(a)) as address from unnest(addresses) a where btrim(coalesce(a, '')) <> ''),
  own as (select domain from classroom.mail_settings where school_id = target_school),
  matched as (
    select w.address,
           (select b.id from classroom.mail_mailboxes b
             where b.school_id = target_school and b.is_active
               and (b.address = w.address or w.address = any (b.previous_addresses)
                    -- The school's Resend test address: any name at <id>.resend.app.
                    or (split_part(w.address, '@', 2) like '%.resend.app' and split_part(b.address, '@', 1) = split_part(w.address, '@', 1)))
             order by (b.address = w.address) desc limit 1) as mailbox_id
      from wanted w
     -- Only this school's own addresses are its business; other people on the
     -- To / Cc line (a Gmail address, another school) are left alone.
     where split_part(w.address, '@', 2) = (select domain from own)
        or split_part(w.address, '@', 2) like '%.resend.app'
        or exists (select 1 from classroom.mail_mailboxes b where b.school_id = target_school
                    and (b.address = w.address or w.address = any (b.previous_addresses)))
  )
  select m.address, m.mailbox_id,
         case when m.mailbox_id is null then 'unknown'
              when (select used_bytes + size_in > quota_bytes from classroom.mail_mailboxes where id = m.mailbox_id) then 'full'
              else 'ok' end
    from matched m;
$fn$;
revoke all on function classroom.mail_inbound_targets(uuid, text[], bigint) from public, anon, authenticated;
grant execute on function classroom.mail_inbound_targets(uuid, text[], bigint) to service_role;

create or replace function classroom.mail_inbound_seen(target_school uuid, inbound_id_in text)
returns boolean language sql stable security definer set search_path = classroom, public as $fn$
  select exists (select 1 from classroom.mail_messages m join classroom.mail_mailboxes b on b.id = m.mailbox_id
                  where m.inbound_id = inbound_id_in and b.school_id = target_school);
$fn$;
revoke all on function classroom.mail_inbound_seen(uuid, text) from public, anon, authenticated;
grant execute on function classroom.mail_inbound_seen(uuid, text) to service_role;

-- 4. Putting it in each Inbox ---------------------------------------------------------------
-- msg: from_address, from_name, to_list, cc_list, reply_to, subject, html,
--      message_id, in_reply_to, references (text[]), sent_at, size, junk.
-- files: [{ file_path, file_name, mime_type, size_bytes, content_id }],
--      already uploaded to the "mail" bucket under the first mailbox.
create or replace function classroom.mail_receive(
  target_school uuid,
  inbound_id_in text,
  envelope_in uuid,
  mailbox_ids uuid[],
  msg jsonb,
  files jsonb default '[]'::jsonb
) returns int language plpgsql security definer set search_path = classroom, public as $fn$
declare
  box uuid;
  thread uuid;
  refs text[];
  subj text := coalesce(msg ->> 'subject', '');
  bare text;
  sender text := lower(coalesce(msg ->> 'from_address', ''));
  n int := 0;
  inserted uuid;
  f jsonb;
  has_files boolean := jsonb_array_length(coalesce(files, '[]'::jsonb)) > 0;
begin
  select coalesce(array_agg(x), '{}') into refs
    from (select jsonb_array_elements_text(coalesce(msg -> 'references', '[]'::jsonb)) x
          union select msg ->> 'in_reply_to') r where x is not null and x <> '';
  -- "Re: Fwd: RE: Exam timetable" and "Exam timetable" are one conversation.
  bare := lower(btrim(regexp_replace(subj, '^((re|fw|fwd|aw|wg)\s*(\[\d+\])?\s*:\s*)+', '', 'i')));

  foreach box in array mailbox_ids loop
    -- Only this school's mailboxes.
    continue when not exists (select 1 from classroom.mail_mailboxes where id = box and school_id = target_school);
    thread := null;
    if array_length(refs, 1) > 0 then
      select m.thread_id into thread from classroom.mail_messages m
       where m.mailbox_id = box and m.message_id = any (refs) order by m.created_at desc limit 1;
    end if;
    if thread is null and bare <> '' then
      select m.thread_id into thread from classroom.mail_messages m
       where m.mailbox_id = box and m.folder <> 'drafts' and m.created_at > now() - interval '60 days'
         and lower(btrim(regexp_replace(m.subject, '^((re|fw|fwd|aw|wg)\s*(\[\d+\])?\s*:\s*)+', '', 'i'))) = bare
         and (lower(m.from_address) = sender
              or exists (select 1 from jsonb_array_elements(m.to_list || m.cc_list || m.bcc_list) a where lower(a ->> 'address') = sender))
       order by m.created_at desc limit 1;
    end if;

    insert into classroom.mail_messages (mailbox_id, envelope_id, thread_id, message_id, in_reply_to, folder,
        from_address, from_name, to_list, cc_list, reply_to, subject, body_html, snippet, importance,
        has_attachments, size_bytes, is_read, sent_at, inbound_id)
    values (box, envelope_in, coalesce(thread, gen_random_uuid()),
        coalesce(nullif(msg ->> 'message_id', ''), '<' || inbound_id_in || '@inbound.schoolivio.com>'),
        nullif(msg ->> 'in_reply_to', ''),
        case when (msg ->> 'junk')::boolean then 'junk' else 'inbox' end,
        sender, coalesce(msg ->> 'from_name', ''),
        coalesce(msg -> 'to_list', '[]'::jsonb), coalesce(msg -> 'cc_list', '[]'::jsonb), coalesce(msg -> 'reply_to', '[]'::jsonb),
        subj, coalesce(msg ->> 'html', ''), classroom.mail_snippet(coalesce(msg ->> 'html', '')),
        coalesce(nullif(msg ->> 'importance', ''), 'normal'),
        has_files, coalesce((msg ->> 'size')::bigint, 0), false,
        coalesce((msg ->> 'sent_at')::timestamptz, now()), inbound_id_in)
    on conflict (mailbox_id, inbound_id) where inbound_id is not null do nothing
    returning id into inserted;
    if inserted is not null then n := n + 1; end if;
  end loop;

  -- The files, once per envelope (whoever holds a copy can open them).
  if n > 0 and has_files and not exists (select 1 from classroom.mail_attachments where envelope_id = envelope_in) then
    for f in select value from jsonb_array_elements(files) loop
      insert into classroom.mail_attachments (envelope_id, mailbox_id, file_path, file_name, mime_type, size_bytes, content_id)
      values (envelope_in, mailbox_ids[1], f ->> 'file_path', coalesce(nullif(f ->> 'file_name', ''), 'attachment'),
              coalesce(nullif(f ->> 'mime_type', ''), 'application/octet-stream'), least(coalesce((f ->> 'size_bytes')::bigint, 0), 26214400),
              nullif(f ->> 'content_id', ''))
      on conflict (file_path) do nothing;
    end loop;
  end if;
  return n;
end;
$fn$;
revoke all on function classroom.mail_receive(uuid, text, uuid, uuid[], jsonb, jsonb) from public, anon, authenticated;
grant execute on function classroom.mail_receive(uuid, text, uuid, uuid[], jsonb, jsonb) to service_role;

notify pgrst, 'reload schema';
