-- Signing in with a username (2026-10-15). The login page turns a school's
-- username into the account's email before signing in, and anyone can ask
-- (it has to work before sign-in). Asked in a loop, that lists who has an
-- account and their email address. Each network address now gets 30
-- look-ups an hour, plenty for people mistyping, useless for harvesting.
create or replace function classroom.sign_in_email(school_slug text, username_in text)
returns text language plpgsql volatile security definer set search_path = classroom, public as $fn$
declare
  ip text := coalesce(nullif(btrim(split_part(coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''), ',', 1)), ''), 'unknown');
begin
  if not classroom.ai_rate_ok(null, 'signin:' || md5(ip), 30, null) then
    raise exception 'Too many sign-in attempts. Wait a few minutes and try again.';
  end if;
  return (
    select p.email
      from classroom.profiles p
      join classroom.school_members m on m.user_id = p.id and m.is_active
      join classroom.schools s on s.id = m.school_id
     where s.slug = lower(btrim(school_slug))
       and lower(p.username) = lower(btrim(username_in))
     limit 1
  );
end;
$fn$;
grant execute on function classroom.sign_in_email(text, text) to anon, authenticated;

notify pgrst, 'reload schema';
