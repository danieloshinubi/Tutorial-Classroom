-- Each school's own grading scale (2026-10-15).
--
-- Results graded every school the same way: A 70+, B 60+, C 50+, D 45+,
-- E 40+, F below (classroom.grade_for, 024). That stays as Schoolivio's
-- default, but a school's owner, admin or principal can now set its own
-- grades, the lowest mark for each, and what each means on a report
-- ("Excellent", "Credit"). A school that sets nothing keeps the default.

create table if not exists classroom.grade_bands (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references classroom.schools (id) on delete cascade,
  grade      text not null check (length(btrim(grade)) between 1 and 4),
  min_pct    numeric(5,2) not null check (min_pct between 0 and 100),
  remark     text check (remark is null or length(remark) <= 40),
  updated_by uuid references classroom.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (school_id, grade),
  unique (school_id, min_pct)
);
create index if not exists grade_bands_school_idx on classroom.grade_bands (school_id, min_pct desc);

alter table classroom.grade_bands enable row level security;
drop policy if exists grade_bands_read on classroom.grade_bands;
create policy grade_bands_read on classroom.grade_bands for select to authenticated
  using (classroom.is_member_of(school_id));
-- Written only through set_grade_bands below.
grant select on classroom.grade_bands to authenticated;

-- Who may change the scale: the owner, an admin or the principal.
create or replace function classroom.can_set_grading(target_school uuid)
returns boolean language sql stable security definer set search_path = classroom, public as $fn$
  select classroom.is_school_admin(target_school)
      or classroom.has_role_in(target_school, array['principal']::classroom.member_role[]);
$fn$;
grant execute on function classroom.can_set_grading(uuid) to authenticated;

-- Schoolivio's default scale, with what each grade means.
create or replace function classroom.default_grade_bands()
returns table (grade text, min_pct numeric, remark text) language sql immutable as $fn$
  values ('A', 70::numeric, 'Excellent'), ('B', 60, 'Very good'), ('C', 50, 'Good'),
         ('D', 45, 'Fair'), ('E', 40, 'Pass'), ('F', 0, 'Fail');
$fn$;
grant execute on function classroom.default_grade_bands() to authenticated;

-- The scale a school uses: its own, or the default.
create or replace function classroom.grade_bands_for(target_school uuid)
returns table (grade text, min_pct numeric, remark text, is_default boolean)
language sql stable security definer set search_path = classroom, public as $fn$
  select b.grade, b.min_pct, b.remark, false
    from classroom.grade_bands b
   where b.school_id = target_school and classroom.is_member_of(target_school)
  union all
  select d.grade, d.min_pct, d.remark, true
    from classroom.default_grade_bands() d
   where not exists (select 1 from classroom.grade_bands b where b.school_id = target_school)
  order by 2 desc;
$fn$;
grant execute on function classroom.grade_bands_for(uuid) to authenticated;

-- A percentage's grade at a school. Security definer so a parent reading a
-- released report gets the school's grade whatever they can read directly.
create or replace function classroom.grade_for(target_school uuid, pct numeric)
returns text language sql stable security definer set search_path = classroom, public as $fn$
  select case when pct is null then null else coalesce(
    (select b.grade from classroom.grade_bands b
      where b.school_id = target_school and b.min_pct <= pct
      order by b.min_pct desc limit 1),
    case when exists (select 1 from classroom.grade_bands b where b.school_id = target_school)
         then null else classroom.grade_for(pct) end) end;
$fn$;
grant execute on function classroom.grade_for(uuid, numeric) to authenticated;

-- Replaces the school's whole scale at once (an empty list goes back to
-- the default). Every mark must get a grade, so the lowest band starts at 0.
create or replace function classroom.set_grade_bands(target_school uuid, bands jsonb)
returns void language plpgsql security definer set search_path = classroom, public as $fn$
declare
  n int;
begin
  if not classroom.can_set_grading(target_school) then
    raise exception 'Only the owner, an admin or the principal can change the grading scale.';
  end if;
  if jsonb_typeof(bands) <> 'array' then raise exception 'The scale must be a list.'; end if;
  n := jsonb_array_length(bands);
  if n > 20 then raise exception 'A scale can have at most 20 grades.'; end if;

  if n > 0 then
    if exists (select 1 from jsonb_array_elements(bands) e
                where coalesce(btrim(e->>'grade'), '') = ''
                   or (e->>'min_pct') is null
                   or (e->>'min_pct')::numeric not between 0 and 100) then
      raise exception 'Each grade needs a name and a lowest mark from 0 to 100.';
    end if;
    if (select count(distinct upper(btrim(e->>'grade'))) from jsonb_array_elements(bands) e) <> n then
      raise exception 'Two grades have the same name.';
    end if;
    if (select count(distinct (e->>'min_pct')::numeric) from jsonb_array_elements(bands) e) <> n then
      raise exception 'Two grades start at the same mark.';
    end if;
    if (select min((e->>'min_pct')::numeric) from jsonb_array_elements(bands) e) <> 0 then
      raise exception 'The lowest grade must start at 0, so every mark gets a grade.';
    end if;
  end if;

  delete from classroom.grade_bands where school_id = target_school;
  insert into classroom.grade_bands (school_id, grade, min_pct, remark, updated_by)
  select target_school, btrim(e->>'grade'), (e->>'min_pct')::numeric,
         nullif(btrim(coalesce(e->>'remark', '')), ''), auth.uid()
    from jsonb_array_elements(bands) e;

  perform classroom.audit_write(target_school, 'grade_bands', target_school::text, 'UPDATE', auth.uid(),
    jsonb_build_object('grades', n, 'default', n = 0));
end;
$fn$;
grant execute on function classroom.set_grade_bands(uuid, jsonb) to authenticated;

-- Reports grade by the school's own scale.
do $do$
declare d text;
begin
  d := pg_get_viewdef('classroom.result_slips'::regclass, true);
  d := replace(d, 'grade_for(round(', 'grade_for(s.school_id, round(');
  if position('grade_for(s.school_id, round(' in d) = 0 then raise exception 'result_slips patch did not apply'; end if;
  execute 'create or replace view classroom.result_slips with (security_invoker = true) as ' || d;
end;
$do$;
grant select on classroom.result_slips to authenticated;

notify pgrst, 'reload schema';
