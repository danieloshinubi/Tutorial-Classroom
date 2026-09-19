-- =============================================================================
-- One search box for the console's own topbar — "which school is this
-- person in" is a real support-call question today's UI has no answer for
-- beyond opening every school in turn. Matches on a school's own
-- name/slug, or a member's name/email — returning which SCHOOL that
-- person belongs to, never their other data. Same boundary as every other
-- platform_* function: enough to route a support call, nothing about what
-- that person or school actually did inside their tenant.
-- =============================================================================

create or replace function classroom.platform_search(query text)
returns table (
  school_id    uuid,
  school_name  text,
  school_slug  text,
  matched_on   text
)
language sql
stable
security definer
set search_path = classroom, public
as $fn$
  select distinct on (s.id) s.id, s.name, s.slug,
    case
      when s.name ilike '%' || query || '%' or s.slug ilike '%' || query || '%' then 'school'
      else p.email
    end
  from classroom.schools s
  left join classroom.school_members m on m.school_id = s.id
  left join classroom.profiles p on p.id = m.user_id
    and (p.email ilike '%' || query || '%'
      or (p.first_name || ' ' || p.surname) ilike '%' || query || '%')
  where classroom.is_platform_admin()
    and length(btrim(coalesce(query, ''))) >= 2
    and (
      s.name ilike '%' || query || '%'
      or s.slug ilike '%' || query || '%'
      or p.id is not null
    )
  order by s.id, (s.name ilike '%' || query || '%') desc
  limit 10;
$fn$;

grant execute on function classroom.platform_search(text) to authenticated;

notify pgrst, 'reload schema';
