-- =============================================================================
-- Start the academic content afresh
--
-- DESTRUCTIVE AND FINAL. Deletes every course and class level for the school
-- below, and everything that hangs off them.
--
-- REMOVED
--   levels, courses
--   materials, assignments, submissions
--   messages (class chat)
--   exams, questions, options, attempts, answers, proctor event log
--   enrolments and join requests
--   notifications tied to a course
--
-- KEPT
--   every login and profile
--   the school itself, and who belongs to it
--   platform administrators
--   uploaded files still sitting in storage — see the note at the end
--
-- There is no undo. Change the slug below if you mean a different school.
-- =============================================================================

do $reset$
declare
  target_slug constant text := 'jane-nath';
  target      uuid;
  n_courses   int;
  n_levels    int;
  n_exams     int;
  n_msgs      int;
begin
  select id into target from classroom.schools where slug = target_slug;
  if target is null then
    raise exception 'No school with slug %', target_slug;
  end if;

  -- Counted before the delete so the notice reports what actually went.
  select count(*) into n_courses from classroom.courses where school_id = target;
  select count(*) into n_levels  from classroom.levels  where school_id = target;

  select count(*) into n_exams
  from classroom.exams e
  join classroom.courses c on c.id = e.course_id
  where c.school_id = target;

  select count(*) into n_msgs
  from classroom.messages m
  join classroom.courses c on c.id = m.course_id
  where c.school_id = target;

  -- Deleting the courses is enough: materials, assignments, submissions,
  -- messages, exams and everything under them cascade from here.
  delete from classroom.courses where school_id = target;

  -- Levels are only referenced by courses, which are now gone.
  delete from classroom.levels where school_id = target;

  raise notice
    'Deleted % course(s), % level(s), % exam(s) and % chat message(s) from %.',
    n_courses, n_levels, n_exams, n_msgs, target_slug;
end $reset$;

notify pgrst, 'reload schema';

-- Should both be zero.
select
  (select count(*) from classroom.courses) as courses_left,
  (select count(*) from classroom.levels)  as levels_left,
  (select count(*) from classroom.exams)   as exams_left;

-- Still there, as intended:
--   select count(*) from classroom.profiles;
--   select name, slug from classroom.schools;
--   select role, count(*) from classroom.school_members group by role;

-- =============================================================================
-- Files uploaded to the "course-materials" bucket are NOT removed by this
-- script — object storage is outside the database. They are now orphaned and
-- unreachable from the app. To clear them: Storage → course-materials →
-- select all → delete.
-- =============================================================================
