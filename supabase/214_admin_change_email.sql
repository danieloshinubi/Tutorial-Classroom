-- A school's owner or admin changes the email address another person signs
-- in with (School admin → People → Edit). Done by the admin-change-email
-- Edge Function, because only the Auth Admin API can change someone else's
-- login; these are the checks it asks first and the record it writes after.
--
-- Refused when:
--   * the caller does not administer that person at this school
--     (can_manage_member_account, 070);
--   * the person is the school's owner and the caller is not an owner, so an
--     admin cannot take over the proprietor's sign-in;
--   * the person also belongs to another school: their login is shared, so
--     one school must not change it for the other. They change it
--     themselves under Account settings.

create or replace function classroom.email_change_blocker(target_school uuid, target_user uuid)
returns text
language sql stable security definer set search_path = classroom, public as $fn$
  select case
    when not classroom.can_manage_member_account(target_school, target_user)
      then 'You do not administer that person''s account at this school.'
    when exists (select 1 from classroom.school_members
                  where school_id = target_school and user_id = target_user and role = 'owner')
     and not classroom.has_role_in(target_school, array['owner']::classroom.member_role[])
      then 'Only an owner can change the proprietor''s email address.'
    when exists (select 1 from classroom.school_members
                  where user_id = target_user and school_id <> target_school)
      then 'This person also belongs to another school, so they must change their email themselves under Account settings.'
    else null
  end;
$fn$;
revoke all on function classroom.email_change_blocker(uuid, uuid) from public, anon;
grant execute on function classroom.email_change_blocker(uuid, uuid) to authenticated;

-- After the login is changed: the profile follows, and the audit log says who
-- changed it from what to what (profiles is not audited by the generic
-- trigger, and auth.users is outside this schema).
create or replace function classroom.record_email_change(
  target_school uuid, target_user uuid, actor uuid, old_email text, new_email text)
returns void
language plpgsql security definer set search_path = classroom, public as $fn$
declare
  actor_name text;
  actor_role_val text;
begin
  update classroom.profiles set email = lower(btrim(new_email)) where id = target_user;

  select coalesce(nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.surname, '')), ''), p.username, p.email)
    into actor_name from classroom.profiles p where p.id = actor;
  select string_agg(distinct m.role::text, ', ' order by m.role::text)
    into actor_role_val from classroom.school_members m
   where m.user_id = actor and m.school_id = target_school and m.is_active;

  insert into classroom.audit_log
    (school_id, table_name, record_id, action, actor_id, actor_label, actor_role, old_data, new_data, changed_fields)
  values
    (target_school, 'account_security', target_user::text, 'UPDATE', actor,
     coalesce(actor_name, 'Anonymous / system'), actor_role_val,
     jsonb_build_object('email', old_email), jsonb_build_object('event', 'email_changed', 'email', lower(btrim(new_email))),
     array['email']);
end;
$fn$;
revoke all on function classroom.record_email_change(uuid, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function classroom.record_email_change(uuid, uuid, uuid, text, text) to service_role;

notify pgrst, 'reload schema';
