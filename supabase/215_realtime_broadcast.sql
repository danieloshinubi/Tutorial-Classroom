-- Live updates by private broadcast instead of postgres_changes.
--
-- postgres_changes made the database read its whole change stream and check
-- every change against every connected person's row-level security; at 8
-- schools it was already the database's largest single job, and the cost
-- grows with changes x people online. Now each table's trigger sends one
-- message to the one topic that needs it, and Realtime checks once, when
-- someone joins a topic, whether they may (realtime_can_listen below):
--
--   user:<user id>           my notifications, my chats changing
--   chat:<channel id>        a chat's messages, members, reactions
--   typing:<channel id>      who is typing (sent by browsers, never stored)
--   course:<course id>       a class stream's new posts
--   application:<id>         one application's timeline
--   applications:<school>    the admissions queue (ids only)
--   tickets:<school>         the request queue (ids only)
--   ticket:<id>              one request's thread (ids only)
--
-- Queue topics carry ids, not content: the screens only use them as a
-- "something changed, reload" signal, so nothing a viewer could not already
-- read travels on them. 216 then takes the tables out of the
-- supabase_realtime publication, ending the per-change, per-person checking;
-- it runs once the app listening this way is live, so updates never stop.

-- Who may join a topic. SECURITY INVOKER on purpose: the record checks run
-- under the joining person's own row-level security, so a topic is open to
-- exactly the people who can read what it is about.
create or replace function classroom.realtime_can_listen(target_topic text)
returns boolean
language plpgsql
stable
set search_path = classroom, public
as $fn$
declare
  kind text := split_part(coalesce(target_topic, ''), ':', 1);
  ref uuid := classroom.try_uuid(split_part(coalesce(target_topic, ''), ':', 2));
begin
  if auth.uid() is null or ref is null then
    return false;
  end if;
  return coalesce(case kind
    when 'user' then ref = auth.uid()
    when 'chat' then classroom.is_chat_member(ref)
    when 'typing' then classroom.is_chat_member(ref)
    when 'course' then classroom.is_enrolled_in(ref) or classroom.can_manage_course(ref)
    when 'application' then exists (select 1 from classroom.applications a where a.id = ref)
    when 'applications' then classroom.can_view_admissions(ref)
    when 'tickets' then classroom.is_ticket_staff(ref)
    when 'ticket' then exists (select 1 from classroom.tickets t where t.id = ref)
    else false
  end, false);
end;
$fn$;
revoke all on function classroom.realtime_can_listen(text) from public, anon;
grant execute on function classroom.realtime_can_listen(text) to authenticated;

drop policy if exists "schoolivio topics: listen" on realtime.messages;
create policy "schoolivio topics: listen" on realtime.messages
  for select to authenticated
  using (classroom.realtime_can_listen(realtime.topic()));

-- Browsers send only one thing themselves: "typing", to a chat they are in.
drop policy if exists "schoolivio topics: typing" on realtime.messages;
create policy "schoolivio topics: typing" on realtime.messages
  for insert to authenticated
  with check (
    split_part(realtime.topic(), ':', 1) = 'typing'
    and classroom.realtime_can_listen(realtime.topic())
  );

-- One message to one topic, never failing the write that caused it.
create or replace function classroom.rt_send(target_topic text, event_name text, body jsonb)
returns void
language plpgsql
security definer
set search_path = classroom, public
as $fn$
begin
  perform realtime.send(body, event_name, target_topic, true);
exception when others then
  -- A live update is a nicety; the row is already saved and the next load
  -- shows it. Never let Realtime being unavailable roll back real work.
  raise warning 'rt_send % failed: %', target_topic, sqlerrm;
end;
$fn$;
revoke all on function classroom.rt_send(text, text, jsonb) from public, anon, authenticated;

-- The payload shape the screens already read: { eventType, table, new, old }.
create or replace function classroom.rt_body(op text, tbl text, new_row jsonb, old_row jsonb)
returns jsonb language sql immutable as $fn$
  select jsonb_build_object('eventType', op, 'table', tbl, 'new', coalesce(new_row, '{}'::jsonb), 'old', coalesce(old_row, '{}'::jsonb));
$fn$;

-- notifications -> user
create or replace function classroom.rt_notifications() returns trigger
language plpgsql security definer set search_path = classroom, public as $fn$
begin
  perform classroom.rt_send('user:' || new.user_id, 'change', classroom.rt_body(tg_op, tg_table_name, to_jsonb(new), null));
  return null;
end; $fn$;
drop trigger if exists rt_notifications on classroom.notifications;
create trigger rt_notifications after insert on classroom.notifications
  for each row execute function classroom.rt_notifications();

-- chat_messages -> chat (the members' lists update through chat_channels)
create or replace function classroom.rt_chat_messages() returns trigger
language plpgsql security definer set search_path = classroom, public as $fn$
declare r record;
begin
  r := coalesce(new, old);
  perform classroom.rt_send('chat:' || r.channel_id, 'change',
    classroom.rt_body(tg_op, tg_table_name, case when tg_op = 'DELETE' then null else to_jsonb(new) end,
                      case when tg_op = 'INSERT' then null else to_jsonb(old) end));
  return null;
end; $fn$;
drop trigger if exists rt_chat_messages on classroom.chat_messages;
create trigger rt_chat_messages after insert or update or delete on classroom.chat_messages
  for each row execute function classroom.rt_chat_messages();

-- chat_channels (a new message bumps last_message_at; a rename) -> each member
create or replace function classroom.rt_chat_channels() returns trigger
language plpgsql security definer set search_path = classroom, public as $fn$
declare m record;
begin
  for m in select user_id from classroom.chat_channel_members where channel_id = new.id loop
    perform classroom.rt_send('user:' || m.user_id, 'change',
      classroom.rt_body(tg_op, tg_table_name, jsonb_build_object('id', new.id), null));
  end loop;
  return null;
end; $fn$;
drop trigger if exists rt_chat_channels on classroom.chat_channels;
create trigger rt_chat_channels after update on classroom.chat_channels
  for each row execute function classroom.rt_chat_channels();

-- chat_channel_members -> the chat, and the member themselves
create or replace function classroom.rt_chat_channel_members() returns trigger
language plpgsql security definer set search_path = classroom, public as $fn$
declare r record; body jsonb;
begin
  r := coalesce(new, old);
  body := classroom.rt_body(tg_op, tg_table_name,
    case when tg_op = 'DELETE' then null else to_jsonb(new) end,
    case when tg_op = 'INSERT' then null else to_jsonb(old) end);
  perform classroom.rt_send('chat:' || r.channel_id, 'change', body);
  perform classroom.rt_send('user:' || r.user_id, 'change', body);
  return null;
end; $fn$;
drop trigger if exists rt_chat_channel_members on classroom.chat_channel_members;
create trigger rt_chat_channel_members after insert or update or delete on classroom.chat_channel_members
  for each row execute function classroom.rt_chat_channel_members();

-- chat_message_reactions -> the message's chat
create or replace function classroom.rt_chat_message_reactions() returns trigger
language plpgsql security definer set search_path = classroom, public as $fn$
declare r record; ch uuid;
begin
  r := coalesce(new, old);
  select channel_id into ch from classroom.chat_messages where id = r.message_id;
  if ch is not null then
    perform classroom.rt_send('chat:' || ch, 'change', classroom.rt_body(tg_op, tg_table_name,
      case when tg_op = 'DELETE' then null else to_jsonb(new) end,
      case when tg_op = 'INSERT' then null else to_jsonb(old) end));
  end if;
  return null;
end; $fn$;
drop trigger if exists rt_chat_message_reactions on classroom.chat_message_reactions;
create trigger rt_chat_message_reactions after insert or delete on classroom.chat_message_reactions
  for each row execute function classroom.rt_chat_message_reactions();

-- messages (class stream) -> course
create or replace function classroom.rt_messages() returns trigger
language plpgsql security definer set search_path = classroom, public as $fn$
begin
  perform classroom.rt_send('course:' || new.course_id, 'change', classroom.rt_body(tg_op, tg_table_name, to_jsonb(new), null));
  return null;
end; $fn$;
drop trigger if exists rt_messages on classroom.messages;
create trigger rt_messages after insert on classroom.messages
  for each row execute function classroom.rt_messages();

-- application_events -> that application
create or replace function classroom.rt_application_events() returns trigger
language plpgsql security definer set search_path = classroom, public as $fn$
begin
  perform classroom.rt_send('application:' || new.application_id, 'change',
    classroom.rt_body(tg_op, tg_table_name, jsonb_build_object('id', new.id, 'application_id', new.application_id, 'actor_id', new.actor_id), null));
  return null;
end; $fn$;
drop trigger if exists rt_application_events on classroom.application_events;
create trigger rt_application_events after insert on classroom.application_events
  for each row execute function classroom.rt_application_events();

-- applications -> the school's admissions queue (ids only)
create or replace function classroom.rt_applications() returns trigger
language plpgsql security definer set search_path = classroom, public as $fn$
declare r record;
begin
  r := coalesce(new, old);
  perform classroom.rt_send('applications:' || r.school_id, 'change',
    classroom.rt_body(tg_op, tg_table_name, jsonb_build_object('id', r.id), null));
  return null;
end; $fn$;
drop trigger if exists rt_applications on classroom.applications;
create trigger rt_applications after insert or update or delete on classroom.applications
  for each row execute function classroom.rt_applications();

-- tickets -> the school's queue and the ticket's own thread (ids only)
create or replace function classroom.rt_tickets() returns trigger
language plpgsql security definer set search_path = classroom, public as $fn$
declare r record; body jsonb;
begin
  r := coalesce(new, old);
  body := classroom.rt_body(tg_op, tg_table_name, jsonb_build_object('id', r.id), null);
  perform classroom.rt_send('tickets:' || r.school_id, 'change', body);
  if tg_op = 'UPDATE' then
    perform classroom.rt_send('ticket:' || r.id, 'change', body);
  end if;
  return null;
end; $fn$;
drop trigger if exists rt_tickets on classroom.tickets;
create trigger rt_tickets after insert or update or delete on classroom.tickets
  for each row execute function classroom.rt_tickets();

-- ticket_messages -> the ticket's thread (who wrote it, nothing else)
create or replace function classroom.rt_ticket_messages() returns trigger
language plpgsql security definer set search_path = classroom, public as $fn$
begin
  perform classroom.rt_send('ticket:' || new.ticket_id, 'change',
    classroom.rt_body(tg_op, tg_table_name, jsonb_build_object('id', new.id, 'author_id', new.author_id), null));
  return null;
end; $fn$;
drop trigger if exists rt_ticket_messages on classroom.ticket_messages;
create trigger rt_ticket_messages after insert on classroom.ticket_messages
  for each row execute function classroom.rt_ticket_messages();

notify pgrst, 'reload schema';
