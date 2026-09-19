-- =============================================================================
-- News notices already "notify" everyone addressed — but only as an in-app
-- notifications row (see 101's publish_notice). This gives a new
-- notice-mail-send edge function the one thing it's missing to also email
-- them: the actual list of addresses for a notice's audience, using the
-- exact same audience filter publish_notice() already applies (everyone /
-- parents / students / staff), so the two channels never disagree about
-- who a notice was addressed to.
--
-- service_role only — this returns real email addresses in bulk, which is
-- more than any client-facing role needs even for staff who can already
-- see the membership list one row at a time.
-- =============================================================================

create or replace function classroom.notice_recipients(target_notice uuid)
returns table (email text)
language sql
security definer
set search_path = classroom, public
as $$
  select distinct p.email
  from classroom.notices n
  join classroom.school_members m on m.school_id = n.school_id
  join classroom.profiles p on p.id = m.user_id
  where n.id = target_notice
    and m.is_active
    and p.email is not null
    and case n.audience
      when 'everyone' then true
      when 'parents'  then m.role = 'parent'
      when 'students' then m.role = 'student'
      when 'staff'    then m.role in ('owner','admin','principal','teacher','bursar','admissions')
    end
    and m.user_id <> n.author_id;
$$;

revoke all on function classroom.notice_recipients(uuid) from public;
grant execute on function classroom.notice_recipients(uuid) to service_role;

notify pgrst, 'reload schema';
