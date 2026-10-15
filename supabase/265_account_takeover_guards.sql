-- Closing the account-takeover routes found in the security review (2026-10-15).
--
-- 1. Branded password-reset emails go through a school's own mailbox, which
--    the school controls (it could point it at its own mail server). That is
--    only safe for people who belong to that school alone. Anyone else (a
--    platform admin, a member of another school, someone with no tie to the
--    school) gets Supabase's own email instead, never the school's.
--    Requests are also limited per address, so the endpoint is no relay.
-- 2. "Reset password" in School admin hands the admin a new password. It now
--    refuses people who belong to any other school (a school could otherwise
--    pull in another school's owner as a "parent" and reset them), and
--    follows rank: only an owner resets an owner, and nobody resets someone
--    above them.
-- 3. A school admin edits or deletes only profiles of people who belong to
--    their school alone.
-- 4. Nobody changes their own sign-in email, legacy role or "must change
--    password" flag from the browser; those go through the server functions
--    built for them.
-- 5. Console: only a break-glass admin grants or changes break-glass access,
--    and nobody changes their own.

-- Belongs to this school and to no other.
create or replace function classroom.only_in_school(target_user uuid, target_school uuid)
returns boolean language sql stable security definer set search_path = classroom, public as $fn$
  select exists (select 1 from classroom.school_members m
                  where m.user_id = target_user and m.school_id = target_school and m.granted_via is null)
     and not exists (select 1 from classroom.school_members m
                      where m.user_id = target_user and m.school_id <> target_school);
$fn$;
revoke execute on function classroom.only_in_school(uuid, uuid) from public, anon;
grant execute on function classroom.only_in_school(uuid, uuid) to authenticated, service_role;

/* ---------------------------------------------------------- 1. auth email */

-- May this school's own mailbox carry a sign-in link for this address?
create or replace function classroom.may_send_branded_auth_mail(target_school uuid, target_email text)
returns boolean language sql stable security definer set search_path = classroom, public, auth as $fn$
  select exists (
    select 1 from auth.users u
     where lower(u.email) = lower(btrim(target_email))
       and classroom.only_in_school(u.id, target_school)
       and exists (select 1 from classroom.school_members m
                    where m.user_id = u.id and m.school_id = target_school and m.is_active)
       and not exists (select 1 from classroom.platform_admins pa where pa.user_id = u.id)
  );
$fn$;
revoke execute on function classroom.may_send_branded_auth_mail(uuid, text) from public, anon, authenticated;
grant execute on function classroom.may_send_branded_auth_mail(uuid, text) to service_role;

create table if not exists classroom.auth_mail_requests (
  id         bigint generated always as identity primary key,
  email      text not null,
  requested_at timestamptz not null default now()
);
create index if not exists auth_mail_requests_email_idx on classroom.auth_mail_requests (email, requested_at desc);
alter table classroom.auth_mail_requests enable row level security;
revoke all on classroom.auth_mail_requests from public, anon, authenticated;

-- At most 5 sign-in emails an hour to one address. Records the request.
create or replace function classroom.auth_mail_allowed(target_email text)
returns boolean language plpgsql security definer set search_path = classroom, public as $fn$
declare
  addr text := lower(btrim(target_email));
  recent int;
begin
  delete from classroom.auth_mail_requests where requested_at < now() - interval '1 day';
  select count(*) into recent from classroom.auth_mail_requests
   where email = addr and requested_at > now() - interval '1 hour';
  if recent >= 5 then return false; end if;
  insert into classroom.auth_mail_requests (email) values (addr);
  return true;
end;
$fn$;
revoke execute on function classroom.auth_mail_allowed(text) from public, anon, authenticated;
grant execute on function classroom.auth_mail_allowed(text) to service_role;

/* ------------------------------------------------------- 2. reset password */

-- Seniority in a school: owner 1, admin 2, principal 3, everyone else 9.
create or replace function classroom.school_rank(target_school uuid, who uuid)
returns int language sql stable security definer set search_path = classroom, public as $fn$
  select coalesce(min(case m.role::text when 'owner' then 1 when 'admin' then 2 when 'principal' then 3 else 9 end), 99)
    from classroom.school_members m
   where m.school_id = target_school and m.user_id = who and m.is_active;
$fn$;
revoke execute on function classroom.school_rank(uuid, uuid) from public, anon;
grant execute on function classroom.school_rank(uuid, uuid) to authenticated, service_role;

create or replace function classroom.can_manage_member_account(target_school uuid, target_user uuid)
returns boolean language sql stable security definer set search_path = classroom, public as $fn$
  select classroom.is_school_admin(target_school)
     and classroom.only_in_school(target_user, target_school)
     and not exists (select 1 from classroom.platform_admins where user_id = target_user)
     and (
       target_user = auth.uid()
       -- An owner manages anyone; others only people below them. Someone
       -- with School admin access by module grant counts as an admin.
       or classroom.school_rank(target_school, auth.uid()) = 1
       or least(classroom.school_rank(target_school, auth.uid()), 2) < classroom.school_rank(target_school, target_user)
     );
$fn$;
revoke execute on function classroom.can_manage_member_account(uuid, uuid) from public, anon;
grant execute on function classroom.can_manage_member_account(uuid, uuid) to authenticated, service_role;

/* --------------------------------------------------------- 3. profiles */

drop policy if exists "school admins update profiles in their school" on classroom.profiles;
create policy "school admins update profiles in their school" on classroom.profiles for update to authenticated
  using (classroom.is_platform_admin()
         or (exists (select 1 from classroom.school_members m
                      where m.user_id = profiles.id and m.granted_via is null
                        and classroom.is_school_admin(m.school_id)
                        and classroom.only_in_school(profiles.id, m.school_id))
             and not exists (select 1 from classroom.platform_admins pa where pa.user_id = profiles.id)))
  with check (classroom.is_platform_admin()
         or (exists (select 1 from classroom.school_members m
                      where m.user_id = profiles.id and m.granted_via is null
                        and classroom.is_school_admin(m.school_id)
                        and classroom.only_in_school(profiles.id, m.school_id))
             and not exists (select 1 from classroom.platform_admins pa where pa.user_id = profiles.id)));

drop policy if exists "school admins delete profiles in their school" on classroom.profiles;
create policy "school admins delete profiles in their school" on classroom.profiles for delete to authenticated
  using (classroom.is_platform_admin()
         or (exists (select 1 from classroom.school_members m
                      where m.user_id = profiles.id and m.granted_via is null
                        and classroom.is_school_admin(m.school_id)
                        and classroom.only_in_school(profiles.id, m.school_id))
             and not exists (select 1 from classroom.platform_admins pa where pa.user_id = profiles.id)));

/* ---------------------------------------------- 4. sign-in fields guarded */

create or replace function classroom.profiles_guard_signin_fields()
returns trigger language plpgsql set search_path = classroom, public as $fn$
begin
  -- Direct writes from the browser only: current_user is 'authenticated'
  -- for those, and the owner for writes made inside server functions
  -- (security definer) and by the service role, which is how these fields
  -- legitimately change.
  if tg_op = 'INSERT' then
    if current_user in ('authenticated', 'anon') then
      -- Your own profile carries your real sign-in email, and no power.
      new.email := coalesce(auth.jwt() ->> 'email', new.email);
      new.role := 'student';
      new.must_change_password := false;
    end if;
    return new;
  end if;
  if current_user in ('authenticated', 'anon') then
    if new.email is distinct from old.email then
      raise exception 'A sign-in email is changed from Account settings or by the school''s admin, not here.';
    end if;
    if new.role is distinct from old.role then
      raise exception 'That cannot be changed here.';
    end if;
    if new.must_change_password is distinct from old.must_change_password then
      raise exception 'Set a new password to clear that.';
    end if;
  end if;
  return new;
end;
$fn$;
drop trigger if exists profiles_guard_signin_fields on classroom.profiles;
create trigger profiles_guard_signin_fields before insert or update on classroom.profiles
  for each row execute function classroom.profiles_guard_signin_fields();

/* ---------------------------------------------------- 5. console access */

do $do$
declare d text;
begin
  d := pg_get_functiondef('classroom.platform_grant_admin(uuid,uuid,boolean,text)'::regprocedure);
  d := replace(d, $a$  if type_in not in ('approval', 'breakglass') then raise exception 'Unknown access type'; end if;$a$,
                  $b$  if type_in not in ('approval', 'breakglass') then raise exception 'Unknown access type'; end if;
  -- Nobody changes their own console access, and only break-glass admins
  -- hand out (or alter) break-glass access.
  if target_user = actor then raise exception 'You cannot change your own console access.'; end if;
  if (type_in = 'breakglass'
      or exists (select 1 from classroom.platform_admins where user_id = target_user and access_type = 'breakglass'))
     and not exists (select 1 from classroom.platform_admins where user_id = actor and access_type = 'breakglass') then
    raise exception 'Only a break-glass administrator can grant or change break-glass access.';
  end if;$b$);
  if position('cannot change your own console access' in d) = 0 then raise exception 'platform_grant_admin patch did not apply'; end if;
  execute d;
end;
$do$;

notify pgrst, 'reload schema';
