-- Who is calling, as the database sees it. The AI assistant's edge function
-- asks this instead of the Auth server's /user endpoint.
--
-- Found in testing: with two tabs open, the Auth server had retired the
-- person's session (a refresh token used twice ends the whole session), yet
-- their access token was still validly signed for another 45 minutes. Every
-- page kept working, because the database checks the token's signature,
-- but the assistant asked the Auth server and got "not signed in" on every
-- question. Asking the database makes the assistant agree with the rest of
-- the app about who is signed in.
create or replace function classroom.ai_whoami()
returns uuid
language sql
stable
as $fn$
  select auth.uid();
$fn$;

grant execute on function classroom.ai_whoami() to authenticated;
