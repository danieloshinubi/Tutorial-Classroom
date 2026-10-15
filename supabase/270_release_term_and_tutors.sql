-- Releasing a whole term at once, and the Tutors list (2026-10-15).
--
-- 1. "Release all" released one sheet per request from the browser: at a big
--    school that is hundreds of requests (leave the page half way and only
--    some are out), and every sheet notified every pupil and guardian, so a
--    family got a notice per subject. release_term_results() releases every
--    approved sheet of a term in one transaction and sends one notice per
--    pupil (and each of their guardians).
-- 2. Tutors: a teacher who teaches class subjects on the timetable (not a
--    course) showed "no subjects"; they are listed now. Staff email
--    addresses are shown to staff only, not to pupils and parents.

do $do$
declare d text;
begin
  d := replace(pg_get_functiondef('classroom.release_result_sheet(uuid,text)'::regprocedure), chr(13), '');
  d := replace(d, $a$  -- Tell the students, and every guardian attached to them.
  insert into classroom.notifications$a$, $b$  -- Tell the students, and every guardian attached to them (unless this is
  -- part of a whole-term release, which sends one notice for the lot).
  if coalesce(current_setting('classroom.quiet_release', true), '') <> 'on' then
  insert into classroom.notifications$b$);
  d := replace(d, $a$  where e.sheet_id = target_sheet
    and people.recipient is not null;

  return sheet;$a$, $b$  where e.sheet_id = target_sheet
    and people.recipient is not null;
  end if;

  return sheet;$b$);
  if position('quiet_release' in d) = 0 or position(E'people.recipient is not null;\n  end if;' in d) = 0 then
    raise exception 'release_result_sheet patch did not apply';
  end if;
  execute d;
end;
$do$;

-- Every approved sheet of a term, released together. Returns how many.
create or replace function classroom.release_term_results(target_school uuid, target_term uuid)
returns int language plpgsql security definer set search_path = classroom, public as $fn$
declare
  s record;
  released uuid[] := '{}';
  term_name text;
begin
  if not classroom.can_release_results(target_school) then
    raise exception 'Only the principal, a proprietor or an administrator can release results';
  end if;
  select t.name into term_name from classroom.terms t where t.id = target_term and t.school_id = target_school;
  if term_name is null then raise exception 'No such term'; end if;
  -- One release of a term at a time.
  perform pg_advisory_xact_lock(hashtext('release_term:' || target_school || ':' || target_term));

  perform set_config('classroom.quiet_release', 'on', true);
  for s in select id from classroom.result_sheets
            where school_id = target_school and term_id = target_term and status = 'approved'
            order by id loop
    perform classroom.release_result_sheet(s.id, 'Released with the whole term');
    released := released || s.id;
  end loop;
  perform set_config('classroom.quiet_release', 'off', true);

  if array_length(released, 1) is null then return 0; end if;

  -- One notice per pupil, and one per guardian per child.
  insert into classroom.notifications (user_id, school_id, kind, title, body, link)
  select distinct people.recipient, target_school, 'results_released',
         format('%s results published', term_name),
         format('%s results are ready to view.', term_name),
         '/Reports/' || pupils.student_id
    from (select distinct e.student_id from classroom.result_entries e where e.sheet_id = any (released)) pupils
    cross join lateral (
      select pupils.student_id as recipient
      union
      select g.guardian_id from classroom.guardian_students g where g.student_id = pupils.student_id
    ) people
   where people.recipient is not null;

  return array_length(released, 1);
end;
$fn$;
revoke execute on function classroom.release_term_results(uuid, uuid) from public, anon;
grant execute on function classroom.release_term_results(uuid, uuid) to authenticated, service_role;

/* --------------------------------------------------------------- tutors */

create or replace function classroom.school_tutors(target_school uuid)
returns table (
  id uuid,
  first_name text,
  surname text,
  username text,
  email text,
  avatar_url text,
  bio text,
  school_role text,
  courses text[]
)
language sql stable security definer set search_path = classroom, public as $fn$
  with teaching as (
    select coalesce(c.title, c.code) as label, t.uid
      from classroom.courses c
      cross join lateral classroom.course_teacher_ids(c.id) as t(uid)
     where c.school_id = target_school
    union
    -- Class subjects on the timetable: "Mathematics · JSS 2".
    select sub.name || ' · ' || cl.name, cs.teacher_id
      from classroom.class_subjects cs
      join classroom.subjects sub on sub.id = cs.subject_id
      join classroom.classes cl on cl.id = cs.class_id
     where cs.school_id = target_school and cs.teacher_id is not null
  ),
  staff as (
    select m.user_id,
           (array_agg(m.role::text order by case m.role::text
              when 'principal' then 1 when 'teacher' then 2 when 'owner' then 3 when 'admin' then 4 else 5 end))[1] as school_role
      from classroom.school_members m
     where m.school_id = target_school and m.is_active
       and m.role::text not in ('student', 'parent')
     group by m.user_id
  ),
  viewer_is_staff as (
    select exists (select 1 from classroom.school_members m
                    where m.school_id = target_school and m.user_id = auth.uid() and m.is_active
                      and m.role::text not in ('student', 'parent')) as yes
  )
  select p.id, p.first_name, p.surname, p.username,
         case when (select yes from viewer_is_staff) then p.email end,
         p.avatar_url, p.bio,
         s.school_role,
         coalesce((select array_agg(distinct t.label order by t.label) from teaching t where t.uid = p.id), '{}')
    from staff s
    join classroom.profiles p on p.id = s.user_id
   where classroom.is_member_of(target_school)
     and (s.school_role in ('teacher', 'principal')
          or exists (select 1 from teaching t where t.uid = s.user_id));
$fn$;
grant execute on function classroom.school_tutors(uuid) to authenticated;

notify pgrst, 'reload schema';
