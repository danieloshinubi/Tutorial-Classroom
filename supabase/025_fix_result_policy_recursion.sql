-- =============================================================================
-- Fix: infinite recursion detected in policy for relation "result_entries"
--
-- The family policy on result_sheets asked "does this sheet contain a row for
-- me or my child?" by selecting from result_entries — and the policies on
-- result_entries answer "is this sheet released?" by selecting from
-- result_sheets. Each policy needed the other evaluated first, so Postgres
-- refused the whole query.
--
-- The way out of a policy cycle is a SECURITY DEFINER function: it runs as the
-- table owner, so it is not itself subject to RLS, and the loop is cut. The
-- rule it enforces is unchanged.
-- =============================================================================

create or replace function classroom.is_my_family_sheet(target_sheet uuid)
returns boolean
language sql
stable
security definer
set search_path = classroom, public
as $fn$
  select exists (
    select 1
    from classroom.result_entries e
    where e.sheet_id = target_sheet
      and (
        e.student_id = auth.uid()
        or exists (
          select 1 from classroom.guardian_students g
          where g.student_id = e.student_id
            and g.guardian_id = auth.uid()
        )
      )
  );
$fn$;

grant execute on function classroom.is_my_family_sheet(uuid) to authenticated;

drop policy if exists "families read released sheets" on classroom.result_sheets;

create policy "families read released sheets"
  on classroom.result_sheets for select to authenticated
  using (status = 'released' and classroom.is_my_family_sheet(id));

notify pgrst, 'reload schema';
