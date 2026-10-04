-- Console accounts created the way a school creates its staff's accounts
-- (Platform → Team → Add someone): name and email in, an account made on the
-- spot with a temporary password shown once, replaced at first sign-in.
--
-- The platform-create-admin Edge Function does it (only the Auth Admin API
-- can create a login with a chosen password). These are the database steps
-- it calls with the service role, never the browser:
--   platform_user_by_email  the id of an existing account, if any
--   platform_grant_admin    console access for that account and the temporary
--                           password flag when the account is new; the audit
--                           trigger on platform_admins records who granted it

create or replace function classroom.platform_user_by_email(target_email text)
returns uuid
language sql
stable
security definer
set search_path = classroom, public
as $fn$
  select id from auth.users where lower(email) = lower(btrim(target_email)) limit 1;
$fn$;

create or replace function classroom.platform_grant_admin(target_user uuid, actor uuid, is_new boolean)
returns void
language plpgsql
security definer
set search_path = classroom, public
as $fn$
begin
  if not exists (select 1 from classroom.platform_admins where user_id = actor) then
    raise exception 'Only a platform administrator can add someone to the console';
  end if;

  -- Act as the admin who asked, so the audit trigger on platform_admins
  -- (136) records them as the one who granted access.
  perform set_config('request.jwt.claims', json_build_object('sub', actor, 'role', 'authenticated')::text, true);

  insert into classroom.platform_admins (user_id) values (target_user)
  on conflict (user_id) do nothing;

  if is_new then
    update classroom.profiles set must_change_password = true where id = target_user;
  end if;
end;
$fn$;

revoke all on function classroom.platform_user_by_email(text) from public, anon, authenticated;
revoke all on function classroom.platform_grant_admin(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function classroom.platform_user_by_email(text) to service_role;
grant execute on function classroom.platform_grant_admin(uuid, uuid, boolean) to service_role;

notify pgrst, 'reload schema';
