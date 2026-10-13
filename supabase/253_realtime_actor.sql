-- Every live update says who caused it (2026-10-08).
--
-- The "N new updates · Reload" prompt (LiveUpdateBanner) is for changes
-- someone ELSE made while you had the page open. The ticket row, the tickets
-- queue and the admissions queue carried no "who", so the person who had
-- just pressed Update was told to reload for their own change. Now every
-- broadcast, on every topic, carries actor: the signed-in person whose
-- request made the change (or the person an Edge Function acts for,
-- classroom.actor), and the app ignores its own. Changes made by Schoolivio
-- itself (mail arriving, a payment settling) have no actor and still count.

create or replace function classroom.rt_send(target_topic text, event_name text, body jsonb)
returns void
language plpgsql
security definer
set search_path = classroom, public
as $fn$
declare
  who text := coalesce((select auth.uid())::text, nullif(current_setting('classroom.actor', true), ''));
begin
  if who is not null and jsonb_typeof(body) = 'object' then
    body := body || jsonb_build_object('actor', who);
  end if;
  perform realtime.send(body, event_name, target_topic, true);
exception when others then
  -- A live update is a nicety; the row is already saved and the next load
  -- shows it. Never let Realtime being unavailable roll back real work.
  raise warning 'rt_send % failed: %', target_topic, sqlerrm;
end;
$fn$;
revoke all on function classroom.rt_send(text, text, jsonb) from public, anon, authenticated;
