-- Schoolivio Mail, step 7: safety and polish.
--
--   Junk          outside mail is scored as it arrives: failed sender checks
--                 (SPF / DKIM / DMARC), phishing wording, an outsider using a
--                 staff member's name, a reply-to elsewhere, links to bare IP
--                 addresses. Five points or more goes to Junk; a warning shows
--                 on the message whatever its score.
--   Senders       each mailbox's safe and blocked senders (an address or a
--                 whole @domain); the school's own blocked list for everyone.
--   Phishing      "Report phishing": the sender is blocked, the message goes to
--                 Junk, unread copies of it in every mailbox at the school go
--                 to Junk too, and the school admins are told.
--   Limits        outside recipients per mailbox per hour and per day (the
--                 school sets them), so a hacked account cannot spam; reaching
--                 one tells the admins.
--   Push          new mail in your Inbox pushed to your phone (your choice).
--   Retention     Deleted and Junk empty themselves after the school's number
--                 of days; files nothing refers to any more are cleared away.
--   Audit         the admin's mail changes (addresses, storage, suspensions,
--                 shared mailboxes and their members, group addresses, the
--                 domain, limits) go to the audit log. Never message contents,
--                 keys or secrets.

-- 1. Safe and blocked senders --------------------------------------------------------------
create table if not exists classroom.mail_sender_lists (
  mailbox_id uuid not null references classroom.mail_mailboxes (id) on delete cascade,
  value text not null check (value = lower(value) and (value ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or value ~ '^@[^@\s]+\.[^@\s]+$')),
  kind text not null check (kind in ('safe', 'blocked')),
  created_at timestamptz not null default now(),
  primary key (mailbox_id, value)
);
alter table classroom.mail_sender_lists enable row level security;
drop policy if exists "own sender lists" on classroom.mail_sender_lists;
create policy "own sender lists" on classroom.mail_sender_lists for all to authenticated
  using (classroom.mail_access(mailbox_id, (select auth.uid())) in ('own', 'full'))
  with check (classroom.mail_access(mailbox_id, (select auth.uid())) in ('own', 'full'));
grant select, insert, update, delete on classroom.mail_sender_lists to authenticated;

alter table classroom.mail_settings
  add column if not exists blocked_senders text[] not null default '{}',
  add column if not exists max_outside_hour int not null default 200 check (max_outside_hour between 1 and 5000),
  add column if not exists max_outside_day int not null default 1000 check (max_outside_day between 1 and 50000),
  add column if not exists deleted_days int not null default 30 check (deleted_days between 0 and 3650),
  add column if not exists junk_days int not null default 30 check (junk_days between 0 and 3650);

-- How a sender stands with a mailbox: safe, blocked (by them or the school), or neither.
create or replace function classroom.mail_sender_standing(target_box uuid, sender text)
returns text language sql stable security definer set search_path = classroom, public as $fn$
  select coalesce(
    (select l.kind from classroom.mail_sender_lists l
      where l.mailbox_id = target_box and (l.value = lower(sender) or l.value = '@' || split_part(lower(sender), '@', 2))
      order by (l.kind = 'blocked') desc limit 1),
    (select 'blocked' from classroom.mail_settings s join classroom.mail_mailboxes b on b.school_id = s.school_id
      where b.id = target_box and (lower(sender) = any (s.blocked_senders) or '@' || split_part(lower(sender), '@', 2) = any (s.blocked_senders))),
    '');
$fn$;
revoke all on function classroom.mail_sender_standing(uuid, text) from public, anon;
grant execute on function classroom.mail_sender_standing(uuid, text) to authenticated, service_role;

create or replace function classroom.mail_mark_sender(target_box uuid, sender text, kind_in text)
returns void language plpgsql security definer set search_path = classroom, public as $fn$
declare v text := lower(btrim(sender));
begin
  if coalesce(classroom.mail_access(target_box, (select auth.uid())), 'read') not in ('own', 'full') then raise exception 'That mailbox is not yours.'; end if;
  if kind_in is null then
    delete from classroom.mail_sender_lists where mailbox_id = target_box and value = v;
    return;
  end if;
  if v !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and v !~ '^@[^@\s]+\.[^@\s]+$' then raise exception 'Enter an email address, or @domain.com for a whole domain.'; end if;
  insert into classroom.mail_sender_lists (mailbox_id, value, kind) values (target_box, v, kind_in)
  on conflict (mailbox_id, value) do update set kind = excluded.kind, created_at = now();
end;
$fn$;
revoke all on function classroom.mail_mark_sender(uuid, text, text) from public, anon;
grant execute on function classroom.mail_mark_sender(uuid, text, text) to authenticated;

-- 2. Junk scoring --------------------------------------------------------------------------
alter table classroom.mail_messages
  add column if not exists spam_score int,
  add column if not exists spam_reasons text[] not null default '{}',
  add column if not exists warning text;

-- msg: from_address, from_name, reply_to [{address}], subject, html, spf, dkim, dmarc.
create or replace function classroom.mail_junk_verdict(target_box uuid, msg jsonb)
returns jsonb language plpgsql stable security definer set search_path = classroom, public as $fn$
declare
  box classroom.mail_mailboxes;
  sender text := lower(coalesce(msg ->> 'from_address', ''));
  sender_name text := lower(btrim(coalesce(msg ->> 'from_name', '')));
  standing text;
  score int := 0;
  reasons text[] := '{}';
  warn text;
  body text := lower(coalesce(msg ->> 'subject', '') || ' ' || classroom.mail_snippet(left(coalesce(msg ->> 'html', ''), 200000)) || ' '
                     || regexp_replace(left(coalesce(msg ->> 'html', ''), 200000), '<[^>]+>', ' ', 'g'));
  phrases int := 0;
  p text;
  staff text;
  reply_dom text;
begin
  select * into box from classroom.mail_mailboxes where id = target_box;
  standing := classroom.mail_sender_standing(target_box, sender);
  if standing = 'safe' then return jsonb_build_object('junk', false, 'score', 0, 'reasons', '[]'::jsonb, 'warning', null); end if;
  if standing = 'blocked' then return jsonb_build_object('junk', true, 'score', 99, 'reasons', jsonb_build_array('You or the school blocked this sender'), 'warning', null); end if;

  if lower(coalesce(msg ->> 'dmarc', '')) = 'fail' then score := score + 5; reasons := array_append(reasons, ('Failed its own domain''s DMARC check (likely forged)')::text); end if;
  if lower(coalesce(msg ->> 'spf', '')) = 'fail' then score := score + 2; reasons := array_append(reasons, ('Sent from a server its domain does not allow (SPF)')::text);
  elsif lower(coalesce(msg ->> 'spf', '')) = 'softfail' then score := score + 1; reasons := array_append(reasons, ('SPF soft fail')::text); end if;
  if lower(coalesce(msg ->> 'dkim', '')) = 'fail' then score := score + 2; reasons := array_append(reasons, ('Its signature did not check out (DKIM)')::text); end if;
  if lower(coalesce(msg ->> 'spf', '')) <> 'pass' and lower(coalesce(msg ->> 'dkim', '')) <> 'pass' then score := score + 1; reasons := array_append(reasons, ('The sender could not be confirmed')::text); end if;

  -- An outsider using a staff member's name: the classic "message from the Principal".
  select b.display_name into staff from classroom.mail_mailboxes b
   where b.school_id = box.school_id and b.kind = 'person' and b.is_active and lower(btrim(b.display_name)) = sender_name and sender_name <> ''
     and b.address <> sender and not (sender = any (b.previous_addresses)) limit 1;
  if staff is not null then
    score := score + 4;
    reasons := array_append(reasons, (('Uses the name of ' || staff || ' but is not their school address'))::text);
    warn := 'This message uses the name of ' || staff || ', but it does not come from their school address. It may be someone pretending to be them: do not send money, passwords or gift cards.';
  elsif sender_name ~ '(principal|proprietor|proprietress|bursar|head ?teacher|director)' then
    score := score + 1;
    reasons := array_append(reasons, ('An outside sender with a school title in their name')::text);
  end if;

  foreach p in array array['verify your account', 'confirm your password', 'password expires', 'password will expire', 'gift card', 'itunes card',
                           'wire transfer', 'urgent payment', 'bank details have changed', 'change of bank details', 'account has been suspended',
                           'account will be suspended', 'unusual sign-in', 'click here to log in', 'click here to login', 'validate your mailbox',
                           'mailbox is full', 'update your payment', 'are you available? i need'] loop
    if position(p in body) > 0 then phrases := phrases + 1; end if;
  end loop;
  if phrases > 0 then score := score + least(phrases, 3); reasons := array_append(reasons, (('Phishing-style wording (' || phrases || ')'))::text); end if;

  select split_part(lower(x ->> 'address'), '@', 2) into reply_dom from jsonb_array_elements(coalesce(msg -> 'reply_to', '[]'::jsonb)) x limit 1;
  if reply_dom is not null and reply_dom <> '' and reply_dom <> split_part(sender, '@', 2) then
    score := score + 1; reasons := array_append(reasons, (('Replies would go to ' || reply_dom || ', not the sender''s domain'))::text);
  end if;
  if coalesce(msg ->> 'html', '') ~* 'href=["'']?https?://\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}' then
    score := score + 2; reasons := array_append(reasons, ('Links to a bare IP address')::text);
  end if;

  if warn is null and score >= 5 then
    warn := 'This looks like junk or phishing: ' || array_to_string(reasons, '; ') || '. Be careful with its links and attachments.';
  end if;
  return jsonb_build_object('junk', score >= 5, 'score', score, 'reasons', to_jsonb(reasons), 'warning', warn);
end;
$fn$;
revoke all on function classroom.mail_junk_verdict(uuid, jsonb) from public, anon, authenticated;
grant execute on function classroom.mail_junk_verdict(uuid, jsonb) to service_role;

-- Received outside mail (replaces 238/241's): scored for each mailbox.
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
  v jsonb;
  has_files boolean := jsonb_array_length(coalesce(files, '[]'::jsonb)) > 0;
begin
  select coalesce(array_agg(x), '{}') into refs
    from (select jsonb_array_elements_text(coalesce(msg -> 'references', '[]'::jsonb)) x
          union select msg ->> 'in_reply_to') r where x is not null and x <> '';
  bare := lower(btrim(regexp_replace(subj, '^((re|fw|fwd|aw|wg)\s*(\[\d+\])?\s*:\s*)+', '', 'i')));

  foreach box in array mailbox_ids loop
    continue when not exists (select 1 from classroom.mail_mailboxes where id = box and school_id = target_school);
    v := classroom.mail_junk_verdict(box, msg);
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
        has_attachments, size_bytes, is_read, sent_at, inbound_id, spam_score, spam_reasons, warning)
    values (box, envelope_in, coalesce(thread, gen_random_uuid()),
        coalesce(nullif(msg ->> 'message_id', ''), '<' || inbound_id_in || '@inbound.schoolivio.com>'),
        nullif(msg ->> 'in_reply_to', ''),
        case when (v ->> 'junk')::boolean then 'junk' else 'inbox' end,
        sender, coalesce(msg ->> 'from_name', ''),
        coalesce(msg -> 'to_list', '[]'::jsonb), coalesce(msg -> 'cc_list', '[]'::jsonb), coalesce(msg -> 'reply_to', '[]'::jsonb),
        subj, coalesce(msg ->> 'html', ''), classroom.mail_snippet(coalesce(msg ->> 'html', '')),
        coalesce(nullif(msg ->> 'importance', ''), 'normal'),
        has_files, coalesce((msg ->> 'size')::bigint, 0), false,
        coalesce((msg ->> 'sent_at')::timestamptz, now()), inbound_id_in,
        (v ->> 'score')::int, coalesce((select array_agg(x) from jsonb_array_elements_text(v -> 'reasons') x), '{}'), v ->> 'warning')
    on conflict (mailbox_id, inbound_id) where inbound_id is not null do nothing
    returning id into inserted;
    if inserted is not null then
      n := n + 1;
      if not (v ->> 'junk')::boolean then
        perform classroom.mail_autoreply(box, sender, msg ->> 'from_name', subj, nullif(msg ->> 'message_id', ''),
          (select thread_id from classroom.mail_messages where id = inserted), true);
      end if;
    end if;
  end loop;

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

-- 3. Reporting phishing ---------------------------------------------------------------------
create table if not exists classroom.mail_reports (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references classroom.schools (id) on delete cascade,
  mailbox_id uuid references classroom.mail_mailboxes (id) on delete set null,
  reported_by uuid references auth.users (id) on delete set null,
  sender text not null,
  subject text not null default '',
  copies_moved int not null default 0,
  created_at timestamptz not null default now()
);
alter table classroom.mail_reports enable row level security;
drop policy if exists "admins see reports" on classroom.mail_reports;
create policy "admins see reports" on classroom.mail_reports for select to authenticated using (classroom.is_school_admin(school_id));
grant select on classroom.mail_reports to authenticated;

create or replace function classroom.mail_report_phishing(target_message uuid)
returns jsonb language plpgsql security definer set search_path = classroom, public as $fn$
declare
  m classroom.mail_messages;
  box classroom.mail_mailboxes;
  moved int := 0;
  reporter text;
  rid uuid;
  a uuid;
begin
  select * into m from classroom.mail_messages where id = target_message;
  if not found or not classroom.owns_mailbox(m.mailbox_id) then raise exception 'That message is not yours.'; end if;
  select * into box from classroom.mail_mailboxes where id = m.mailbox_id;
  if m.from_address = box.address then raise exception 'You cannot report your own message.'; end if;

  if coalesce(classroom.mail_access(box.id, (select auth.uid())), 'read') in ('own', 'full') then
    insert into classroom.mail_sender_lists (mailbox_id, value, kind) values (box.id, lower(m.from_address), 'blocked')
    on conflict (mailbox_id, value) do update set kind = 'blocked';
  end if;
  update classroom.mail_messages set folder = 'junk', previous_folder = folder, is_read = true,
         warning = coalesce(warning, 'You reported this message as phishing.')
   where id = m.id;
  -- The same message in colleagues' mailboxes, not yet opened, goes to Junk too.
  with hit as (
    update classroom.mail_messages x
       set folder = 'junk', previous_folder = x.folder,
           warning = 'A colleague reported this message as phishing. Do not open its links or attachments.'
      from classroom.mail_mailboxes b
     where b.id = x.mailbox_id and b.school_id = box.school_id and x.id <> m.id and not x.is_read
       and x.folder in ('inbox', 'archive')
       and ((m.inbound_id is not null and x.inbound_id = m.inbound_id) or x.envelope_id = m.envelope_id)
    returning x.id)
  select count(*) into moved from hit;

  select coalesce(nullif(btrim(concat_ws(' ', p.first_name, p.surname)), ''), p.username, 'Someone') into reporter
    from classroom.profiles p where p.id = (select auth.uid());
  insert into classroom.mail_reports (school_id, mailbox_id, reported_by, sender, subject, copies_moved)
  values (box.school_id, box.id, (select auth.uid()), lower(m.from_address), m.subject, moved) returning id into rid;
  for a in select * from classroom.school_approvers(box.school_id) loop
    insert into classroom.notifications (user_id, school_id, kind, title, body, link, ref_id)
    values (a, box.school_id, 'mail_phishing', 'Phishing reported by ' || coalesce(reporter, 'a colleague'),
            '"' || coalesce(nullif(m.subject, ''), '(no subject)') || '" from ' || m.from_address
              || case when moved > 0 then '. ' || moved || ' other cop' || case when moved = 1 then 'y was' else 'ies were' end || ' moved to Junk.' else '.' end,
            '/School?tab=mail', rid)
    on conflict do nothing;
  end loop;
  return jsonb_build_object('copies_moved', moved);
end;
$fn$;
revoke all on function classroom.mail_report_phishing(uuid) from public, anon;
grant execute on function classroom.mail_report_phishing(uuid) to authenticated;

-- The admin's safety settings: limits, retention, the school's blocked list.
create or replace function classroom.mail_admin_safety(target_school uuid, patch jsonb)
returns jsonb language plpgsql security definer set search_path = classroom, public as $fn$
declare s classroom.mail_settings;
begin
  if not classroom.is_school_admin(target_school) then raise exception 'Only a school admin can do that.'; end if;
  insert into classroom.mail_settings (school_id) values (target_school) on conflict (school_id) do nothing;
  if patch is not null and patch <> '{}'::jsonb then
    update classroom.mail_settings
       set max_outside_hour = coalesce((patch ->> 'max_outside_hour')::int, max_outside_hour),
           max_outside_day = coalesce((patch ->> 'max_outside_day')::int, max_outside_day),
           deleted_days = coalesce((patch ->> 'deleted_days')::int, deleted_days),
           junk_days = coalesce((patch ->> 'junk_days')::int, junk_days),
           blocked_senders = case when patch ? 'blocked_senders'
             then coalesce((select array_agg(distinct lower(btrim(x))) from jsonb_array_elements_text(patch -> 'blocked_senders') x
                             where lower(btrim(x)) ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or lower(btrim(x)) ~ '^@[^@\s]+\.[^@\s]+$'), '{}')
             else blocked_senders end,
           updated_at = now()
     where school_id = target_school;
  end if;
  select * into s from classroom.mail_settings where school_id = target_school;
  return jsonb_build_object('max_outside_hour', s.max_outside_hour, 'max_outside_day', s.max_outside_day,
    'deleted_days', s.deleted_days, 'junk_days', s.junk_days, 'blocked_senders', to_jsonb(s.blocked_senders),
    'reports', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'sender', r.sender, 'subject', r.subject, 'copies_moved', r.copies_moved,
                           'created_at', r.created_at, 'reported_by',
                           (select coalesce(nullif(btrim(concat_ws(' ', p.first_name, p.surname)), ''), p.username) from classroom.profiles p where p.id = r.reported_by))
                         order by r.created_at desc)
                         from (select * from classroom.mail_reports where school_id = target_school order by created_at desc limit 50) r), '[]'::jsonb));
end;
$fn$;
revoke all on function classroom.mail_admin_safety(uuid, jsonb) from public, anon;
grant execute on function classroom.mail_admin_safety(uuid, jsonb) to authenticated;

-- 4. Sending limits ----------------------------------------------------------------------------
create or replace function classroom.mail_check_limits(box classroom.mail_mailboxes, wanted int)
returns void language plpgsql security definer set search_path = classroom, public as $fn$
declare
  s classroom.mail_settings;
  hour_n int;
  day_n int;
  a uuid;
  lim text;
begin
  select * into s from classroom.mail_settings where school_id = box.school_id;
  if not found then return; end if;
  select count(*) filter (where o.created_at > now() - interval '1 hour'), count(*)
    into hour_n, day_n
    from classroom.mail_outbound o join classroom.mail_messages m on m.id = o.message_id
   where m.mailbox_id = box.id and o.created_at > now() - interval '1 day';
  if hour_n + wanted > s.max_outside_hour then lim := s.max_outside_hour || ' outside recipients an hour';
  elsif day_n + wanted > s.max_outside_day then lim := s.max_outside_day || ' outside recipients a day';
  end if;
  if lim is null then return; end if;
  -- The admins hear about it (once an hour per mailbox): it may be a hacked account.
  for a in select * from classroom.school_approvers(box.school_id) loop
    insert into classroom.notifications (user_id, school_id, kind, title, body, link, ref_id)
    values (a, box.school_id, 'mail_limit', box.address || ' reached the sending limit',
            'It tried to send to more than ' || lim || '. If that was not expected, the account may be compromised: suspend it under Mail settings.',
            '/School?tab=mail', md5(box.id::text || date_trunc('hour', now())::text)::uuid)
    on conflict do nothing;
  end loop;
  raise exception 'This mailbox has reached the school''s limit of %. It can send outside again later; mail inside the school is not limited. Ask your school admin if you need more.', lim;
end;
$fn$;
revoke all on function classroom.mail_check_limits(classroom.mail_mailboxes, int) from public, anon, authenticated;

do $do$
declare d text;
begin
  d := pg_get_functiondef('classroom.mail_send_as(uuid,uuid)'::regprocedure);
  if position('mail_check_limits' in d) = 0 then
    d := replace(d, '  update classroom.mail_messages
     set folder = ''sent'', sent_at = now(), is_read = true, from_address = box.address, from_name = shown_name,',
'  -- Outside recipients count towards the school''s limits (hacked-account protection).
  perform classroom.mail_check_limits(box, (
    select count(*)::int from (select distinct lower(btrim(x ->> ''address'')) a from jsonb_array_elements(wanted) x) w
     where not exists (select 1 from classroom.mail_mailboxes mb where mb.address = w.a or w.a = any (mb.previous_addresses))));

  update classroom.mail_messages
     set folder = ''sent'', sent_at = now(), is_read = true, from_address = box.address, from_name = shown_name,');
    -- A colleague you blocked: their mail goes to your Junk.
    d := replace(d, '      values (rcpt.id, d.envelope_id, d.thread_id, d.message_id, d.in_reply_to, ''inbox'',',
                    '      values (rcpt.id, d.envelope_id, d.thread_id, d.message_id, d.in_reply_to,
          case when classroom.mail_sender_standing(rcpt.id, box.address) = ''blocked'' then ''junk'' else ''inbox'' end,');
    execute d;
  end if;
end
$do$;

-- 5. Push for new mail ---------------------------------------------------------------------------
alter table classroom.mail_mailboxes add column if not exists push_new_mail boolean not null default true;
grant update (push_new_mail) on classroom.mail_mailboxes to authenticated;

create or replace function classroom.get_mail_push_context(target_message uuid)
returns jsonb language sql stable security definer set search_path = classroom, public as $fn$
  select jsonb_build_object(
    'title', coalesce(nullif(m.from_name, ''), m.from_address),
    'body', coalesce(nullif(m.subject, ''), '(no subject)') || case when m.snippet <> '' then ' · ' || left(m.snippet, 90) else '' end,
    'link', '/Mail?thread=' || m.thread_id || '&box=' || b.id,
    'school', jsonb_build_object('id', s.id, 'name', s.name, 'logo_url', s.logo_url),
    'subscriptions', coalesce((select jsonb_agg(jsonb_build_object('endpoint', ps.endpoint, 'p256dh', ps.p256dh, 'auth', ps.auth))
                                 from classroom.push_subscriptions ps where ps.user_id = b.user_id and (ps.school_id = b.school_id or ps.school_id is null)), '[]'::jsonb))
    from classroom.mail_messages m join classroom.mail_mailboxes b on b.id = m.mailbox_id join classroom.schools s on s.id = b.school_id
   where m.id = target_message and m.folder = 'inbox' and b.push_new_mail and b.user_id is not null;
$fn$;
revoke all on function classroom.get_mail_push_context(uuid) from public, anon, authenticated;
grant execute on function classroom.get_mail_push_context(uuid) to service_role;

create or replace function classroom.mail_push_new()
returns trigger language plpgsql security definer set search_path = classroom, public as $fn$
begin
  if new.folder <> 'inbox' or new.is_read or new.is_auto or coalesce(new.inbound_id, '') like 'imp:%' then return null; end if;
  -- A rule may already have filed it elsewhere (rules run first: triggers go in name order).
  if not exists (select 1 from classroom.mail_messages m join classroom.mail_mailboxes b on b.id = m.mailbox_id
                  where m.id = new.id and m.folder = 'inbox' and b.push_new_mail and b.user_id is not null) then
    return null;
  end if;
  perform classroom.push_notify(jsonb_build_object('type', 'mail', 'message_id', new.id));
  return null;
end;
$fn$;
drop trigger if exists mail_push_new on classroom.mail_messages;
create trigger mail_push_new after insert on classroom.mail_messages
  for each row execute function classroom.mail_push_new();

-- 6. Retention -----------------------------------------------------------------------------------
-- Run daily by mail-maintenance: empties Deleted and Junk by the school's
-- days (0 = never), and hands back the files nothing refers to any more
-- (their rows removed) for it to delete from storage, with import uploads
-- left behind by stopped imports.
create or replace function classroom.mail_retention_run()
returns jsonb language plpgsql security definer set search_path = classroom, public as $fn$
declare
  removed int;
  files text[];
  uploads text[];
begin
  with gone as (
    delete from classroom.mail_messages m
     using classroom.mail_mailboxes b, classroom.mail_settings s
     where b.id = m.mailbox_id and s.school_id = b.school_id
       and ((m.folder = 'deleted' and s.deleted_days > 0 and m.updated_at < now() - make_interval(days => s.deleted_days))
         or (m.folder = 'junk' and s.junk_days > 0 and m.updated_at < now() - make_interval(days => s.junk_days)))
    returning m.id)
  select count(*) into removed from gone;

  with orphan as (
    delete from classroom.mail_attachments a
     where a.created_at < now() - interval '1 day'
       and not exists (select 1 from classroom.mail_messages m where m.envelope_id = a.envelope_id)
    returning a.file_path)
  select coalesce(array_agg(file_path), '{}') into files from orphan;

  with left_behind as (
    update classroom.mail_imports set file_paths = '{}'
     where status in ('done', 'failed', 'cancelled') and cardinality(file_paths) > 0 and updated_at < now() - interval '7 days'
    returning file_paths)
  select coalesce(array_agg(p), '{}') into uploads from left_behind, unnest(file_paths) p;

  return jsonb_build_object('messages_removed', removed, 'files', to_jsonb(files), 'uploads', to_jsonb(uploads));
end;
$fn$;
revoke all on function classroom.mail_retention_run() from public, anon, authenticated;
grant execute on function classroom.mail_retention_run() to service_role;

select cron.unschedule('schoolivio-mail-maintenance') where exists (select 1 from cron.job where jobname = 'schoolivio-mail-maintenance');
select cron.schedule('schoolivio-mail-maintenance', '15 2 * * *', $job$
  select net.http_post(
    url := 'https://nulvsbapllfxvhdmyudt.supabase.co/functions/v1/mail-maintenance',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'ticket_mail_cron_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 120000);
$job$);

-- 7. The audit log ---------------------------------------------------------------------------------
-- Only the columns that matter to an admin are compared and kept; keys,
-- secrets and DNS records never go in. Someone acting through an Edge
-- Function (connecting the domain, deleting a mailbox) is named by it in
-- classroom.actor, since the service role has no signed-in person.
create or replace function classroom.mail_audit_changes()
returns trigger language plpgsql security definer set search_path = classroom, public as $fn$
declare
  watched text[] := tg_argv;
  o jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  n jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  changed text[];
  keep_o jsonb := '{}'::jsonb;
  keep_n jsonb := '{}'::jsonb;
  k text;
  headers jsonb := nullif(current_setting('request.headers', true), '')::jsonb;
  actor uuid := coalesce((select auth.uid()), nullif(current_setting('classroom.actor', true), '')::uuid);
  actor_name text;
  actor_role text;
  school uuid;
begin
  foreach k in array watched loop
    if o is not null then keep_o := keep_o || jsonb_build_object(k, o -> k); end if;
    if n is not null then keep_n := keep_n || jsonb_build_object(k, n -> k); end if;
  end loop;
  if tg_op = 'UPDATE' then
    select coalesce(array_agg(w.col), '{}') into changed from unnest(watched) as w(col) where (o -> w.col) is distinct from (n -> w.col);
    if cardinality(changed) = 0 then return null; end if;
  end if;
  school := coalesce((n ->> 'school_id')::uuid, (o ->> 'school_id')::uuid,
    (select b.school_id from classroom.mail_mailboxes b where b.id = coalesce((n ->> 'mailbox_id')::uuid, (o ->> 'mailbox_id')::uuid)),
    (select l.school_id from classroom.mail_lists l where l.id = coalesce((n ->> 'list_id')::uuid, (o ->> 'list_id')::uuid)));
  select coalesce(nullif(btrim(concat_ws(' ', p.first_name, p.surname)), ''), p.username) into actor_name from classroom.profiles p where p.id = actor;
  select m.role::text into actor_role from classroom.school_members m where m.school_id = school and m.user_id = actor and m.is_active limit 1;
  insert into classroom.audit_log (school_id, table_name, record_id, action, actor_id, actor_label, actor_role,
      old_data, new_data, changed_fields, ip_address, country, user_agent)
  values (school, tg_table_name, coalesce(n ->> 'id', o ->> 'id', n ->> 'mailbox_id', o ->> 'mailbox_id', n ->> 'school_id', o ->> 'school_id'),
      tg_op, actor, coalesce(actor_name, 'Anonymous / system'), actor_role,
      case when o is null then null else keep_o end, case when n is null then null else keep_n end, changed,
      coalesce(headers ->> 'cf-connecting-ip', split_part(headers ->> 'x-forwarded-for', ',', 1), headers ->> 'x-real-ip'),
      nullif(headers ->> 'cf-ipcountry', ''), nullif(headers ->> 'user-agent', ''));
  return null;
end;
$fn$;

drop trigger if exists mail_audit on classroom.mail_mailboxes;
create trigger mail_audit after insert or update or delete on classroom.mail_mailboxes
  for each row execute function classroom.mail_audit_changes('address', 'display_name', 'kind', 'user_id', 'previous_addresses', 'quota_bytes', 'is_active');
drop trigger if exists mail_audit on classroom.mail_settings;
create trigger mail_audit after insert or update or delete on classroom.mail_settings
  for each row execute function classroom.mail_audit_changes('domain', 'key_hint', 'sending_enabled', 'receiving_enabled', 'microsoft_tenant',
    'max_outside_hour', 'max_outside_day', 'deleted_days', 'junk_days', 'blocked_senders');
drop trigger if exists mail_audit on classroom.mail_mailbox_members;
create trigger mail_audit after insert or update or delete on classroom.mail_mailbox_members
  for each row execute function classroom.mail_audit_changes('mailbox_id', 'user_id', 'access');
drop trigger if exists mail_audit on classroom.mail_lists;
create trigger mail_audit after insert or update or delete on classroom.mail_lists
  for each row execute function classroom.mail_audit_changes('name', 'address', 'allow_outside');
drop trigger if exists mail_audit on classroom.mail_list_members;
create trigger mail_audit after insert or update or delete on classroom.mail_list_members
  for each row execute function classroom.mail_audit_changes('list_id', 'mailbox_id');
drop trigger if exists mail_audit on classroom.mail_reports;
create trigger mail_audit after insert on classroom.mail_reports
  for each row execute function classroom.mail_audit_changes('sender', 'subject', 'copies_moved');

-- Edge Functions name who they act for.
do $do$
declare d text;
begin
  d := pg_get_functiondef('classroom.mail_settings_save(uuid,text,text,text,text,jsonb,text,text,text,text,uuid)'::regprocedure);
  if position('classroom.actor' in d) = 0 then
    d := replace(d, E'begin\n  if domain_in is not null', E'begin\n  perform set_config(''classroom.actor'', coalesce(actor::text, ''''), true);\n  if domain_in is not null');
    execute d;
  end if;
end
$do$;

create or replace function classroom.mail_delete_mailbox_by(target_mailbox uuid, actor uuid)
returns text[] language plpgsql security definer set search_path = classroom, public as $fn$
begin
  perform set_config('classroom.actor', coalesce(actor::text, ''), true);
  return classroom.mail_delete_mailbox(target_mailbox);
end;
$fn$;
revoke all on function classroom.mail_delete_mailbox_by(uuid, uuid) from public, anon, authenticated;
grant execute on function classroom.mail_delete_mailbox_by(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
