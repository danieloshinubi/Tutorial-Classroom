-- ============================================================================
-- Group participant management: promote/demote, and last-admin protection.
--
-- 158_chat.sql already shipped everything needed to ADD and REMOVE members
-- (add_chat_members / remove_chat_member, both gated on
-- is_chat_channel_admin), and chat_channel_members.role already carries the
-- 'owner'/'member' distinction those checks read. What was missing is any way
-- to CHANGE that role: the only update policy on chat_channel_members is
-- "user_id = auth.uid()", which lets someone edit their own row (last_read_at,
-- is_muted) but deliberately stops anyone editing somebody else's. So an admin
-- had no path — policy or RPC — to make a second admin. A group whose only
-- admin left was stuck that way permanently.
--
-- This adds set_chat_member_role, and closes the matching hole in
-- remove_chat_member: nothing stopped an admin removing the LAST admin (or
-- themselves as the last admin), which orphaned the group in exactly the same
-- way. Both now refuse to drop the final owner.
--
-- Admins are equal by design: any admin may promote, demote or remove any
-- other admin. The creator (chat_channels.created_by) gets no extra authority
-- — it stays a record of who opened the channel, not a permission. The single
-- invariant protecting a group is "at least one owner must remain", enforced
-- in both functions below rather than in the UI, so it holds no matter which
-- client calls them.
-- ============================================================================

/* --- promote / demote -------------------------------------------------- */

create or replace function classroom.set_chat_member_role(
  target_channel uuid,
  target_user uuid,
  new_role text
)
returns void
language plpgsql
security definer
set search_path = classroom, public
as $fn$
declare
  channel_kind text;
  owner_count int;
begin
  if not classroom.is_chat_channel_admin(target_channel) then
    raise exception 'Only a channel admin can change member roles';
  end if;

  if new_role not in ('owner', 'member') then
    raise exception 'Unknown role: %', new_role;
  end if;

  -- A DM has exactly two people and no notion of who runs it; letting a role
  -- be set there would only create a meaningless "admin" on a two-person chat.
  select kind into channel_kind from classroom.chat_channels where id = target_channel;
  if channel_kind is distinct from 'group' then
    raise exception 'Roles only apply to group channels';
  end if;

  if not exists (
    select 1 from classroom.chat_channel_members
    where channel_id = target_channel and user_id = target_user
  ) then
    raise exception 'That person is not in this group';
  end if;

  -- Demoting the last owner would leave a group nobody can administer, so it
  -- is refused here rather than trusted to the caller. Counted before the
  -- update, and only when this row is actually an owner losing that role.
  if new_role = 'member' then
    select count(*) into owner_count
    from classroom.chat_channel_members
    where channel_id = target_channel and role = 'owner';

    if owner_count <= 1 and exists (
      select 1 from classroom.chat_channel_members
      where channel_id = target_channel and user_id = target_user and role = 'owner'
    ) then
      raise exception 'A group needs at least one admin — make someone else an admin first';
    end if;
  end if;

  update classroom.chat_channel_members
  set role = new_role
  where channel_id = target_channel and user_id = target_user;
end;
$fn$;

grant execute on function classroom.set_chat_member_role(uuid, uuid, text) to authenticated;

/* --- removal: same last-admin guard ------------------------------------ */

create or replace function classroom.remove_chat_member(target_channel uuid, target_user uuid)
returns void
language plpgsql
security definer
set search_path = classroom, public
as $fn$
declare
  owner_count int;
begin
  if not classroom.is_chat_channel_admin(target_channel) then
    raise exception 'Only a channel admin can remove members';
  end if;

  -- Added in 169: previously an admin could remove the last admin (including
  -- themselves) and leave the group with nobody able to manage it.
  select count(*) into owner_count
  from classroom.chat_channel_members
  where channel_id = target_channel and role = 'owner';

  if owner_count <= 1 and exists (
    select 1 from classroom.chat_channel_members
    where channel_id = target_channel and user_id = target_user and role = 'owner'
  ) then
    raise exception 'A group needs at least one admin — make someone else an admin first';
  end if;

  delete from classroom.chat_channel_members
  where channel_id = target_channel and user_id = target_user;
end;
$fn$;

grant execute on function classroom.remove_chat_member(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
