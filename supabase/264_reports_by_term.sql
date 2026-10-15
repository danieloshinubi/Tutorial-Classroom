-- Reports for one term, or one whole session (2026-10-15).
--
-- A pupil's report added up everything they had ever done: every class,
-- every year (a SS2 pupil's report still averaged in JSS1). Now a report is
-- for a period: the Reports pages pick a term (or a whole session) and only
-- that period's work, exams, stream posts and attendance count. Courses with
-- nothing in the period drop out of it.
--
-- New functions beside the old ones (which stay, unchanged, for anything
-- still calling them): student_report_in, student_marks_in and
-- report_overview_in take the period as from_at (inclusive) and to_at
-- (exclusive); both null means all time. Distinct names, not overloads, so
-- PostgREST never has to guess which one a call means.
--
-- Built from the live definitions by text patches, each checked.

create or replace function classroom.in_period(ts timestamptz, from_at timestamptz, to_at timestamptz)
returns boolean language sql immutable as $fn$
  select ts is not null and (from_at is null or ts >= from_at) and (to_at is null or ts < to_at);
$fn$;
grant execute on function classroom.in_period(timestamptz, timestamptz, timestamptz) to authenticated;

do $do$
declare
  d text;
  n int;
  task constant text := 'coalesce(a.due_at, a.created_at)';
begin
  /* ------------------------------------------------------ student_report */
  d := pg_get_functiondef('classroom.student_report(uuid,uuid)'::regprocedure);
  d := replace(d, 'classroom.student_report(target_student uuid, target_school uuid)',
                  'classroom.student_report_in(target_student uuid, target_school uuid, from_at timestamp with time zone, to_at timestamp with time zone)');
  d := replace(d, 'from classroom.assignments a
      where a.course_id = c.id)',
                  'from classroom.assignments a
      where a.course_id = c.id and classroom.in_period(' || task || ', from_at, to_at))');
  d := replace(d, 'a.course_id = c.id and s.user_id = target_student',
                  'a.course_id = c.id and s.user_id = target_student and classroom.in_period(' || task || ', from_at, to_at)');
  d := replace(d, 'e.course_id = c.id and t.user_id = target_student',
                  'e.course_id = c.id and t.user_id = target_student and classroom.in_period(t.submitted_at, from_at, to_at)');
  d := replace(d, 'm.course_id = c.id and m.user_id = target_student',
                  'm.course_id = c.id and m.user_id = target_student and classroom.in_period(m.created_at, from_at, to_at)');
  d := replace(d, 'm2.course_id = c.id and r.user_id = target_student',
                  'm2.course_id = c.id and r.user_id = target_student and classroom.in_period(m2.created_at, from_at, to_at)');
  d := replace(d, '    and classroom.can_view_student(target_student)
  order by c.code;',
                  '    and classroom.can_view_student(target_student)
    -- Only courses with something in the period.
    and ((from_at is null and to_at is null)
         or exists (select 1 from classroom.assignments a where a.course_id = c.id and classroom.in_period(' || task || ', from_at, to_at))
         or exists (select 1 from classroom.exams e where e.course_id = c.id and classroom.in_period(coalesce(e.opens_at, e.created_at), from_at, to_at))
         or exists (select 1 from classroom.exam_attempts t join classroom.exams e on e.id = t.exam_id
                     where e.course_id = c.id and t.user_id = target_student and classroom.in_period(t.submitted_at, from_at, to_at)))
  order by c.code;');
  n := (length(d) - length(replace(d, 'in_period(', ''))) / length('in_period(');
  if position('student_report_in(' in d) = 0 or n < 14 then
    raise exception 'student_report patch did not apply (% period checks)', n;
  end if;
  execute d;

  /* ------------------------------------------------------- student_marks */
  d := pg_get_functiondef('classroom.student_marks(uuid,uuid)'::regprocedure);
  d := replace(d, 'classroom.student_marks(target_student uuid, target_school uuid)',
                  'classroom.student_marks_in(target_student uuid, target_school uuid, from_at timestamp with time zone, to_at timestamp with time zone)');
  d := replace(d, '  where classroom.can_view_student(target_student)
  order by m.happened_at;',
                  '  where classroom.can_view_student(target_student)
    and ((from_at is null and to_at is null) or classroom.in_period(m.happened_at, from_at, to_at))
  order by m.happened_at;');
  if position('student_marks_in(' in d) = 0 or position('in_period(m.happened_at' in d) = 0 then
    raise exception 'student_marks patch did not apply';
  end if;
  execute d;

  /* ----------------------------------------------------- report_overview */
  d := pg_get_functiondef('classroom.report_overview(uuid)'::regprocedure);
  d := replace(d, 'classroom.report_overview(target_school uuid)',
                  'classroom.report_overview_in(target_school uuid, from_at timestamp with time zone, to_at timestamp with time zone)');
  d := replace(d, '    where a.course_id in (select distinct course_id from en)
    group by a.course_id',
                  '    where a.course_id in (select distinct course_id from en)
      and classroom.in_period(' || task || ', from_at, to_at)
    group by a.course_id');
  d := replace(d, '    join en on en.course_id = a.course_id and en.student_id = s.user_id
    group by s.user_id, a.course_id',
                  '    join en on en.course_id = a.course_id and en.student_id = s.user_id
    where classroom.in_period(' || task || ', from_at, to_at)
    group by s.user_id, a.course_id');
  d := replace(d, '    where t.submitted_at is not null
    group by t.user_id, e.course_id',
                  '    where t.submitted_at is not null and classroom.in_period(t.submitted_at, from_at, to_at)
    group by t.user_id, e.course_id');
  d := replace(d, '    join en on en.course_id = m.course_id and en.student_id = m.user_id
    group by m.user_id, m.course_id',
                  '    join en on en.course_id = m.course_id and en.student_id = m.user_id
    where classroom.in_period(m.created_at, from_at, to_at)
    group by m.user_id, m.course_id');
  d := replace(d, '    join en on en.course_id = m2.course_id and en.student_id = r.user_id
    group by r.user_id, m2.course_id',
                  '    join en on en.course_id = m2.course_id and en.student_id = r.user_id
    where classroom.in_period(m2.created_at, from_at, to_at)
    group by r.user_id, m2.course_id');
  d := replace(d, '    left join rx   on rx.student_id  = en.student_id and rx.course_id  = en.course_id
    group by en.student_id',
                  '    left join rx   on rx.student_id  = en.student_id and rx.course_id  = en.course_id
    -- Only courses with something in the period.
    where (from_at is null and to_at is null)
       or aset.n is not null or ex.sat is not null or sub.done is not null
       or exists (select 1 from classroom.exams e2 where e2.course_id = en.course_id
                   and classroom.in_period(coalesce(e2.opens_at, e2.created_at), from_at, to_at))
    group by en.student_id');
  n := (length(d) - length(replace(d, 'in_period(', ''))) / length('in_period(');
  if position('report_overview_in(' in d) = 0 or n < 6 then
    raise exception 'report_overview patch did not apply (% period checks)', n;
  end if;
  execute d;
end;
$do$;

grant execute on function classroom.student_report_in(uuid, uuid, timestamptz, timestamptz) to authenticated;
grant execute on function classroom.student_marks_in(uuid, uuid, timestamptz, timestamptz) to authenticated;
grant execute on function classroom.report_overview_in(uuid, timestamptz, timestamptz) to authenticated;

notify pgrst, 'reload schema';
