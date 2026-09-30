-- =============================================================================
-- Who can see whom.
--
-- Until now any member of a school could read every other member's profile
-- (name, email, username) and the whole roster. That suits staff, who run
-- the school, but it meant any parent could list every other family's
-- parents and children with their email addresses. Found through the AI
-- assistant, which only shows what the database allows: the gap was in the
-- rules, so it is closed here, for every page and the assistant at once.
--
-- Staff (any role other than parent and student) still see everyone in the
-- schools they work in. A parent or student sees:
--   * themselves;
--   * the school's staff;
--   * their own family: a parent their children, a child their parents, and
--     the other parents of the same child;
--   * classmates, and people on the same course (course discussions show
--     their names);
--   * anyone they share a chat with;
--   * anyone who replied to or reacted on the school's news, which is posted
--     for the whole school to read.
-- =============================================================================

create or replace function classroom.can_see_person(target uuid)
returns boolean
language sql
stable
security definer
set search_path = classroom, public
as $fn$
  select target is not null and (
    target = auth.uid()
    or classroom.is_platform_admin()
    -- Staff see everyone in the schools they work in.
    or exists (
      select 1
        from classroom.school_members mine
        join classroom.school_members theirs on theirs.school_id = mine.school_id
       where mine.user_id = auth.uid() and mine.is_active
         and mine.role not in ('parent', 'student')
         and theirs.user_id = target
    )
    -- Everyone sees the staff of their own schools.
    or exists (
      select 1
        from classroom.school_members mine
        join classroom.school_members theirs on theirs.school_id = mine.school_id
       where mine.user_id = auth.uid() and mine.is_active
         and theirs.user_id = target
         and theirs.role not in ('parent', 'student')
    )
    -- Family.
    or exists (
      select 1 from classroom.guardian_students g
       where (g.guardian_id = auth.uid() and g.student_id = target)
          or (g.student_id = auth.uid() and g.guardian_id = target)
    )
    or exists (
      select 1
        from classroom.guardian_students a
        join classroom.guardian_students b on b.student_id = a.student_id
       where a.guardian_id = auth.uid() and b.guardian_id = target
    )
    -- Classmates and course-mates.
    or exists (
      select 1
        from classroom.class_students a
        join classroom.class_students b on b.class_id = a.class_id
       where a.student_id = auth.uid() and b.student_id = target
    )
    or exists (
      select 1
        from classroom.enrollments a
        join classroom.enrollments b on b.course_id = a.course_id
       where a.user_id = auth.uid() and b.user_id = target
    )
    -- People they chat with.
    or exists (
      select 1
        from classroom.chat_channel_members a
        join classroom.chat_channel_members b on b.channel_id = a.channel_id
       where a.user_id = auth.uid() and b.user_id = target
    )
    -- People who took part, in public, in the school's news.
    or exists (
      select 1
        from classroom.notice_replies r
        join classroom.notices n on n.id = r.notice_id
       where r.user_id = target and classroom.is_member_of(n.school_id)
    )
    or exists (
      select 1
        from classroom.notice_reactions r
        join classroom.notices n on n.id = r.notice_id
       where r.user_id = target and classroom.is_member_of(n.school_id)
    )
  );
$fn$;

grant execute on function classroom.can_see_person(uuid) to authenticated;

drop policy if exists "profiles are readable by people who share a school" on classroom.profiles;
create policy "profiles are readable by people who share a school"
  on classroom.profiles for select to authenticated
  using (classroom.can_see_person(id));

drop policy if exists "members read the roster" on classroom.school_members;
create policy "members read the roster"
  on classroom.school_members for select to authenticated
  using (user_id = auth.uid() or (classroom.is_member_of(school_id) and classroom.can_see_person(user_id)));

notify pgrst, 'reload schema';
