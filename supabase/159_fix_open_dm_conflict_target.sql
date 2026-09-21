-- =============================================================================
-- open_dm()'s ON CONFLICT (school_id, dm_key) never matched
-- chat_channels_dm_key_idx — confirmed live, "there is no unique or
-- exclusion constraint matching the ON CONFLICT specification" the moment
-- two people were tested starting a DM. The index is partial
-- (where dm_key is not null), and Postgres only infers a partial index for
-- conflict-target matching when the same predicate is restated in the
-- ON CONFLICT clause itself — omitting it makes Postgres look for a
-- plain, non-partial unique constraint on those columns, which doesn't
-- exist and was never going to.
-- =============================================================================

create or replace function classroom.open_dm(target_school uuid, other_user uuid)
returns classroom.chat_channels
language plpgsql
security definer
set search_path = classroom, public
as $fn$
declare
  me      uuid := auth.uid();
  key     text;
  channel classroom.chat_channels;
begin
  if me is null then
    raise exception 'You must be signed in to start a chat';
  end if;
  if other_user = me then
    raise exception 'You cannot start a DM with yourself';
  end if;

  if not exists (
    select 1 from classroom.school_members
    where school_id = target_school and user_id = me and is_active
  ) or not exists (
    select 1 from classroom.school_members
    where school_id = target_school and user_id = other_user and is_active
  ) then
    raise exception 'Both people must be active members of this school';
  end if;

  key := case when me < other_user
    then me::text || ':' || other_user::text
    else other_user::text || ':' || me::text
  end;

  insert into classroom.chat_channels (school_id, kind, dm_key, created_by)
  values (target_school, 'dm', key, me)
  on conflict (school_id, dm_key) where dm_key is not null do nothing;

  select * into channel from classroom.chat_channels
  where school_id = target_school and dm_key = key;

  insert into classroom.chat_channel_members (channel_id, user_id)
  values (channel.id, me), (channel.id, other_user)
  on conflict (channel_id, user_id) do nothing;

  return channel;
end;
$fn$;

notify pgrst, 'reload schema';
