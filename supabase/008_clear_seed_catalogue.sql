-- =============================================================================
-- Remove the seeded catalogue
--
-- The original schema shipped 4 levels and 68 course codes as source data.
-- That was wrong: every tenant defines its own class levels and subjects
-- through the app, and nothing about a school's structure should live in this
-- repository.
--
-- This removes the seeded rows without touching anything a real user made.
-- Run after 007_tenancy.sql. Safe to re-run.
-- =============================================================================

/* ---------------------------------------------------------------------------
   Seeded courses are the ones with no owner — no tutor ever created them.
   A course someone actually made has owner_id set, and is left alone along
   with its materials, assignments, exams and chat.
   --------------------------------------------------------------------------- */
do $clear$
declare
  removed_courses int;
  removed_levels  int;
  kept_courses    int;
begin
  -- Refuse to run if an unowned course has real content hanging off it: that
  -- would mean someone adopted a catalogue course, and deleting it would take
  -- their work with it.
  if exists (
    select 1
    from classroom.courses c
    where c.owner_id is null
      and (
        exists (select 1 from classroom.exams       e where e.course_id = c.id)
        or exists (select 1 from classroom.materials   m where m.course_id = c.id)
        or exists (select 1 from classroom.assignments a where a.course_id = c.id)
        or exists (select 1 from classroom.messages    g where g.course_id = c.id)
      )
  ) then
    raise exception
      'A catalogue course has real content attached. Give it an owner first, or delete it by hand — this script will not destroy work.';
  end if;

  delete from classroom.courses where owner_id is null;
  get diagnostics removed_courses = row_count;

  -- Then drop only the levels nothing is using any more. A level that still
  -- carries a real course stays, because courses cascade from it.
  delete from classroom.levels l
  where not exists (
    select 1 from classroom.courses c
    where c.level_year = l.year and c.school_id = l.school_id
  );
  get diagnostics removed_levels = row_count;

  select count(*) into kept_courses from classroom.courses;

  raise notice 'Removed % seeded courses and % unused levels. % real courses kept.',
    removed_courses, removed_levels, kept_courses;
end $clear$;

/* ---------------------------------------------------------------------------
   Levels become a school's own class structure: "JSS 1", "Year 7", "Grade 4",
   "100 Level" — whatever that school actually calls it. `year` is the sort
   order and the value courses key on; `label` is what people see.
   --------------------------------------------------------------------------- */
comment on table classroom.levels is
  'Class levels, defined per school through the app. Never seeded from source.';
comment on column classroom.levels.year is
  'Sort order and the key courses reference. Any integer the school chooses.';
comment on column classroom.levels.label is
  'Display name, e.g. "JSS 1", "Year 7", "100 Level".';

notify pgrst, 'reload schema';

-- =============================================================================
-- Check what survived:
--   select l.year, l.label, count(c.*) as courses
--   from classroom.levels l
--   left join classroom.courses c
--     on c.level_year = l.year and c.school_id = l.school_id
--   group by l.school_id, l.year, l.label
--   order by l.year;
-- =============================================================================
