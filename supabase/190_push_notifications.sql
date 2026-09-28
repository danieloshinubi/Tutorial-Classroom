-- Instant phone and browser notifications (web push), for every school.
--
-- The moment a chat message or an in-app notification is saved, a trigger
-- hands it to the push-notify Edge Function over pg_net, the same
-- fire-and-forget path payment emails already use (114). No polling and no
-- batching: a message reaches the phone in a second or two.
--
--   push_subscriptions   one row per device a person turned notifications on
--                        for. school_id is the school site it was turned on
--                        from: a push is only sent to devices subscribed on
--                        that school's site, because a notification opens in
--                        the site that registered it, and someone in two
--                        schools should get each school's alerts from its own.
--   notification_prefs   per person: whether a chat message also emails them.
--
-- Chat email is "first unread, then quiet": the first message in a chat that
-- the person has not read emails them straight away; further messages in the
-- same chat do not, until they have read it. A muted chat neither pushes nor
-- emails. Email goes through the school's own connected mailbox, like every
-- other school email; a school without one gets push and in-app only.
--
-- The shared secret the Edge Function checks is generated here and kept in
-- the vault. Unlike 114, it is never written into this file: the repository
-- is public.

-- --------------------------------------------------------------- tables --

create table if not exists classroom.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references classroom.profiles(id) on delete cascade,
  school_id uuid references classroom.schools(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user on classroom.push_subscriptions (user_id, school_id);

create table if not exists classroom.notification_prefs (
  user_id uuid primary key references classroom.profiles(id) on delete cascade,
  chat_email boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table classroom.push_subscriptions enable row level security;
alter table classroom.notification_prefs enable row level security;

drop policy if exists "people see their own devices" on classroom.push_subscriptions;
create policy "people see their own devices" on classroom.push_subscriptions
  for select using (user_id = auth.uid());
drop policy if exists "people remove their own devices" on classroom.push_subscriptions;
create policy "people remove their own devices" on classroom.push_subscriptions
  for delete using (user_id = auth.uid());

drop policy if exists "people read their own prefs" on classroom.notification_prefs;
create policy "people read their own prefs" on classroom.notification_prefs
  for select using (user_id = auth.uid());

grant select, delete on classroom.push_subscriptions to authenticated;
grant select on classroom.notification_prefs to authenticated;

-- Save this device for the signed-in person. An endpoint is one browser on
-- one device, so if someone else signs in on it, the device moves to them:
-- the previous person must not keep receiving alerts on a phone that is no
-- longer theirs.
create or replace function classroom.save_push_subscription(
  endpoint_in text, p256dh_in text, auth_in text, school_in uuid default null, agent_in text default null
)
returns void
language plpgsql
security definer
set search_path to 'classroom', 'public'
as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if coalesce(btrim(endpoint_in), '') = '' or coalesce(p256dh_in, '') = '' or coalesce(auth_in, '') = '' then
    raise exception 'That device did not give a complete subscription';
  end if;
  if school_in is not null and not exists (
    select 1 from classroom.school_members m where m.school_id = school_in and m.user_id = auth.uid() and m.is_active
  ) then
    school_in := null;
  end if;
  insert into classroom.push_subscriptions (user_id, school_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), school_in, endpoint_in, p256dh_in, auth_in, left(agent_in, 300))
  on conflict (endpoint) do update
    set user_id = excluded.user_id, school_id = excluded.school_id, p256dh = excluded.p256dh,
        auth = excluded.auth, user_agent = excluded.user_agent, last_seen_at = now();
end;
$$;

create or replace function classroom.save_notification_prefs(chat_email_in boolean)
returns void
language sql
security definer
set search_path to 'classroom', 'public'
as $$
  insert into classroom.notification_prefs (user_id, chat_email, updated_at)
  values (auth.uid(), chat_email_in, now())
  on conflict (user_id) do update set chat_email = excluded.chat_email, updated_at = now();
$$;

grant execute on function classroom.save_push_subscription(text, text, text, uuid, text) to authenticated;
grant execute on function classroom.save_notification_prefs(boolean) to authenticated;

-- ----------------------------------------------- what the function reads --
-- service_role has no table grants here (the same gap 114 works around), so
-- the Edge Function reads through these, granted to service_role alone.

create or replace function classroom.get_chat_push_context(target_message uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'classroom', 'public'
as $$
  select jsonb_build_object(
    'school', jsonb_build_object('id', s.id, 'name', s.name, 'slug', s.slug, 'logo_url', s.logo_url, 'theme_color', s.theme_color),
    'channel', jsonb_build_object('id', ch.id, 'kind', ch.kind, 'name', ch.name),
    'author', coalesce(nullif(btrim(concat_ws(' ', ap.first_name, ap.surname)), ''), nullif(ap.username, ''), split_part(coalesce(ap.email, ''), '@', 1), 'Someone'),
    'text', left(btrim(regexp_replace(regexp_replace(coalesce(m.body, ''), '<[^>]+>', ' ', 'g'), '\s+', ' ', 'g')), 300),
    'attachment_name', m.attachment_name,
    'attachment_mime', m.attachment_mime,
    'recipients', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', cm.user_id,
        'email', rp.email,
        'name', coalesce(nullif(btrim(concat_ws(' ', rp.first_name, rp.surname)), ''), rp.username),
        'muted', cm.is_muted,
        'chat_email', coalesce(np.chat_email, true),
        -- First unread: nothing else from anyone else is waiting for them in
        -- this chat, from after they last read it.
        'first_unread', not exists (
          select 1 from classroom.chat_messages o
          where o.channel_id = m.channel_id and o.id <> m.id and o.author_id <> cm.user_id
            and o.deleted_at is null and o.created_at <= m.created_at
            and o.created_at > coalesce(cm.last_read_at, '-infinity'::timestamptz)
        ),
        'subscriptions', coalesce((
          select jsonb_agg(jsonb_build_object('endpoint', ps.endpoint, 'p256dh', ps.p256dh, 'auth', ps.auth))
          from classroom.push_subscriptions ps
          where ps.user_id = cm.user_id and (ps.school_id = ch.school_id or ps.school_id is null)
        ), '[]'::jsonb)
      ))
      from classroom.chat_channel_members cm
      join classroom.profiles rp on rp.id = cm.user_id
      left join classroom.notification_prefs np on np.user_id = cm.user_id
      where cm.channel_id = m.channel_id and cm.user_id <> m.author_id
    ), '[]'::jsonb)
  )
  from classroom.chat_messages m
  join classroom.chat_channels ch on ch.id = m.channel_id
  join classroom.schools s on s.id = ch.school_id
  left join classroom.profiles ap on ap.id = m.author_id
  where m.id = target_message and m.deleted_at is null;
$$;

create or replace function classroom.get_notification_push_context(target_notification uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'classroom', 'public'
as $$
  select jsonb_build_object(
    'title', n.title,
    'body', n.body,
    'link', n.link,
    'kind', n.kind,
    'school', case when s.id is null then null else
      jsonb_build_object('id', s.id, 'name', s.name, 'slug', s.slug, 'logo_url', s.logo_url) end,
    'subscriptions', coalesce((
      select jsonb_agg(jsonb_build_object('endpoint', ps.endpoint, 'p256dh', ps.p256dh, 'auth', ps.auth))
      from classroom.push_subscriptions ps
      where ps.user_id = n.user_id and (n.school_id is null or ps.school_id = n.school_id or ps.school_id is null)
    ), '[]'::jsonb)
  )
  from classroom.notifications n
  left join classroom.schools s on s.id = n.school_id
  where n.id = target_notification;
$$;

-- A device the push service says is gone (uninstalled, permission revoked).
create or replace function classroom.forget_push_subscription(endpoint_in text)
returns void
language sql
security definer
set search_path to 'classroom', 'public'
as $$
  delete from classroom.push_subscriptions where endpoint = endpoint_in;
$$;

revoke all on function classroom.get_chat_push_context(uuid) from public;
revoke all on function classroom.get_notification_push_context(uuid) from public;
revoke all on function classroom.forget_push_subscription(text) from public;
grant execute on function classroom.get_chat_push_context(uuid) to service_role;
grant execute on function classroom.get_notification_push_context(uuid) to service_role;
grant execute on function classroom.forget_push_subscription(text) to service_role;

-- ---------------------------------------------------------------- secret --

do $secret$
begin
  if not exists (select 1 from vault.secrets where name = 'push_notify_secret') then
    perform vault.create_secret(
      encode(gen_random_bytes(32), 'hex'),
      'push_notify_secret',
      'Shared secret the push triggers send to the push-notify Edge Function as x-cron-secret'
    );
  end if;
end;
$secret$;

-- -------------------------------------------------------------- triggers --
-- Never block the message or the notification itself: a push that cannot be
-- queued is a warning, not a reason to lose what the person wrote.

create or replace function classroom.push_notify(payload jsonb)
returns void
language plpgsql
security definer
set search_path to 'classroom', 'public', 'vault'
as $fn$
begin
  perform net.http_post(
    url := 'https://nulvsbapllfxvhdmyudt.supabase.co/functions/v1/push-notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'push_notify_secret')
    ),
    body := payload
  );
exception when others then
  raise warning 'push_notify could not queue %: %', payload, sqlerrm;
end;
$fn$;
revoke all on function classroom.push_notify(jsonb) from public, anon, authenticated;

create or replace function classroom.push_on_chat_message()
returns trigger
language plpgsql
security definer
set search_path to 'classroom', 'public'
as $fn$
begin
  perform classroom.push_notify(jsonb_build_object('type', 'chat', 'message_id', new.id));
  return null;
end;
$fn$;

drop trigger if exists chat_messages_push on classroom.chat_messages;
create trigger chat_messages_push
  after insert on classroom.chat_messages
  for each row execute function classroom.push_on_chat_message();

create or replace function classroom.push_on_notification()
returns trigger
language plpgsql
security definer
set search_path to 'classroom', 'public'
as $fn$
begin
  perform classroom.push_notify(jsonb_build_object('type', 'notification', 'notification_id', new.id));
  return null;
end;
$fn$;

drop trigger if exists notifications_push on classroom.notifications;
create trigger notifications_push
  after insert on classroom.notifications
  for each row execute function classroom.push_on_notification();

notify pgrst, 'reload schema';
