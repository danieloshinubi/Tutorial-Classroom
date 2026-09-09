-- =============================================================================
-- A principal may name the school's classes
--
-- classroom.levels holds the school-wide names for its classes — "JSS 1",
-- "Year 7", "Grade 4". Only owner and admin could add one, which left the
-- academic head unable to name a class.
--
-- Teachers still cannot, deliberately. A level is shared vocabulary that
-- appears in everybody's dropdown, and if every teacher can mint one you have
-- "JSS 1", "JSS1" and "Jss one" inside a week, each with its own courses
-- hanging off it. Naming the classes is an act of school administration; a
-- teacher picks from the list.
--
-- The course form was offering the control to teachers regardless, which is
-- what produced a raw "new row violates row-level security policy" on screen.
-- The form is fixed alongside this.
-- =============================================================================

drop policy if exists "school admins manage levels" on classroom.levels;

create policy "administration manages levels"
  on classroom.levels for all to authenticated
  using (
    classroom.has_role_in(
      school_id, array['owner', 'admin', 'principal']::classroom.member_role[]
    )
  )
  with check (
    classroom.has_role_in(
      school_id, array['owner', 'admin', 'principal']::classroom.member_role[]
    )
  );
