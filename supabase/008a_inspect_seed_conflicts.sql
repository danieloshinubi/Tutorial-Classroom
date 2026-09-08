-- =============================================================================
-- Which catalogue courses have real work attached?
--
-- Read-only. Run this when 008 refuses, to see exactly what it was protecting.
-- =============================================================================

select
  c.code,
  c.title,
  c.level_year                                                    as level,
  (select count(*) from classroom.exams       e where e.course_id = c.id) as exams,
  (select count(*) from classroom.materials   m where m.course_id = c.id) as materials,
  (select count(*) from classroom.assignments a where a.course_id = c.id) as assignments,
  (select count(*) from classroom.messages    g where g.course_id = c.id) as messages,
  (select count(*) from classroom.enrollments n where n.course_id = c.id) as enrolments
from classroom.courses c
where c.owner_id is null
  and (
    exists (select 1 from classroom.exams       e where e.course_id = c.id)
    or exists (select 1 from classroom.materials   m where m.course_id = c.id)
    or exists (select 1 from classroom.assignments a where a.course_id = c.id)
    or exists (select 1 from classroom.messages    g where g.course_id = c.id)
  )
order by c.code;
