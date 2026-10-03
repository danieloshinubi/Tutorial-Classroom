-- A blank username is no username.
--
-- Usernames are unique (profiles_username_key), and "" counts as a value, so
-- the second person saved with a blank one was refused: an admin editing a
-- member's job title under People got "duplicate key value violates unique
-- constraint profiles_username_key". Blank is stored as null from now on,
-- whichever screen saves it, and the one existing "" was cleared.
create or replace function classroom.profiles_blank_username()
returns trigger language plpgsql as $fn$
begin
  new.username := nullif(btrim(coalesce(new.username, '')), '');
  return new;
end;
$fn$;

drop trigger if exists profiles_blank_username on classroom.profiles;
create trigger profiles_blank_username
  before insert or update of username on classroom.profiles
  for each row execute function classroom.profiles_blank_username();

update classroom.profiles set username = null where username is not null and btrim(username) = '';
