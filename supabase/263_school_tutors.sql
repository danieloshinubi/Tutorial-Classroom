-- The Tutors page lists the school's real teaching staff (2026-10-15).
--
-- It used to filter on profiles.role ('tutor' / 'admin'), an account-wide
-- field from before schools had their own roles. Staff a school adds are
-- 'teacher' or 'principal' in school_members but keep profiles.role
-- 'student', so a school's Tutors page showed only whoever happened to have
-- the old field set. Now: everyone who is a teacher or principal in the
-- school, plus anyone (an admin, the owner) who teaches one of its courses,
-- with the courses they teach.

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
    select c.id as course_id, coalesce(c.title, c.code) as label, t.uid
      from classroom.courses c
      cross join lateral classroom.course_teacher_ids(c.id) as t(uid)
     where c.school_id = target_school
  ),
  staff as (
    select m.user_id,
           -- Their most senior teaching role in this school.
           (array_agg(m.role::text order by case m.role::text
              when 'principal' then 1 when 'teacher' then 2 when 'owner' then 3 when 'admin' then 4 else 5 end))[1] as school_role
      from classroom.school_members m
     where m.school_id = target_school and m.is_active
       and m.role::text not in ('student', 'parent')
     group by m.user_id
  )
  select p.id, p.first_name, p.surname, p.username, p.email, p.avatar_url, p.bio,
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
