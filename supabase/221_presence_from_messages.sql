-- Sending a message is being seen. Whoever just wrote in a chat has their last seen moved to now, so the other side never reads
-- "last seen 5 min ago" under a message that arrived a second ago, even from
-- a copy of the app that does not report presence itself.
create or replace function classroom.presence_from_activity()
returns trigger
language plpgsql
security definer
set search_path = classroom, public
as $fn$
begin
  if new.author_id is not null then
    insert into classroom.user_presence (user_id, last_seen_at)
    values (new.author_id, now())
    on conflict (user_id) do update set last_seen_at = now()
     where classroom.user_presence.last_seen_at < now() - interval '15 seconds';
  end if;
  return null;
end;
$fn$;

drop trigger if exists presence_from_chat on classroom.chat_messages;
create trigger presence_from_chat after insert on classroom.chat_messages
  for each row execute function classroom.presence_from_activity();
