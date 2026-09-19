-- =============================================================================
-- Payment gateway operational visibility. 116/117/121 gave every school a
-- payment_gateways row and, as of this session's multi-gateway work, real
-- verification at connect time — but the platform console has never been
-- able to see any of it. Today, a school's payments silently breaking (a
-- BYO key revoked after connecting; a gateway an owner picked but never
-- actually confirmed) surfaces only when a family's payment fails and the
-- school complains. This is aggregate, non-secret status only — provider,
-- mode, whether it's been confirmed, whether it's paused — never a key,
-- same "how much, never what's inside" boundary platform_schools() already
-- draws for course counts.
-- =============================================================================

create or replace function classroom.platform_gateways()
returns table (
  school_id             uuid,
  school_name           text,
  provider              text,
  mode                  text,
  is_active             boolean,
  confirmed_at          timestamptz,
  require_confirmation  boolean
)
language sql
stable
security definer
set search_path = classroom, public
as $fn$
  select s.id, s.name, g.provider, g.mode, g.is_active, g.confirmed_at, g.require_confirmation
  from classroom.schools s
  left join classroom.payment_gateways g on g.school_id = s.id
  where classroom.is_platform_admin()
  order by s.name asc;
$fn$;

grant execute on function classroom.platform_gateways() to authenticated;

notify pgrst, 'reload schema';
