-- =============================================================================
-- Closing phase 01
--
-- Two things were left half-done: people who sign themselves up never became
-- members of the school whose subdomain they used, and the vendor had no way
-- to create a school.
--
-- Run after 010. Safe to re-run.
-- =============================================================================

/* ---------------------------------------------------------------------------
   Whether a school takes self-registration at all. A school that adds its
   pupils by hand turns this off and the signup form stops offering itself.
   --------------------------------------------------------------------------- */
alter table classroom.schools
  add column if not exists allow_self_signup boolean not null default true;

/* ---------------------------------------------------------------------------
   Joining a school

   Membership is inserted by a definer function rather than a policy, because
   a person joining cannot already be an administrator of the school they are
   joining — the chicken-and-egg that left new signups with no membership.

   Always joins as a student. Nobody self-selects into staff.
   --------------------------------------------------------------------------- */
create or replace function classroom.join_school(target_slug text)
returns classroom.school_members
language plpgsql security definer
set search_path = classroom, public as $$
declare
  school classroom.schools;
  row_   classroom.school_members;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  select * into school from classroom.schools where slug = target_slug;
  if school is null then
    raise exception 'No school at %', target_slug;
  end if;
  if not school.is_active then
    raise exception 'That school is not active';
  end if;

  select * into row_ from classroom.school_members
  where school_id = school.id and user_id = auth.uid();

  -- Already a member: hand back what they have rather than resetting a role
  -- an administrator may have set.
  if row_ is not null then
    return row_;
  end if;

  if not school.allow_self_signup then
    raise exception 'This school adds its members by invitation only';
  end if;

  insert into classroom.school_members (school_id, user_id, role)
  values (school.id, auth.uid(), 'student')
  returning * into row_;

  return row_;
end;
$$;

grant execute on function classroom.join_school(text) to authenticated;

/* ---------------------------------------------------------------------------
   Creating a school — the vendor's job, so it runs as definer and makes the
   caller its owner in the same breath.
   --------------------------------------------------------------------------- */
create or replace function classroom.create_school(
  school_name text,
  school_slug text,
  owner_email text default null
)
returns classroom.schools
language plpgsql security definer
set search_path = classroom, public as $$
declare
  created classroom.schools;
  owner   uuid;
begin
  if not classroom.is_platform_admin() then
    raise exception 'Only platform administrators can create a school';
  end if;

  insert into classroom.schools (name, slug)
  values (btrim(school_name), lower(btrim(school_slug)))
  returning * into created;

  -- Hand it to the named owner if that account exists, otherwise to whoever
  -- created it, so a new school is never left without an administrator.
  if owner_email is not null then
    select id into owner from classroom.profiles where email = lower(btrim(owner_email));
  end if;

  insert into classroom.school_members (school_id, user_id, role)
  values (created.id, coalesce(owner, auth.uid()), 'owner')
  on conflict (school_id, user_id) do update set role = 'owner';

  return created;
end;
$$;

grant execute on function classroom.create_school(text, text, text) to authenticated;

/* ---------------------------------------------------------------------------
   The vendor's overview. Counts only — the platform console shows how big a
   school is, never what is inside it.
   --------------------------------------------------------------------------- */
create or replace function classroom.platform_schools()
returns table (
  id           uuid,
  name         text,
  slug         text,
  plan         text,
  is_active    boolean,
  created_at   timestamptz,
  members      int,
  students     int,
  teachers     int,
  courses      int
)
language sql stable security definer
set search_path = classroom, public as $$
  select
    s.id, s.name, s.slug, s.plan, s.is_active, s.created_at,
    (select count(*)::int from classroom.school_members m
      where m.school_id = s.id and m.is_active),
    (select count(*)::int from classroom.school_members m
      where m.school_id = s.id and m.is_active and m.role = 'student'),
    (select count(*)::int from classroom.school_members m
      where m.school_id = s.id and m.is_active and m.role = 'teacher'),
    (select count(*)::int from classroom.courses c where c.school_id = s.id)
  from classroom.schools s
  where classroom.is_platform_admin()
  order by s.created_at desc;
$$;

grant execute on function classroom.platform_schools() to authenticated;

grant select, insert, update, delete on all tables in schema classroom to authenticated;

notify pgrst, 'reload schema';
