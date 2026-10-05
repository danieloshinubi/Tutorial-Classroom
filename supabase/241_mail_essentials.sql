-- Schoolivio Mail, step 5: the Outlook essentials, and knowing the moment
-- your mail is opened.
--
--   Opened        "Tell me when it's opened" (on by default, per message): the
--                 first time each recipient opens it the sender gets a
--                 notification at once (live on screen, the bell, and a push to
--                 their phone). Inside Schoolivio this is exact; outside it is a
--                 tiny picture in the message (mail-open), which works when the
--                 recipient's mail app shows pictures.
--   Receipts      per recipient on the sender's copy: delivered, read (inside),
--                 or the outside delivery report; "Request a read receipt" also
--                 sends a "Read:" note, Outlook style.
--   Recall        unread copies inside Schoolivio are removed and outside copies
--                 not yet sent are stopped; a report says what happened. Mail
--                 already delivered outside cannot be recalled, and the report
--                 says so plainly.
--   Schedule      a draft goes at a chosen time (the scheduler, every minute).
--   Undo send     in the browser: the draft waits a few seconds before mail_send.
--   Groups        "All staff" and each role (school groups everyone can use),
--                 and personal groups in the contacts book.
--   Contacts      each person's own address book.
--   Auto replies  out of office, with optional dates, to people inside and
--                 (optionally) outside; once per sender every 4 days, never to
--                 automatic mail.

-- 1. Settings on the mailbox -------------------------------------------------------------
alter table classroom.mail_mailboxes
  add column if not exists undo_seconds int not null default 10 check (undo_seconds in (0, 5, 10, 20, 30)),
  add column if not exists notify_opens boolean not null default true,
  add column if not exists autoreply_enabled boolean not null default false,
  add column if not exists autoreply_start timestamptz,
  add column if not exists autoreply_end timestamptz,
  add column if not exists autoreply_html text not null default '',
  add column if not exists autoreply_outside boolean not null default true;
grant update (undo_seconds, notify_opens, autoreply_enabled, autoreply_start, autoreply_end, autoreply_html, autoreply_outside)
  on classroom.mail_mailboxes to authenticated;

-- 2. On each message ----------------------------------------------------------------------
alter table classroom.mail_messages
  add column if not exists scheduled_at timestamptz,         -- a draft waiting to go
  add column if not exists track_opens boolean not null default false,
  add column if not exists read_receipt boolean not null default false,
  add column if not exists recalled_at timestamptz,
  add column if not exists is_auto boolean not null default false;   -- an automatic reply or notice
create index if not exists mail_messages_scheduled_idx on classroom.mail_messages (scheduled_at) where scheduled_at is not null and folder = 'drafts';
grant update (scheduled_at, track_opens, read_receipt) on classroom.mail_messages to authenticated;

-- 3. Who opened what ---------------------------------------------------------------------
create table if not exists classroom.mail_opens (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references classroom.mail_messages (id) on delete cascade,  -- the sender's copy
  recipient text not null,
  via text not null check (via in ('inside', 'picture')),
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  times int not null default 1,
  unique (message_id, recipient)
);
alter table classroom.mail_opens enable row level security;
drop policy if exists "senders see opens" on classroom.mail_opens;
create policy "senders see opens" on classroom.mail_opens for select to authenticated
  using (exists (select 1 from classroom.mail_messages m where m.id = mail_opens.message_id and classroom.owns_mailbox(m.mailbox_id)));
grant select on classroom.mail_opens to authenticated;

-- The tiny picture's key, one per outside email.
alter table classroom.mail_outbound add column if not exists open_token uuid;
create index if not exists mail_outbound_open_token_idx on classroom.mail_outbound (open_token) where open_token is not null;

-- Records an open, and on the first one tells the sender straight away.
create or replace function classroom.mail_record_open(sender_copy uuid, recipient_in text, via_in text)
returns boolean language plpgsql security definer set search_path = classroom, public as $fn$
declare
  m classroom.mail_messages;
  box classroom.mail_mailboxes;
  first boolean;
  open_id uuid;
  who text := btrim(recipient_in);
begin
  select * into m from classroom.mail_messages where id = sender_copy;
  if not found or not m.track_opens then return false; end if;
  select * into box from classroom.mail_mailboxes where id = m.mailbox_id;
  insert into classroom.mail_opens (message_id, recipient, via) values (m.id, who, via_in)
  on conflict (message_id, recipient) do update set last_at = now(), times = classroom.mail_opens.times + 1
  returning id, (xmax = 0) into open_id, first;
  if first then
    insert into classroom.notifications (user_id, school_id, kind, title, body, link, ref_id)
    values (box.user_id, box.school_id, 'mail_opened',
            who || ' opened your email',
            coalesce(nullif(m.subject, ''), '(no subject)'),
            -- One per recipient's open (notifications are once per kind and ref).
            '/Mail?thread=' || m.thread_id || '&folder=sent', open_id);
  end if;
  return first;
end;
$fn$;
revoke all on function classroom.mail_record_open(uuid, text, text) from public, anon, authenticated;

-- Opened inside Schoolivio: a recipient's copy turns read for the first time.
create or replace function classroom.mail_opened_inside()
returns trigger language plpgsql security definer set search_path = classroom, public as $fn$
declare
  src classroom.mail_messages;
  reader classroom.mail_mailboxes;
  who text;
begin
  if new.is_read and not old.is_read and new.folder not in ('sent', 'outbox', 'drafts') and not new.is_auto then
    select * into src from classroom.mail_messages
     where envelope_id = new.envelope_id and folder in ('sent', 'outbox') and mailbox_id <> new.mailbox_id limit 1;
    if found then
      select * into reader from classroom.mail_mailboxes where id = new.mailbox_id;
      who := coalesce(nullif(reader.display_name, ''), reader.address);
      if src.track_opens then perform classroom.mail_record_open(src.id, who, 'inside'); end if;
      -- "Request a read receipt": the Outlook-style note, once per reader.
      if src.read_receipt and not exists (select 1 from classroom.mail_messages r where r.mailbox_id = src.mailbox_id and r.is_auto
                                            and r.in_reply_to = src.message_id and r.from_address = reader.address
                                            and r.subject like 'Read: %') then
        insert into classroom.mail_messages (mailbox_id, thread_id, in_reply_to, folder, from_address, from_name, to_list, subject,
            body_html, snippet, is_read, sent_at, is_auto)
        values (src.mailbox_id, src.thread_id, src.message_id, 'inbox', reader.address, reader.display_name,
            jsonb_build_array(jsonb_build_object('name', '', 'address', (select address from classroom.mail_mailboxes where id = src.mailbox_id))),
            'Read: ' || src.subject,
            '<p>Your message</p><p>To: ' || replace(replace(who, '<', '&lt;'), '>', '&gt;') || '<br>Subject: '
              || replace(replace(src.subject, '<', '&lt;'), '>', '&gt;') || '</p><p>was read on '
              || to_char(now() at time zone 'Africa/Lagos', 'FMDay DD FMMonth YYYY "at" HH24:MI') || '.</p>',
            'Your message was read.', false, now(), true);
      end if;
    end if;
  end if;
  return null;
end;
$fn$;
drop trigger if exists mail_opened_inside on classroom.mail_messages;
create trigger mail_opened_inside after update of is_read on classroom.mail_messages
  for each row execute function classroom.mail_opened_inside();

-- Opened outside: mail-open was asked for the picture. A fetch within 20
-- seconds of sending is a mail server checking the message, not a person.
create or replace function classroom.mail_open_picture(token_in uuid)
returns boolean language plpgsql security definer set search_path = classroom, public as $fn$
declare
  o classroom.mail_outbound;
  who text;
begin
  select * into o from classroom.mail_outbound where open_token = token_in limit 1;
  if not found or (o.sent_at is not null and o.sent_at > now() - interval '20 seconds') then return false; end if;
  -- One email can carry several outside recipients: then it is one of them.
  select case when count(*) = 1 then max(recipient) else 'One of ' || string_agg(recipient, ', ' order by recipient) end
    into who from classroom.mail_outbound where open_token = token_in;
  return classroom.mail_record_open(o.message_id, who, 'picture');
end;
$fn$;
revoke all on function classroom.mail_open_picture(uuid) from public, anon, authenticated;
grant execute on function classroom.mail_open_picture(uuid) to service_role;

-- Everything about one sent message, per recipient, for its sender.
create or replace function classroom.mail_message_status(target_message uuid)
returns jsonb language plpgsql stable security definer set search_path = classroom, public as $fn$
declare m classroom.mail_messages;
begin
  select * into m from classroom.mail_messages where id = target_message;
  if not found or not classroom.owns_mailbox(m.mailbox_id) then raise exception 'That message is not yours.'; end if;
  return jsonb_build_object(
    'track_opens', m.track_opens, 'read_receipt', m.read_receipt, 'recalled_at', m.recalled_at,
    'inside', coalesce((select jsonb_agg(jsonb_build_object('name', b.display_name, 'address', b.address, 'delivered_at', c.created_at,
                          'read', c.is_read and (m.track_opens or m.read_receipt)) order by b.display_name)
                        from classroom.mail_messages c join classroom.mail_mailboxes b on b.id = c.mailbox_id
                       where c.envelope_id = m.envelope_id and c.mailbox_id <> m.mailbox_id and c.folder <> 'drafts'), '[]'::jsonb),
    'opens', coalesce((select jsonb_agg(jsonb_build_object('recipient', recipient, 'via', via, 'first_at', first_at, 'last_at', last_at, 'times', times) order by first_at)
                       from classroom.mail_opens where message_id = m.id), '[]'::jsonb));
end;
$fn$;
revoke all on function classroom.mail_message_status(uuid) from public, anon;
grant execute on function classroom.mail_message_status(uuid) to authenticated;

-- 4. Recall ---------------------------------------------------------------------------------
create or replace function classroom.mail_recall(target_message uuid)
returns jsonb language plpgsql security definer set search_path = classroom, public as $fn$
declare
  m classroom.mail_messages;
  c record;
  removed text[] := '{}';
  already text[] := '{}';
  stopped text[] := '{}';
  gone text[] := '{}';
begin
  select * into m from classroom.mail_messages where id = target_message for update;
  if not found or not classroom.owns_mailbox(m.mailbox_id) then raise exception 'That message is not yours.'; end if;
  if m.folder not in ('sent', 'outbox') and m.sent_at is null then raise exception 'Only a sent message can be recalled.'; end if;
  if m.recalled_at is not null then raise exception 'This message has already been recalled.'; end if;

  for c in select x.id, x.is_read, b.display_name, b.address from classroom.mail_messages x join classroom.mail_mailboxes b on b.id = x.mailbox_id
            where x.envelope_id = m.envelope_id and x.mailbox_id <> m.mailbox_id and x.folder <> 'drafts' loop
    if c.is_read then
      already := already || coalesce(nullif(c.display_name, ''), c.address);
    else
      delete from classroom.mail_messages where id = c.id;
      removed := removed || coalesce(nullif(c.display_name, ''), c.address);
    end if;
  end loop;
  -- Outside copies still waiting are stopped; those already handed over have gone.
  update classroom.mail_outbound set status = 'failed', detail = 'Recalled before it went out.', updated_at = now()
   where message_id = m.id and status in ('pending', 'sending');
  select coalesce(array_agg(recipient), '{}') into stopped from classroom.mail_outbound where message_id = m.id and detail = 'Recalled before it went out.';
  select coalesce(array_agg(recipient), '{}') into gone from classroom.mail_outbound where message_id = m.id and status not in ('failed');
  update classroom.mail_messages set recalled_at = now() where id = m.id;
  perform classroom.mail_outbound_settle(m.id);

  perform classroom.mail_notice(m.mailbox_id, 'Recall report: ' || m.subject,
    '<p>Recall of <strong>' || replace(replace(m.subject, '<', '&lt;'), '>', '&gt;') || '</strong>:</p><ul>'
    || case when cardinality(removed) > 0 then '<li>Removed before it was read: ' || array_to_string(removed, ', ') || '</li>' else '' end
    || case when cardinality(stopped) > 0 then '<li>Stopped before it went out: ' || array_to_string(stopped, ', ') || '</li>' else '' end
    || case when cardinality(already) > 0 then '<li>Already read, so it stays with: ' || array_to_string(already, ', ') || '</li>' else '' end
    || case when cardinality(gone) > 0 then '<li>Already delivered outside Schoolivio, which cannot be recalled: ' || array_to_string(gone, ', ') || '</li>' else '' end
    || '</ul>');
  return jsonb_build_object('removed', to_jsonb(removed), 'stopped', to_jsonb(stopped), 'already_read', to_jsonb(already), 'outside', to_jsonb(gone));
end;
$fn$;
revoke all on function classroom.mail_recall(uuid) from public, anon;
grant execute on function classroom.mail_recall(uuid) to authenticated;

-- 5. Contacts and groups ------------------------------------------------------------------------
create table if not exists classroom.mail_contacts (
  id uuid primary key default gen_random_uuid(),
  mailbox_id uuid not null references classroom.mail_mailboxes (id) on delete cascade,
  name text not null default '',
  address text not null check (address = lower(address) and address ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone text not null default '',
  company text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (mailbox_id, address)
);
create table if not exists classroom.mail_contact_groups (
  id uuid primary key default gen_random_uuid(),
  mailbox_id uuid not null references classroom.mail_mailboxes (id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  members jsonb not null default '[]'::jsonb,          -- [{ "name": "", "address": "" }]
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table classroom.mail_contacts enable row level security;
alter table classroom.mail_contact_groups enable row level security;
drop policy if exists "own contacts" on classroom.mail_contacts;
create policy "own contacts" on classroom.mail_contacts for all to authenticated
  using (classroom.owns_mailbox(mailbox_id)) with check (classroom.owns_mailbox(mailbox_id));
drop policy if exists "own contact groups" on classroom.mail_contact_groups;
create policy "own contact groups" on classroom.mail_contact_groups for all to authenticated
  using (classroom.owns_mailbox(mailbox_id)) with check (classroom.owns_mailbox(mailbox_id));
grant select, insert, update, delete on classroom.mail_contacts, classroom.mail_contact_groups to authenticated;

-- The groups to offer while typing: the school's (all staff, each role) and
-- the person's own. A group is written group:all, group:role:<role> or
-- group:mine:<id>, and opened up into its people when the mail is sent.
create or replace function classroom.mail_groups(target_school uuid)
returns table (address text, name text, members int, kind text)
language sql stable security definer set search_path = classroom, public as $fn$
  with staff as (
    select distinct on (b.id) b.id, m.role::text as role
      from classroom.mail_mailboxes b
      join classroom.school_members m on m.school_id = b.school_id and m.user_id = b.user_id and m.is_active
     where b.school_id = target_school and b.is_active
  )
  select 'group:all', 'All staff', (select count(*)::int from staff), 'school'
   where exists (select 1 from classroom.school_members me where me.school_id = target_school and me.user_id = (select auth.uid()) and me.is_active)
  union all
  select 'group:role:' || role, initcap(replace(role, '_', ' ')) || 's (all)', count(*)::int, 'school'
    from staff
   where exists (select 1 from classroom.school_members me where me.school_id = target_school and me.user_id = (select auth.uid()) and me.is_active)
   group by role
  union all
  select 'group:mine:' || g.id, g.name, jsonb_array_length(g.members), 'mine'
    from classroom.mail_contact_groups g join classroom.mail_mailboxes b on b.id = g.mailbox_id
   where b.school_id = target_school and b.user_id = (select auth.uid());
$fn$;
grant execute on function classroom.mail_groups(uuid) to authenticated;

-- The people a group stands for, as the sender sees it.
create or replace function classroom.mail_group_members(sender_box uuid, token text)
returns table (name text, address text)
language sql stable security definer set search_path = classroom, public as $fn$
  select b.display_name, b.address from classroom.mail_mailboxes b
   where token = 'group:all' and b.school_id = (select school_id from classroom.mail_mailboxes where id = sender_box) and b.is_active and b.id <> sender_box
  union
  select b.display_name, b.address from classroom.mail_mailboxes b
    join classroom.school_members m on m.school_id = b.school_id and m.user_id = b.user_id and m.is_active
   where token like 'group:role:%' and m.role::text = substr(token, 12)
     and b.school_id = (select school_id from classroom.mail_mailboxes where id = sender_box) and b.is_active and b.id <> sender_box
  union
  select coalesce(x ->> 'name', ''), lower(x ->> 'address')
    from classroom.mail_contact_groups g, jsonb_array_elements(g.members) x
   where token like 'group:mine:%' and g.id = classroom.try_uuid(substr(token, 12)) and g.mailbox_id = sender_box;
$fn$;
revoke all on function classroom.mail_group_members(uuid, text) from public, anon, authenticated;

-- 6. Automatic replies ----------------------------------------------------------------------------
create table if not exists classroom.mail_autoreply_log (
  mailbox_id uuid not null references classroom.mail_mailboxes (id) on delete cascade,
  sender text not null,
  sent_at timestamptz not null default now(),
  primary key (mailbox_id, sender)
);
alter table classroom.mail_autoreply_log enable row level security;

-- After mail lands in a mailbox: its out-of-office reply, if it is on and due.
create or replace function classroom.mail_autoreply(target_box uuid, sender_in text, sender_name_in text, subject_in text,
                                                    in_reply_to_in text, thread_in uuid, outside boolean)
returns void language plpgsql security definer set search_path = classroom, public as $fn$
declare
  box classroom.mail_mailboxes;
  who text := lower(btrim(coalesce(sender_in, '')));
  rcpt classroom.mail_mailboxes;
  reply uuid;
  sending_on boolean;
begin
  select * into box from classroom.mail_mailboxes where id = target_box;
  if not found or not box.autoreply_enabled or btrim(box.autoreply_html) = '' then return; end if;
  if box.autoreply_start is not null and now() < box.autoreply_start then return; end if;
  if box.autoreply_end is not null and now() > box.autoreply_end then return; end if;
  if who = '' or who = box.address or who ~ '^(no-?reply|mailer-daemon|postmaster|bounce|notifications?)[@+._-]' then return; end if;
  if outside and not box.autoreply_outside then return; end if;
  -- Once per sender every 4 days.
  if exists (select 1 from classroom.mail_autoreply_log where mailbox_id = box.id and sender = who and sent_at > now() - interval '4 days') then return; end if;
  insert into classroom.mail_autoreply_log (mailbox_id, sender, sent_at) values (box.id, who, now())
  on conflict (mailbox_id, sender) do update set sent_at = now();

  select * into rcpt from classroom.mail_mailboxes where (address = who or who = any (previous_addresses)) and is_active limit 1;
  if found then
    insert into classroom.mail_messages (mailbox_id, thread_id, in_reply_to, folder, from_address, from_name, to_list, subject,
        body_html, snippet, is_read, sent_at, is_auto)
    values (rcpt.id, coalesce(thread_in, gen_random_uuid()), in_reply_to_in, 'inbox', box.address, box.display_name,
        jsonb_build_array(jsonb_build_object('name', coalesce(sender_name_in, ''), 'address', who)),
        'Automatic reply: ' || coalesce(subject_in, ''), box.autoreply_html, classroom.mail_snippet(box.autoreply_html), false, now(), true);
  elsif outside then
    select coalesce(s.sending_enabled, false) into sending_on from classroom.mail_settings s where s.school_id = box.school_id;
    if not coalesce(sending_on, false) then return; end if;
    insert into classroom.mail_messages (mailbox_id, thread_id, in_reply_to, folder, from_address, from_name, to_list, subject,
        body_html, snippet, is_read, sent_at, is_auto, external_pending)
    values (box.id, coalesce(thread_in, gen_random_uuid()), in_reply_to_in, 'outbox', box.address, box.display_name,
        jsonb_build_array(jsonb_build_object('name', coalesce(sender_name_in, ''), 'address', who)),
        'Automatic reply: ' || coalesce(subject_in, ''), box.autoreply_html, classroom.mail_snippet(box.autoreply_html), true, now(), true, 1)
    returning id into reply;
    insert into classroom.mail_outbound (message_id, recipient, kind) values (reply, who, 'to');
    perform classroom.mail_kick(reply);
  end if;
end;
$fn$;
revoke all on function classroom.mail_autoreply(uuid, text, text, text, text, uuid, boolean) from public, anon, authenticated;

-- 7. Sending, as anyone the system acts for (a scheduled draft has no one
-- signed in): groups opened up, tracking and receipts kept, out-of-office
-- replies for whoever is away. mail_send is the signed-in person's door.
create or replace function classroom.mail_send_as(target_draft uuid, actor uuid)
returns jsonb language plpgsql security definer set search_path = classroom, public as $fn$
declare
  d classroom.mail_messages;
  box classroom.mail_mailboxes;
  r record;
  addr text;
  rcpt classroom.mail_mailboxes;
  internal_count int := 0;
  external_count int := 0;
  unknown text[] := '{}';
  attach_size bigint;
  total_size bigint;
  seen text[] := '{}';
  parent_thread uuid;
  sending_on boolean;
  wanted jsonb := '[]'::jsonb;
  g record;
  n_people int;
begin
  select * into d from classroom.mail_messages where id = target_draft for update;
  if not found then raise exception 'That draft no longer exists.'; end if;
  select * into box from classroom.mail_mailboxes where id = d.mailbox_id;
  if box.user_id <> actor then raise exception 'That is not your draft.'; end if;
  if d.folder <> 'drafts' then raise exception 'That message has already been sent.'; end if;
  if not box.is_active then raise exception 'Your mailbox is switched off.'; end if;

  -- Personal groups become their people (recipients cannot open someone
  -- else's group); school groups stay as their name and are opened below.
  select coalesce(jsonb_agg(e order by o), '[]'::jsonb) into d.to_list from (
    select x as e, o from jsonb_array_elements(d.to_list) with ordinality t(x, o) where x ->> 'address' not like 'group:mine:%'
    union all select jsonb_build_object('name', gm.name, 'address', gm.address), 100000 + o
      from jsonb_array_elements(d.to_list) with ordinality t(x, o), classroom.mail_group_members(box.id, x ->> 'address') gm
     where x ->> 'address' like 'group:mine:%') q;
  select coalesce(jsonb_agg(e order by o), '[]'::jsonb) into d.cc_list from (
    select x as e, o from jsonb_array_elements(d.cc_list) with ordinality t(x, o) where x ->> 'address' not like 'group:mine:%'
    union all select jsonb_build_object('name', gm.name, 'address', gm.address), 100000 + o
      from jsonb_array_elements(d.cc_list) with ordinality t(x, o), classroom.mail_group_members(box.id, x ->> 'address') gm
     where x ->> 'address' like 'group:mine:%') q;
  select coalesce(jsonb_agg(e order by o), '[]'::jsonb) into d.bcc_list from (
    select x as e, o from jsonb_array_elements(d.bcc_list) with ordinality t(x, o) where x ->> 'address' not like 'group:mine:%'
    union all select jsonb_build_object('name', gm.name, 'address', gm.address), 100000 + o
      from jsonb_array_elements(d.bcc_list) with ordinality t(x, o), classroom.mail_group_members(box.id, x ->> 'address') gm
     where x ->> 'address' like 'group:mine:%') q;

  -- Everyone it goes to, school groups opened up, To before Cc before Bcc.
  for r in
    select x.value, x.kind from (
      select value, 'to' as kind, 1 as part, ord from jsonb_array_elements(d.to_list) with ordinality as t(value, ord)
      union all select value, 'cc', 2, ord from jsonb_array_elements(d.cc_list) with ordinality as t(value, ord)
      union all select value, 'bcc', 3, ord from jsonb_array_elements(d.bcc_list) with ordinality as t(value, ord)) x
    order by x.part, x.ord
  loop
    if r.value ->> 'address' like 'group:%' then
      n_people := 0;
      for g in select * from classroom.mail_group_members(box.id, r.value ->> 'address') loop
        wanted := wanted || jsonb_build_object('address', g.address, 'kind', r.kind);
        n_people := n_people + 1;
      end loop;
      if n_people = 0 then raise exception 'The group % has nobody in it.', coalesce(r.value ->> 'name', r.value ->> 'address'); end if;
    else
      wanted := wanted || jsonb_build_object('address', r.value ->> 'address', 'kind', r.kind);
    end if;
  end loop;

  if jsonb_array_length(wanted) = 0 then raise exception 'Add at least one recipient.'; end if;
  if jsonb_array_length(wanted) > 1000 then raise exception 'A message can go to at most 1,000 people.'; end if;

  select coalesce(sum(size_bytes), 0) into attach_size from classroom.mail_attachments where envelope_id = d.envelope_id;
  total_size := octet_length(d.body_html) + octet_length(d.subject) + attach_size;

  if d.in_reply_to is not null then
    select thread_id into parent_thread from classroom.mail_messages where mailbox_id = box.id and message_id = d.in_reply_to limit 1;
    if parent_thread is not null then d.thread_id := parent_thread; end if;
  end if;

  for r in select value from jsonb_array_elements(wanted) loop
    addr := lower(btrim(r.value ->> 'address'));
    if addr !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then unknown := unknown || coalesce(r.value ->> 'address', '(blank)'); end if;
  end loop;
  if array_length(unknown, 1) > 0 then
    raise exception 'These addresses are not valid: %', array_to_string(unknown, ', ');
  end if;

  update classroom.mail_messages
     set folder = 'sent', sent_at = now(), is_read = true, from_address = box.address, from_name = box.display_name,
         snippet = classroom.mail_snippet(body_html), size_bytes = total_size, thread_id = d.thread_id,
         has_attachments = attach_size > 0, scheduled_at = null,
         to_list = d.to_list, cc_list = d.cc_list, bcc_list = d.bcc_list
   where id = d.id;

  for r in select value from jsonb_array_elements(wanted) loop
    addr := lower(btrim(r.value ->> 'address'));
    continue when addr = any (seen);
    seen := seen || addr;
    select * into rcpt from classroom.mail_mailboxes where (address = addr or addr = any (previous_addresses)) and is_active limit 1;
    if found then
      if rcpt.used_bytes + total_size > rcpt.quota_bytes then
        unknown := unknown || addr;
        continue;
      end if;
      insert into classroom.mail_messages (mailbox_id, envelope_id, thread_id, message_id, in_reply_to, folder,
          from_address, from_name, to_list, cc_list, bcc_list, subject, body_html, snippet, importance,
          has_attachments, size_bytes, is_read, sent_at, is_auto)
      values (rcpt.id, d.envelope_id, d.thread_id, d.message_id, d.in_reply_to, 'inbox',
          box.address, box.display_name, d.to_list, d.cc_list, '[]'::jsonb, d.subject, d.body_html,
          classroom.mail_snippet(d.body_html), d.importance, attach_size > 0, total_size,
          rcpt.id = box.id, now(), d.is_auto);
      internal_count := internal_count + 1;
      if not d.is_auto and rcpt.id <> box.id then
        perform classroom.mail_autoreply(rcpt.id, box.address, box.display_name, d.subject, d.message_id, null, false);
      end if;
    else
      insert into classroom.mail_outbound (message_id, recipient, kind, open_token)
      values (d.id, addr, r.value ->> 'kind', case when d.track_opens then gen_random_uuid() end);
      external_count := external_count + 1;
    end if;
  end loop;

  select coalesce(s.sending_enabled, false) into sending_on from classroom.mail_settings s where s.school_id = box.school_id;
  sending_on := coalesce(sending_on, false);
  if external_count > 0 then
    update classroom.mail_messages set folder = 'outbox', external_pending = external_count where id = d.id;
    if sending_on then perform classroom.mail_kick(d.id); end if;
  end if;

  if array_length(unknown, 1) > 0 then
    perform classroom.mail_notice(box.id, 'Not delivered: ' || d.subject,
      '<p>Your message <strong>' || replace(replace(d.subject, '<', '&lt;'), '>', '&gt;') || '</strong> could not be delivered to: '
        || array_to_string(unknown, ', ') || '. Their mailbox is full.</p>');
  end if;

  return jsonb_build_object('delivered', internal_count, 'waiting', external_count, 'sending_on', sending_on,
                            'refused', coalesce(array_length(unknown, 1), 0), 'thread_id', d.thread_id);
end;
$fn$;
revoke all on function classroom.mail_send_as(uuid, uuid) from public, anon, authenticated;

create or replace function classroom.mail_send(target_draft uuid)
returns jsonb language sql security definer set search_path = classroom, public as $fn$
  select classroom.mail_send_as(target_draft, (select auth.uid()));
$fn$;
revoke all on function classroom.mail_send(uuid) from public, anon;
grant execute on function classroom.mail_send(uuid) to authenticated;

-- 8. Scheduled sending ------------------------------------------------------------------------------
create or replace function classroom.mail_schedule(target_draft uuid, at_in timestamptz)
returns void language plpgsql security definer set search_path = classroom, public as $fn$
declare d classroom.mail_messages;
begin
  select * into d from classroom.mail_messages where id = target_draft;
  if not found or not classroom.owns_mailbox(d.mailbox_id) or d.folder <> 'drafts' then raise exception 'That draft is not yours.'; end if;
  if at_in is not null and at_in < now() + interval '1 minute' then raise exception 'Pick a time at least a minute from now.'; end if;
  if at_in is not null and at_in > now() + interval '1 year' then raise exception 'Pick a time within the next year.'; end if;
  update classroom.mail_messages set scheduled_at = at_in where id = d.id;
end;
$fn$;
revoke all on function classroom.mail_schedule(uuid, timestamptz) from public, anon;
grant execute on function classroom.mail_schedule(uuid, timestamptz) to authenticated;

-- The scheduler's turn: every draft that is due goes, as its owner. One that
-- cannot go (an address no longer valid) is left in Drafts with a note.
create or replace function classroom.mail_send_due()
returns int language plpgsql security definer set search_path = classroom, public as $fn$
declare
  r record;
  n int := 0;
begin
  for r in select m.id, m.subject, m.mailbox_id, b.user_id from classroom.mail_messages m join classroom.mail_mailboxes b on b.id = m.mailbox_id
            where m.folder = 'drafts' and m.scheduled_at is not null and m.scheduled_at <= now() order by m.scheduled_at limit 200 loop
    begin
      perform classroom.mail_send_as(r.id, r.user_id);
      n := n + 1;
    exception when others then
      update classroom.mail_messages set scheduled_at = null where id = r.id;
      perform classroom.mail_notice(r.mailbox_id, 'Not sent: ' || r.subject,
        '<p>Your scheduled message <strong>' || replace(replace(r.subject, '<', '&lt;'), '>', '&gt;')
          || '</strong> could not be sent: ' || replace(replace(sqlerrm, '<', '&lt;'), '>', '&gt;') || '. It is in your Drafts.</p>');
    end;
  end loop;
  return n;
end;
$fn$;
revoke all on function classroom.mail_send_due() from public, anon, authenticated;

select cron.unschedule('schoolivio-mail-scheduled') where exists (select 1 from cron.job where jobname = 'schoolivio-mail-scheduled');
select cron.schedule('schoolivio-mail-scheduled', '* * * * *',
  $job$ select classroom.mail_send_due() where exists (select 1 from classroom.mail_messages where folder = 'drafts' and scheduled_at <= now()); $job$);

-- 9. Received outside mail also gets the out-of-office reply (mail_receive, 238).
do $do$
declare d text;
begin
  d := pg_get_functiondef('classroom.mail_receive(uuid,text,uuid,uuid[],jsonb,jsonb)'::regprocedure);
  if position('mail_autoreply' in d) = 0 then
    d := replace(d, '    if inserted is not null then n := n + 1; end if;',
'    if inserted is not null then
      n := n + 1;
      if not coalesce((msg ->> ''junk'')::boolean, false) then
        perform classroom.mail_autoreply(box, sender, msg ->> ''from_name'', subj, nullif(msg ->> ''message_id'', ''''),
          (select thread_id from classroom.mail_messages where id = inserted), true);
      end if;
    end if;');
    execute d;
  end if;
end
$do$;

-- 10. What mail-outbound needs to know about each sending (claim, 236/237).
do $do$
declare d text;
begin
  d := pg_get_functiondef('classroom.mail_outbound_claim(integer,uuid)'::regprocedure);
  if position('open_token' in d) = 0 then
    d := replace(d, '''recipients'', (select jsonb_agg(jsonb_build_object(''id'', t.id, ''address'', t.recipient, ''kind'', t.kind)) from taken t where t.message_id = m.id),',
      '''is_auto'', m.is_auto, ''read_receipt'', m.read_receipt,
           ''recipients'', (select jsonb_agg(jsonb_build_object(''id'', t.id, ''address'', t.recipient, ''kind'', t.kind,
               ''open_token'', (select o.open_token from classroom.mail_outbound o where o.id = t.id))) from taken t where t.message_id = m.id),');
    execute d;
  end if;
end
$do$;

notify pgrst, 'reload schema';
