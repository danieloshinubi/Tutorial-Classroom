-- =============================================================================
-- Platform team access — classroom.platform_admins has existed since
-- 007_tenancy.sql as a bare (user_id, created_at) table with no RPC and no
-- UI at all: the only way to grant or revoke console access, or even see
-- who currently has it, was a raw SQL statement against the table
-- directly. As the platform team grows past one person this is both an
-- operational blocker and a quiet security gap — nobody can audit platform
-- access without querying the database.
--
-- Same shape as every other platform_* function: security definer,
-- classroom.is_platform_admin() gate, reads/writes across every tenant on
-- purpose because that is what this console is for.
-- =============================================================================

create or replace function classroom.platform_list_admins()
returns table (
  user_id     uuid,
  email       text,
  name        text,
  added_at    timestamptz
)
language sql
stable
security definer
set search_path = classroom, public
as $fn$
  select pa.user_id, p.email,
         nullif(btrim(coalesce(p.first_name,'') || ' ' || coalesce(p.surname,'')), ''),
         pa.created_at
  from classroom.platform_admins pa
  join classroom.profiles p on p.id = pa.user_id
  where classroom.is_platform_admin()
  order by pa.created_at asc;
$fn$;

grant execute on function classroom.platform_list_admins() to authenticated;

-- Grants by email, not user id — the person doing the granting knows the
-- new admin's email, not their auth uuid, and shouldn't need to go find it
-- first. Refuses silently-wrong outcomes: no such account, or an account
-- that already has access, both raise rather than doing nothing quietly.
create or replace function classroom.platform_add_admin(target_email text)
returns classroom.platform_admins
language plpgsql
security definer
set search_path = classroom, public
as $fn$
declare
  target_id uuid;
  row classroom.platform_admins;
begin
  if not classroom.is_platform_admin() then
    raise exception 'Only a platform administrator can grant console access';
  end if;

  select id into target_id from classroom.profiles where lower(email) = lower(target_email);
  if target_id is null then
    raise exception 'No account with that email exists yet — they need to sign up first';
  end if;

  if exists (select 1 from classroom.platform_admins where user_id = target_id) then
    raise exception 'That account already has platform access';
  end if;

  insert into classroom.platform_admins (user_id) values (target_id) returning * into row;
  return row;
end;
$fn$;

grant execute on function classroom.platform_add_admin(text) to authenticated;

-- A platform admin cannot revoke their own access through this function —
-- not a permissions check but a footgun guard: with no other UI to grant
-- access back, revoking your own last session's admin would need a raw SQL
-- statement to undo, exactly the thing this feature exists to get away
-- from. Revoking yourself specifically (as opposed to being revoked by
-- someone else) has to go through another admin, or SQL, on purpose.
create or replace function classroom.platform_remove_admin(target_user uuid)
returns void
language plpgsql
security definer
set search_path = classroom, public
as $fn$
begin
  if not classroom.is_platform_admin() then
    raise exception 'Only a platform administrator can revoke console access';
  end if;
  if target_user = auth.uid() then
    raise exception 'You cannot revoke your own access — ask another platform administrator to do it';
  end if;
  delete from classroom.platform_admins where user_id = target_user;
end;
$fn$;

grant execute on function classroom.platform_remove_admin(uuid) to authenticated;

-- Platform-admin grants/revokes are exactly the kind of action the new
-- platform audit log (137) exists to record — writing through the same
-- write_audit_log() trigger every tenant table already uses, with
-- school_id left null (this action belongs to no school).
drop trigger if exists audit_trg on classroom.platform_admins;
create trigger audit_trg after insert or delete on classroom.platform_admins
  for each row execute function classroom.write_audit_log();

notify pgrst, 'reload schema';
