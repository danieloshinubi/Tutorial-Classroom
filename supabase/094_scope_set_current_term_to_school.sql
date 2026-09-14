-- =============================================================================
-- Scope set_current_term() to a single school
--
-- The function looked the term up by id alone, then checked
-- is_school_admin(row_.school_id) — correctly checking THAT term's actual
-- school, but with no way to also require it be the tenant currently open.
-- An admin of more than one school could flip which term is "current" on a
-- DIFFERENT one of their schools while believing they were on the current
-- tenant, if a stale term id ever reached the client.
-- =============================================================================

drop function if exists classroom.set_current_term(uuid);

create or replace function classroom.set_current_term(target_term uuid, target_school uuid)
returns classroom.terms
language plpgsql security definer
set search_path = classroom, public as $$
declare
  row_ classroom.terms;
begin
  select * into row_ from classroom.terms
    where id = target_term and school_id = target_school;
  if row_ is null then
    raise exception 'No such term';
  end if;
  if not classroom.is_school_admin(row_.school_id) then
    raise exception 'Only a school administrator can change the term';
  end if;

  update classroom.terms set is_current = false
  where school_id = row_.school_id and is_current;

  update classroom.sessions set is_current = false
  where school_id = row_.school_id and is_current;

  update classroom.terms set is_current = true where id = target_term
  returning * into row_;

  update classroom.sessions set is_current = true where id = row_.session_id;

  return row_;
end;
$$;

grant execute on function classroom.set_current_term(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
