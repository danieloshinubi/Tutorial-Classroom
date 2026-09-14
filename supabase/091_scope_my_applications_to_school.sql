-- =============================================================================
-- Scope my_applications() to a single school
--
-- The applicant portal calls this with no school argument at all — it
-- returns every application this person has ever started, across every
-- school, merged into one list. An applicant who applied to two schools
-- would see both schools' applications on whichever one's /Apply/Start
-- they're currently on.
-- =============================================================================

drop function if exists classroom.my_applications();

create or replace function classroom.my_applications(target_school uuid)
returns setof classroom.applications
language sql stable security definer
set search_path = classroom, public
as $fn$
  select a.*
  from classroom.applications a
  join classroom.applicant_accounts ac on ac.id = a.applicant_id
  where ac.user_id = auth.uid()
    and a.school_id = target_school
  order by a.created_at desc;
$fn$;

grant execute on function classroom.my_applications(uuid) to authenticated;

notify pgrst, 'reload schema';
