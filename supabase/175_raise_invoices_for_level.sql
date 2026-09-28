-- =============================================================================
-- Fixes raise_invoices_for_class() for the two things 174 changed under it.
-- Both failures are silent-ish and would only show up as "the bulk raise did
-- nothing" or "the bulk raise blew up", with correct data underneath.
--
--   1. LEVEL SCOPING. The audience test was `st.class_id is null or <in that
--      class>`. A level-scoped structure has a null class_id, so the first
--      branch matched and it selected EVERY student in the school. raise_invoice
--      then refuses each student outside the level — and because that is an
--      exception, not a skip, the first wrong student aborts the entire loop.
--      A whole-school structure and a level-scoped one are no longer the same
--      thing and cannot share a null check.
--
--   2. THE SKIP TEST. It skipped any student already holding an invoice for the
--      term. That matched the old one-invoice-per-term rule, but 174 replaced
--      that with one invoice per STRUCTURE precisely so a WAEC charge can sit
--      beside the term fee. Left as it was, every student who had already been
--      billed their term fee would be skipped for every supplementary charge —
--      the bulk raise would report 0 and look like it had run.
--
-- Renaming it would be the honest thing (it raises for an audience now, not a
-- class) but the name is called from src/lib/api.js and a rename is a separate
-- change; the behaviour is what matters here.
-- =============================================================================

create or replace function classroom.raise_invoices_for_class(target_structure uuid)
returns integer
language plpgsql
security definer
set search_path = classroom, public
as $fn$
declare
  st    classroom.fee_structures;
  made  int := 0;
  pupil uuid;
begin
  select * into st from classroom.fee_structures where id = target_structure;
  if not found then
    raise exception 'No such fee structure';
  end if;

  if not classroom.can_do_bursary(st.school_id) then
    raise exception 'Only the bursary can raise invoices';
  end if;

  for pupil in
    select m.user_id
    from classroom.school_members m
    where m.school_id = st.school_id
      and m.is_active
      and m.role = 'student'
      and (
        -- whole school: neither a class nor a level named
        (st.class_id is null and st.level_year is null)
        -- one class
        or (st.class_id is not null and exists (
          select 1 from classroom.class_students cs
          where cs.student_id = m.user_id and cs.class_id = st.class_id
        ))
        -- one level: every class sitting in that year of this structure's session
        or (st.level_year is not null and exists (
          select 1
          from classroom.class_students cs
          join classroom.classes c on c.id = cs.class_id
          where cs.student_id = m.user_id
            and c.session_id = st.session_id
            and c.level_year = st.level_year
        ))
      )
      -- Skip only what THIS structure has already billed, matching
      -- invoices_once_per_structure. Term-wide would skip every student who
      -- already has a term fee.
      and not exists (
        select 1 from classroom.invoices i
        where i.student_id = m.user_id and i.structure_id = st.id
      )
  loop
    perform classroom.raise_invoice(target_structure, pupil);
    made := made + 1;
  end loop;

  return made;
end;
$fn$;

grant execute on function classroom.raise_invoices_for_class(uuid) to authenticated;

notify pgrst, 'reload schema';
