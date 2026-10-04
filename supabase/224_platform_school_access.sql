-- How Schoolivio staff (console accounts, admin.schoolivio.com) get into a
-- school, chosen per account when it is created (Team → Add someone):
--
--   approval    (the default) asks each school first. From the school's own
--               address they request access with a reason; the school's
--               owners and admins are notified; one of them approves for a
--               set time (1 hour to 1 week) or declines. When the time is
--               up the access is removed automatically.
--   breakglass  may enter any school at any time. The school's owners and
--               admins are still notified every time, and it is audited.
--
-- Either way access is a real, time-limited membership as an admin of that
-- school (school_members.access_expires_at, granted_via), so every existing
-- permission rule applies to it unchanged and ends with it. has_role_in and
-- is_member_of treat it as gone the moment it expires; a job every minute
-- also removes the row itself. School admins can end it early but cannot
-- change it: the guard below refuses any edit that would make temporary
-- access permanent, or forge it.

-- 1. Account type -----------------------------------------------------------
alter table classroom.platform_admins
  add column if not exists access_type text not null default 'approval';
alter table classroom.platform_admins drop constraint if exists platform_admins_access_type_check;
alter table classroom.platform_admins
  add constraint platform_admins_access_type_check check (access_type in ('approval', 'breakglass'));

-- 2. Time-limited membership -------------------------------------------------
alter table classroom.school_members
  add column if not exists access_expires_at timestamptz,
  add column if not exists granted_via text,
  add column if not exists granted_by uuid references auth.users (id) on delete set null;
alter table classroom.school_members drop constraint if exists school_members_granted_via_check;
alter table classroom.school_members
  add constraint school_members_granted_via_check
  check ((granted_via is null and access_expires_at is null)
      or (granted_via in ('platform_breakglass', 'platform_approved') and access_expires_at is not null));
create index if not exists school_members_expiring_idx on classroom.school_members (access_expires_at) where access_expires_at is not null;

create or replace function classroom.has_role_in(target_school uuid, roles classroom.member_role[])
returns boolean language sql stable security definer set search_path = classroom, public as $fn$
  -- Membership only (a console account is not a member of any school unless
  -- it has been let in, below). Time-limited access counts until it ends.
  select target_school is not null and exists (
    select 1 from classroom.school_members
    where user_id = auth.uid()
      and school_id = target_school
      and is_active
      and (access_expires_at is null or access_expires_at > now())
      and role = any(roles)
  );
$fn$;

create or replace function classroom.is_member_of(target_school uuid)
returns boolean language sql stable security definer set search_path = classroom, public as $fn$
  select target_school is not null and exists (
    select 1 from classroom.school_members
    where user_id = auth.uid()
      and school_id = target_school
      and is_active
      and (access_expires_at is null or access_expires_at > now())
  );
$fn$;

-- Only the functions below may create or change Schoolivio access. They run
-- as the database owner (security definer); a signed-in person changing the
-- table directly runs as authenticated, and is refused. Deciding by who is
-- running the statement, not by a flag, leaves nothing a caller could set.
create or replace function classroom.school_members_platform_guard()
returns trigger language plpgsql as $fn$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' and (new.granted_via is not null or new.access_expires_at is not null) then
    raise exception 'Schoolivio access can only be given through School admin → Schoolivio access';
  end if;
  if tg_op = 'UPDATE' and (
       old.granted_via is not null
       or new.granted_via is distinct from old.granted_via
       or new.access_expires_at is distinct from old.access_expires_at) then
    raise exception 'Schoolivio access is managed under School admin → Schoolivio access; end it there instead';
  end if;
  return new;
end;
$fn$;
drop trigger if exists school_members_platform_guard on classroom.school_members;
create trigger school_members_platform_guard before insert or update on classroom.school_members
  for each row execute function classroom.school_members_platform_guard();

-- 3. Requests ------------------------------------------------------------------
create table if not exists classroom.platform_access_requests (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references classroom.schools (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  reason text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'cancelled', 'ended')),
  hours integer check (hours between 1 and 168),
  expires_at timestamptz,
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  decline_note text,
  created_at timestamptz not null default now(),
  constraint platform_access_reason check (char_length(btrim(reason)) between 3 and 500)
);
create unique index if not exists platform_access_one_pending
  on classroom.platform_access_requests (school_id, user_id) where status = 'pending';
create index if not exists platform_access_requests_school_idx on classroom.platform_access_requests (school_id, created_at desc);
create index if not exists platform_access_requests_user_idx on classroom.platform_access_requests (user_id);
create index if not exists platform_access_requests_decided_by_idx on classroom.platform_access_requests (decided_by);

-- The real owners and admins of a school (not anyone let in for a while).
create or replace function classroom.school_approvers(target_school uuid)
returns setof uuid language sql stable security definer set search_path = classroom, public as $fn$
  select distinct user_id from classroom.school_members
   where school_id = target_school and is_active and granted_via is null
     and role in ('owner', 'admin');
$fn$;
revoke all on function classroom.school_approvers(uuid) from public, anon, authenticated;

-- Is the signed-in person one of this school's own owners or admins?
create or replace function classroom.is_school_approver(target_school uuid)
returns boolean language sql stable security definer set search_path = classroom, public as $fn$
  select exists (
    select 1 from classroom.school_members
     where school_id = target_school and user_id = auth.uid() and is_active
       and granted_via is null and role in ('owner', 'admin')
  );
$fn$;
revoke all on function classroom.is_school_approver(uuid) from public, anon;
grant execute on function classroom.is_school_approver(uuid) to authenticated;

create or replace function classroom.person_label(target uuid)
returns text language sql stable security definer set search_path = classroom, public as $fn$
  select coalesce(nullif(btrim(coalesce(first_name, '') || ' ' || coalesce(surname, '')), ''), email, 'Someone')
    from classroom.profiles where id = target;
$fn$;
revoke all on function classroom.person_label(uuid) from public, anon, authenticated;

alter table classroom.platform_access_requests enable row level security;
drop policy if exists "requesters and school admins read requests" on classroom.platform_access_requests;
create policy "requesters and school admins read requests" on classroom.platform_access_requests
  for select to authenticated
  using (user_id = (select auth.uid())
         or classroom.is_school_approver(school_id));
grant select on classroom.platform_access_requests to authenticated;

drop trigger if exists audit_trg on classroom.platform_access_requests;
create trigger audit_trg after insert or update or delete on classroom.platform_access_requests
  for each row execute function classroom.write_audit_log();

-- Where a console account stands with one school, from that school's address.
-- For a break-glass account this is also how they enter: it lets them in
-- (8 hours at a time, renewed on each visit) and tells the school.
create or replace function classroom.platform_school_access(target_slug text)
returns jsonb
language plpgsql
security definer
set search_path = classroom, public
as $fn$
declare
  me uuid := auth.uid();
  pa classroom.platform_admins;
  sch classroom.schools;
  m classroom.school_members;
  req classroom.platform_access_requests;
  last_req classroom.platform_access_requests;
begin
  select * into pa from classroom.platform_admins where user_id = me;
  if not found then return jsonb_build_object('state', 'not_platform'); end if;
  select * into sch from classroom.schools where slug = lower(btrim(target_slug));
  if not found then return jsonb_build_object('state', 'no_school'); end if;

  select * into m from classroom.school_members where school_id = sch.id and user_id = me limit 1;
  if found and m.granted_via is null then
    return jsonb_build_object('state', 'member', 'mode', pa.access_type);
  end if;
  if found and m.access_expires_at > now() then
    if pa.access_type = 'breakglass' and m.granted_via = 'platform_breakglass' and m.access_expires_at < now() + interval '1 hour' then
          update classroom.school_members set access_expires_at = now() + interval '8 hours' where id = m.id returning * into m;
    end if;
    return jsonb_build_object('state', 'granted', 'mode', pa.access_type, 'expires_at', m.access_expires_at, 'school_name', sch.name);
  end if;

  if pa.access_type = 'breakglass' then
      delete from classroom.school_members where school_id = sch.id and user_id = me and granted_via is not null;
    insert into classroom.school_members (school_id, user_id, role, is_active, access_expires_at, granted_via, granted_by)
    values (sch.id, me, 'admin', true, now() + interval '8 hours', 'platform_breakglass', me)
    returning * into m;
    insert into classroom.notifications (user_id, school_id, kind, title, body, link)
    select a, sch.id, 'platform_access_breakglass',
           'Schoolivio support entered your school',
           classroom.person_label(me) || ' from Schoolivio used break-glass access to ' || sch.name
             || '. It ends at ' || to_char(m.access_expires_at at time zone coalesce(sch.timezone, 'Africa/Lagos'), 'HH24:MI on FMDD Mon') || '. You can end it now under School admin → Schoolivio access.',
           '/School?tab=access'
      from classroom.school_approvers(sch.id) a;
    return jsonb_build_object('state', 'granted', 'mode', 'breakglass', 'expires_at', m.access_expires_at, 'school_name', sch.name);
  end if;

  select * into req from classroom.platform_access_requests
   where school_id = sch.id and user_id = me and status = 'pending' limit 1;
  if found then
    return jsonb_build_object('state', 'pending', 'mode', 'approval', 'school_name', sch.name, 'requested_at', req.created_at, 'reason', req.reason);
  end if;
  select * into last_req from classroom.platform_access_requests
   where school_id = sch.id and user_id = me order by created_at desc limit 1;
  return jsonb_build_object(
    'state', 'none', 'mode', 'approval', 'school_name', sch.name,
    'last_status', last_req.status, 'last_note', last_req.decline_note, 'last_at', coalesce(last_req.decided_at, last_req.created_at));
end;
$fn$;

create or replace function classroom.request_school_access(target_slug text, reason text)
returns classroom.platform_access_requests
language plpgsql
security definer
set search_path = classroom, public
as $fn$
declare
  me uuid := auth.uid();
  pa classroom.platform_admins;
  sch classroom.schools;
  req classroom.platform_access_requests;
begin
  select * into pa from classroom.platform_admins where user_id = me;
  if not found then raise exception 'Only Schoolivio staff can request access to a school'; end if;
  select * into sch from classroom.schools where slug = lower(btrim(target_slug));
  if not found then raise exception 'There is no school at that address'; end if;
  if btrim(coalesce(reason, '')) = '' or char_length(btrim(reason)) < 3 then
    raise exception 'Say why you need access, so the school can decide';
  end if;
  if exists (select 1 from classroom.school_members where school_id = sch.id and user_id = me
              and (access_expires_at is null or access_expires_at > now())) then
    raise exception 'You already have access to this school';
  end if;
  if not exists (select 1 from classroom.school_approvers(sch.id)) then
    raise exception 'This school has no owner or admin to approve a request yet';
  end if;

  insert into classroom.platform_access_requests (school_id, user_id, reason)
  values (sch.id, me, btrim(reason))
  returning * into req;

  insert into classroom.notifications (user_id, school_id, kind, title, body, link)
  select a, sch.id, 'platform_access_request',
         classroom.person_label(me) || ' from Schoolivio is asking to access your school',
         'Reason: ' || btrim(reason) || '. Approve it for a set time, or decline, under School admin → Schoolivio access.',
         '/School?tab=access'
    from classroom.school_approvers(sch.id) a;
  return req;
exception when unique_violation then
  raise exception 'You already have a request waiting at this school';
end;
$fn$;

create or replace function classroom.cancel_school_access_request(target_slug text)
returns void language plpgsql security definer set search_path = classroom, public as $fn$
begin
  update classroom.platform_access_requests r set status = 'cancelled', decided_at = now()
    from classroom.schools s
   where s.id = r.school_id and s.slug = lower(btrim(target_slug))
     and r.user_id = auth.uid() and r.status = 'pending';
end;
$fn$;

create or replace function classroom.decide_school_access(target_request uuid, approve boolean, hours_in integer, note text default null)
returns classroom.platform_access_requests
language plpgsql
security definer
set search_path = classroom, public
as $fn$
declare
  req classroom.platform_access_requests;
  sch classroom.schools;
  ends timestamptz;
begin
  select * into req from classroom.platform_access_requests where id = target_request for update;
  if not found then raise exception 'No such request'; end if;
  if not classroom.is_school_approver(req.school_id) then
    raise exception 'Only the school''s own owner or admin can decide this';
  end if;
  if req.status <> 'pending' then raise exception 'This request has already been %', req.status; end if;
  select * into sch from classroom.schools where id = req.school_id;

  if not approve then
    update classroom.platform_access_requests
       set status = 'declined', decided_by = auth.uid(), decided_at = now(), decline_note = nullif(btrim(coalesce(note, '')), '')
     where id = req.id returning * into req;
    return req;
  end if;

  if hours_in is null or hours_in < 1 or hours_in > 168 then
    raise exception 'Choose how long, from 1 hour to 1 week';
  end if;
  ends := now() + make_interval(hours => hours_in);

  delete from classroom.school_members where school_id = req.school_id and user_id = req.user_id and granted_via is not null;
  if exists (select 1 from classroom.school_members where school_id = req.school_id and user_id = req.user_id) then
    raise exception 'That person is already a member of this school';
  end if;
  insert into classroom.school_members (school_id, user_id, role, is_active, access_expires_at, granted_via, granted_by)
  values (req.school_id, req.user_id, 'admin', true, ends, 'platform_approved', auth.uid());

  update classroom.platform_access_requests
     set status = 'approved', hours = hours_in, expires_at = ends, decided_by = auth.uid(), decided_at = now()
   where id = req.id returning * into req;

  insert into classroom.notifications (user_id, school_id, kind, title, body, link)
  values (req.user_id, req.school_id, 'platform_access_approved',
          'You can now access ' || sch.name,
          'Approved by ' || classroom.person_label(auth.uid()) || ' until '
            || to_char(ends at time zone coalesce(sch.timezone, 'Africa/Lagos'), 'HH24:MI on FMDD Mon') || '.',
          '/Dashboard');
  return req;
end;
$fn$;

-- A school admin ends someone's Schoolivio access before it runs out.
create or replace function classroom.end_school_access(target_school uuid, target_user uuid)
returns void language plpgsql security definer set search_path = classroom, public as $fn$
begin
  if not classroom.is_school_approver(target_school) then
    raise exception 'Only the school''s own owner or admin can end this';
  end if;
  delete from classroom.school_members where school_id = target_school and user_id = target_user and granted_via is not null;
  update classroom.platform_access_requests set status = 'ended'
   where school_id = target_school and user_id = target_user and status = 'approved';
end;
$fn$;

-- Removes access whose time is up (every minute, below).
create or replace function classroom.expire_school_access()
returns integer language plpgsql security definer set search_path = classroom, public as $fn$
declare n integer;
begin
  delete from classroom.school_members where granted_via is not null and access_expires_at <= now();
  get diagnostics n = row_count;
  update classroom.platform_access_requests set status = 'ended'
   where status = 'approved' and expires_at <= now();
  return n;
end;
$fn$;
revoke all on function classroom.expire_school_access() from public, anon, authenticated;

-- The console sets an account's type (never its own).
create or replace function classroom.platform_set_access_type(target_user uuid, type_in text)
returns void language plpgsql security definer set search_path = classroom, public as $fn$
begin
  if not classroom.is_platform_admin() then raise exception 'Only a platform administrator can change this'; end if;
  if target_user = auth.uid() then raise exception 'Someone else on the team has to change your own access'; end if;
  if type_in not in ('approval', 'breakglass') then raise exception 'Unknown access type'; end if;
  update classroom.platform_admins set access_type = type_in where user_id = target_user;
end;
$fn$;

-- The console's team list, now with each account's type.
drop function if exists classroom.platform_list_admins();
create function classroom.platform_list_admins()
returns table (user_id uuid, email text, name text, added_at timestamptz, access_type text)
language sql stable security definer set search_path = classroom, public as $fn$
  select pa.user_id, p.email,
         nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.surname, '')), ''),
         pa.created_at, pa.access_type
    from classroom.platform_admins pa
    join classroom.profiles p on p.id = pa.user_id
   where classroom.is_platform_admin()
   order by pa.created_at asc;
$fn$;

-- Creating a console account now records its type too.
drop function if exists classroom.platform_grant_admin(uuid, uuid, boolean);
create or replace function classroom.platform_grant_admin(target_user uuid, actor uuid, is_new boolean, type_in text default 'approval')
returns void language plpgsql security definer set search_path = classroom, public as $fn$
begin
  if not exists (select 1 from classroom.platform_admins where user_id = actor) then
    raise exception 'Only a platform administrator can add someone to the console';
  end if;
  if type_in not in ('approval', 'breakglass') then raise exception 'Unknown access type'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', actor, 'role', 'authenticated')::text, true);
  insert into classroom.platform_admins (user_id, access_type) values (target_user, type_in)
  on conflict (user_id) do update set access_type = excluded.access_type;
  if is_new then
    update classroom.profiles set must_change_password = true where id = target_user;
  end if;
end;
$fn$;
revoke all on function classroom.platform_grant_admin(uuid, uuid, boolean, text) from public, anon, authenticated;
grant execute on function classroom.platform_grant_admin(uuid, uuid, boolean, text) to service_role;

revoke all on function classroom.platform_school_access(text) from public, anon;
revoke all on function classroom.request_school_access(text, text) from public, anon;
revoke all on function classroom.cancel_school_access_request(text) from public, anon;
revoke all on function classroom.decide_school_access(uuid, boolean, integer, text) from public, anon;
revoke all on function classroom.end_school_access(uuid, uuid) from public, anon;
revoke all on function classroom.platform_set_access_type(uuid, text) from public, anon;
revoke all on function classroom.platform_list_admins() from public, anon;
grant execute on function classroom.platform_school_access(text), classroom.request_school_access(text, text),
  classroom.cancel_school_access_request(text), classroom.decide_school_access(uuid, boolean, integer, text),
  classroom.end_school_access(uuid, uuid), classroom.platform_set_access_type(uuid, text),
  classroom.platform_list_admins() to authenticated;

-- 4. Every minute, access whose time is up is removed.
select cron.unschedule('schoolivio-expire-school-access')
 where exists (select 1 from cron.job where jobname = 'schoolivio-expire-school-access');
select cron.schedule('schoolivio-expire-school-access', '* * * * *', $job$ select classroom.expire_school_access(); $job$);

notify pgrst, 'reload schema';

-- A school's requests, with who asked and who decided, for its own owners
-- and admins (the requester is not a member, so their name cannot be read
-- through the roster).
create or replace function classroom.school_access_requests(target_school uuid)
returns table (
  id uuid, user_id uuid, requester_name text, requester_email text, reason text, status text,
  hours integer, expires_at timestamptz, decided_by_name text, decided_at timestamptz,
  decline_note text, created_at timestamptz)
language sql stable security definer set search_path = classroom, public as $fn$
  select r.id, r.user_id, classroom.person_label(r.user_id), p.email, r.reason, r.status,
         r.hours, r.expires_at, case when r.decided_by is not null then classroom.person_label(r.decided_by) end,
         r.decided_at, r.decline_note, r.created_at
    from classroom.platform_access_requests r
    left join classroom.profiles p on p.id = r.user_id
   where r.school_id = target_school
     -- The school's own owners and admins, not support staff let in for a while.
     and classroom.is_school_approver(target_school)
   order by r.created_at desc
   limit 100;
$fn$;
revoke all on function classroom.school_access_requests(uuid) from public, anon;
grant execute on function classroom.school_access_requests(uuid) to authenticated;
notify pgrst, 'reload schema';

-- A school manages its own people's logins (password resets, email changes,
-- 070, 214), never a Schoolivio console account's, even one let in for
-- support. Otherwise a school admin could take over a Schoolivio account,
-- and with break-glass, every school.
create or replace function classroom.can_manage_member_account(target_school uuid, target_user uuid)
returns boolean
language sql stable security definer
set search_path = classroom, public as $fn$
  select classroom.is_school_admin(target_school)
     and exists (
       select 1 from classroom.school_members
        where school_id = target_school and user_id = target_user and granted_via is null
     )
     and not exists (select 1 from classroom.platform_admins where user_id = target_user);
$fn$;
notify pgrst, 'reload schema';

-- Likewise a school admin edits its own members' profiles, not a Schoolivio
-- console account's (the "must change password" flag lives there too).
alter policy "school admins update profiles in their school" on classroom.profiles
  using (
    classroom.is_platform_admin()
    or (
      exists (select 1 from classroom.school_members m
               where m.user_id = profiles.id and m.granted_via is null and classroom.is_school_admin(m.school_id))
      and not exists (select 1 from classroom.platform_admins pa where pa.user_id = profiles.id)
    )
  )
  with check (
    classroom.is_platform_admin()
    or (
      exists (select 1 from classroom.school_members m
               where m.user_id = profiles.id and m.granted_via is null and classroom.is_school_admin(m.school_id))
      and not exists (select 1 from classroom.platform_admins pa where pa.user_id = profiles.id)
    )
  );
