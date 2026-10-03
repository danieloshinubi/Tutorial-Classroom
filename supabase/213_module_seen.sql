-- Menu dots for what is new since someone last opened a module.
--
-- 212 covered work waiting on staff. Parents, students and everyone else also
-- need to hear about what is new for them:
--   news        notices for them that they have not seen (everyone)
--   reports     results released for them or their child since they last
--               looked (parents and students)
--   attendance  their child, or they, marked absent since they last looked
--               (parents and students)
--   courses     assignments still to hand in that are not past due (students)
-- "Since they last looked" is classroom.module_seen: the app records a visit
-- when someone opens the module, which clears its dot. Before a first visit
-- only the last 14 days count, so nobody arrives to a wall of old notices.

create table if not exists classroom.module_seen (
  school_id uuid not null references classroom.schools (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  module text not null,
  seen_at timestamptz not null default now(),
  primary key (school_id, user_id, module)
);
alter table classroom.module_seen enable row level security;
drop policy if exists "people read their own visits" on classroom.module_seen;
create policy "people read their own visits" on classroom.module_seen
  for select to authenticated using (user_id = auth.uid());
grant select on classroom.module_seen to authenticated;

create or replace function classroom.mark_module_seen(target_school uuid, target_module text)
returns void language sql security definer set search_path = classroom, public as $fn$
  insert into classroom.module_seen (school_id, user_id, module, seen_at)
  select target_school, auth.uid(), target_module, now()
   where auth.uid() is not null and classroom.is_member_of(target_school)
     and target_module in ('news', 'reports', 'attendance', 'courses')
  on conflict (school_id, user_id, module) do update set seen_at = now();
$fn$;
revoke execute on function classroom.mark_module_seen(uuid, text) from public, anon;
grant execute on function classroom.mark_module_seen(uuid, text) to authenticated;

-- When this person last opened a module here (or 14 days ago, if never).
create or replace function classroom.module_seen_at(target_school uuid, target_module text)
returns timestamptz language sql stable security definer set search_path = classroom, public as $fn$
  select coalesce(
    (select seen_at from classroom.module_seen
      where school_id = target_school and user_id = auth.uid() and module = target_module),
    now() - interval '14 days');
$fn$;
revoke execute on function classroom.module_seen_at(uuid, text) from public, anon, authenticated;

-- 212's function, plus the four above.
do $$
declare def text;
begin
  select pg_get_functiondef('classroom.module_attention(uuid)'::regprocedure) into def;
  if position('  return out;
end;' in def) = 0 then raise exception 'module_attention changed'; end if;
  def := replace(def, '  return out;
end;', $add$  -- Notices for them they have not seen, other than their own.
  select count(*) into n from classroom.notices nt
   where nt.school_id = target_school
     and nt.published_at is not null and nt.published_at <= now()
     and nt.published_at > classroom.module_seen_at(target_school, 'news')
     and nt.author_id is distinct from me
     and classroom.notice_is_for_me(target_school, nt.audience);
  if n > 0 then out := out || jsonb_build_object('news', n); end if;

  if classroom.has_role_in(target_school, array['parent', 'student']::classroom.member_role[]) then
    -- Results released for them or their child since they last looked.
    select count(distinct (s.sheet_id, s.student_id)) into n from classroom.result_slips s
     where s.school_id = target_school and s.released_at is not null
       and s.released_at > classroom.module_seen_at(target_school, 'reports')
       and (s.student_id = me or exists (
             select 1 from classroom.guardian_students g where g.student_id = s.student_id and g.guardian_id = me));
    if n > 0 then out := out || jsonb_build_object('reports', n); end if;

    -- Marked absent since they last looked.
    select count(*) into n from classroom.attendance_records a
     where a.school_id = target_school and a.status = 'absent'
       and a.created_at > classroom.module_seen_at(target_school, 'attendance')
       and (a.student_id = me or exists (
             select 1 from classroom.guardian_students g where g.student_id = a.student_id and g.guardian_id = me));
    if n > 0 then out := out || jsonb_build_object('attendance', n); end if;
  end if;

  if classroom.has_role_in(target_school, array['student']::classroom.member_role[]) then
    -- Assignments still to hand in that are not past due.
    select count(*) into n from classroom.assignments asg
      join classroom.courses c on c.id = asg.course_id and c.school_id = target_school
      join classroom.enrollments e on e.course_id = asg.course_id and e.user_id = me and e.status = 'approved'
     where (asg.due_at is null or asg.due_at >= now())
       and not exists (select 1 from classroom.submissions sb where sb.assignment_id = asg.id and sb.user_id = me);
    if n > 0 then out := out || jsonb_build_object('courses', n); end if;
  end if;

  return out;
end;$add$);
  execute def;
end $$;

notify pgrst, 'reload schema';
