-- =============================================================================
-- Adopt the catalogue courses worth keeping, then clear the rest
--
-- Run this after looking at 008a. It gives an owner to any unowned course that
-- has real work attached — so 008's guard is satisfied and that work survives
-- — then removes the remaining empty catalogue rows.
--
-- Set the owner below to whoever should hold those courses.
-- =============================================================================

do $adopt$
declare
  new_owner uuid;
  adopted   int;
  removed_courses int;
  removed_levels  int;
begin
  -- Whoever runs the school. Change the email if it should be someone else.
  select id into new_owner
  from classroom.profiles
  where email = 'danieloshinubi@gmail.com';

  if new_owner is null then
    raise exception 'No profile with that email — edit the address at the top of this script.';
  end if;

  -- Anything unowned that carries real work becomes a proper course.
  update classroom.courses c
  set owner_id = new_owner
  where c.owner_id is null
    and (
      exists (select 1 from classroom.exams       e where e.course_id = c.id)
      or exists (select 1 from classroom.materials   m where m.course_id = c.id)
      or exists (select 1 from classroom.assignments a where a.course_id = c.id)
      or exists (select 1 from classroom.messages    g where g.course_id = c.id)
    );
  get diagnostics adopted = row_count;

  -- The rest of the catalogue was never touched by anyone.
  delete from classroom.courses where owner_id is null;
  get diagnostics removed_courses = row_count;

  delete from classroom.levels l
  where not exists (
    select 1 from classroom.courses c
    where c.level_year = l.year and c.school_id = l.school_id
  );
  get diagnostics removed_levels = row_count;

  raise notice
    'Adopted % course(s), removed % empty catalogue course(s) and % unused level(s).',
    adopted, removed_courses, removed_levels;
end $adopt$;

notify pgrst, 'reload schema';

-- What is left:
select l.year, l.label, count(c.*) as courses
from classroom.levels l
left join classroom.courses c
  on c.level_year = l.year and c.school_id = l.school_id
group by l.school_id, l.year, l.label
order by l.year;
