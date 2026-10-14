-- Teachers see that pupils are waiting for them (2026-10-14).
--
-- A pupil asking to join a course sent its teacher a notification that
-- opened the course's Stream, and nothing else said anyone was waiting; the
-- requests sat under People until someone happened to look. Now:
--   * the menu shows a dot on Courses and Teach while join requests wait for
--     a course the person manages (module_attention 'courses' / 'teach');
--   * the notification opens the course's People tab (?tab=people);
--   * term results waiting on someone show on Results, not Reports: sheets
--     to approve for the principal, a proprietor or an admin; sheets sent back
--     for the teacher who has to correct them (supabase/258).

do $do$
declare d text;
begin
  d := pg_get_functiondef('classroom.module_attention(uuid)'::regprocedure);

  -- Results: under Results, and "sent back to me" for whoever teaches it.
  d := replace(d, $a$  if classroom.can_release_results(target_school) then
    select count(*) into n from classroom.result_sheets where school_id = target_school and status = 'submitted';
  else
    select count(*) into n from classroom.result_sheets
     where school_id = target_school and status = 'returned' and created_by = me;
  end if;
  if n > 0 then out := out || jsonb_build_object('reports', n); end if;$a$,
  $b$  n := 0;
  if classroom.can_release_results(target_school) then
    select count(*) into n from classroom.result_sheets where school_id = target_school and status = 'submitted';
  end if;
  select n + count(*) into n from classroom.result_sheets rs
   where rs.school_id = target_school and rs.status = 'returned'
     and (rs.created_by = me or me in (select classroom.result_sheet_teachers(rs)));
  if n > 0 then out := out || jsonb_build_object('results', n); end if;$b$);

  -- Join requests waiting for a course they run.
  d := replace(d, $a$  n := classroom.mail_unread(target_school);$a$,
  $b$  select count(*) into n from classroom.enrollments e
    join classroom.courses c on c.id = e.course_id
   where c.school_id = target_school and e.status = 'pending' and not c.archived
     and (c.owner_id = me or (c.owner_id is null and classroom.is_school_admin(target_school)));
  if n > 0 then out := out || jsonb_build_object('courses', coalesce((out ->> 'courses')::int, 0) + n, 'teach', n); end if;

  n := classroom.mail_unread(target_school);$b$);

  if position($p$jsonb_build_object('results', n)$p$ in d) = 0 or position($p$'teach', n$p$ in d) = 0 then
    raise exception 'module_attention patch did not apply';
  end if;
  execute d;

  -- The join-request notification opens the People tab.
  d := pg_get_functiondef('classroom.request_enrollment(uuid,text)'::regprocedure);
  d := replace(d, $a$      format('/Courses/%s', course.code)$a$, $b$      format('/Courses/%s?tab=people', course.code)$b$);
  if position('?tab=people' in d) = 0 then raise exception 'request_enrollment patch did not apply'; end if;
  execute d;
end;
$do$;

-- Requests already waiting point at the right tab too.
update classroom.notifications set link = link || '?tab=people'
 where kind = 'enrollment_request' and link like '/Courses/%' and link not like '%?%';
