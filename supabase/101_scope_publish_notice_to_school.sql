-- =============================================================================
-- Scope publish_notice() to the caller's current school
-- Same class of gap as the admissions RPCs fixed in 095-100: can_post_notices
-- checks the notice's real school, blind to which tenant is currently open.
-- =============================================================================

drop function if exists classroom.publish_notice(uuid);

create or replace function classroom.publish_notice(target_notice uuid, target_school uuid)
returns classroom.notices
language plpgsql
security definer
set search_path = classroom, public
as $fn$
declare
  n classroom.notices;
begin
  select * into n from classroom.notices where id = target_notice;
  if not found then
    raise exception 'No such notice';
  end if;

  if n.school_id <> target_school then
    raise exception 'This notice does not belong to the current school';
  end if;

  if not classroom.can_post_notices(n.school_id) then
    raise exception 'Only the school office can publish a notice';
  end if;

  if n.published_at is not null then
    return n;
  end if;

  update classroom.notices
  set published_at = now(), updated_at = now()
  where id = target_notice
  returning * into n;

  -- Everybody it is addressed to, once each.
  insert into classroom.notifications (user_id, school_id, kind, title, body, link)
  select distinct m.user_id, n.school_id,
         case when n.is_event then 'notice_event' else 'notice_posted' end,
         n.title,
         left(n.body, 140),
         '/News'
  from classroom.school_members m
  where m.school_id = n.school_id
    and m.is_active
    and case n.audience
      when 'everyone' then true
      when 'parents'  then m.role = 'parent'
      when 'students' then m.role = 'student'
      when 'staff'    then m.role in ('owner','admin','principal','teacher','bursar','admissions')
    end
    and m.user_id <> auth.uid();

  return n;
end;
$fn$;

grant execute on function classroom.publish_notice(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
