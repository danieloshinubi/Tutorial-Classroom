-- =============================================================================
-- The school noticeboard
--
-- A class stream reaches the students on one course. This is the other thing
-- a school needs: news, events and general notices that go to everybody, or
-- to all the parents, or to staff only — and a place for them to reply,
-- because a notice about a closure or a levy always produces questions and
-- those questions are better on the notice than in thirty phone calls.
--
-- The audience is enforced in the SELECT policy, not by filtering in the app.
-- A notice addressed to staff — a salary date, a meeting about a pupil — must
-- not be one careless query away from a parent, and "the page does not show
-- it" is not the same as "they cannot read it".
-- =============================================================================

create type classroom.notice_audience as enum
  ('everyone', 'parents', 'students', 'staff');

create table classroom.notices (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null references classroom.schools (id) on delete cascade,
  title        text not null check (char_length(btrim(title)) > 0),
  body         text not null check (char_length(btrim(body)) > 0),
  audience     classroom.notice_audience not null default 'everyone',

  -- News, or something happening on a date. An event carries a when and a
  -- where; a notice does not.
  is_event     boolean not null default false,
  event_at     timestamptz,
  event_place  text,

  -- Kept at the top until taken down. For the things that matter all term.
  pinned       boolean not null default false,

  -- Drafts exist so a head can write a notice on Sunday and send it Monday.
  published_at timestamptz,

  author_id    uuid references classroom.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  edited_at    timestamptz
);

create index notices_school_idx on classroom.notices
  (school_id, pinned desc, published_at desc);

create table classroom.notice_replies (
  id         uuid primary key default gen_random_uuid(),
  notice_id  uuid not null references classroom.notices (id) on delete cascade,
  user_id    uuid not null references classroom.profiles (id) on delete cascade,
  body       text not null check (char_length(btrim(body)) > 0),
  created_at timestamptz not null default now(),
  edited_at  timestamptz
);

create index notice_replies_notice_idx on classroom.notice_replies (notice_id, created_at);

/* =============================================================================
   Who may post, and who a notice is for
   ============================================================================= */

-- News and events come from the office. A teacher has their class stream for
-- their own class; the noticeboard speaks for the school.
create or replace function classroom.can_post_notices(target_school uuid)
returns boolean
language sql stable security definer
set search_path = classroom, public
as $fn$
  select classroom.has_role_in(
    target_school,
    array['owner', 'admin', 'principal']::classroom.member_role[]
  );
$fn$;

-- Is this notice addressed to me? Runs as the owner so it can read the
-- roster without the caller needing to.
create or replace function classroom.notice_is_for_me(
  target_school uuid,
  audience classroom.notice_audience
)
returns boolean
language sql stable security definer
set search_path = classroom, public
as $fn$
  select case audience
    when 'everyone' then classroom.is_member_of(target_school)
    when 'parents'  then classroom.has_role_in(
                           target_school, array['parent']::classroom.member_role[])
    when 'students' then classroom.has_role_in(
                           target_school, array['student']::classroom.member_role[])
    when 'staff'    then classroom.has_role_in(
                           target_school,
                           array['owner','admin','principal','teacher','bursar','admissions']::classroom.member_role[])
  end;
$fn$;

grant execute on function classroom.can_post_notices(uuid) to authenticated;
grant execute on function classroom.notice_is_for_me(uuid, classroom.notice_audience) to authenticated;

alter table classroom.notices        enable row level security;
alter table classroom.notice_replies enable row level security;

-- Published, and addressed to you. Whoever may post also sees their drafts.
create policy "read notices addressed to you"
  on classroom.notices for select to authenticated
  using (
    (published_at is not null and classroom.notice_is_for_me(school_id, audience))
    or classroom.can_post_notices(school_id)
  );

create policy "the office posts notices"
  on classroom.notices for all to authenticated
  using (classroom.can_post_notices(school_id))
  with check (classroom.can_post_notices(school_id));

-- You may reply to a notice you can read, and only as yourself.
create policy "read replies on notices you can read"
  on classroom.notice_replies for select to authenticated
  using (
    exists (select 1 from classroom.notices n where n.id = notice_replies.notice_id)
  );

create policy "reply to a notice"
  on classroom.notice_replies for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from classroom.notices n
      where n.id = notice_replies.notice_id
        and n.published_at is not null
        and classroom.notice_is_for_me(n.school_id, n.audience)
    )
  );

create policy "correct your own reply"
  on classroom.notice_replies for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Your own reply, or anything on a notice you are responsible for.
create policy "remove a reply"
  on classroom.notice_replies for delete to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from classroom.notices n
      where n.id = notice_replies.notice_id and classroom.can_post_notices(n.school_id)
    )
  );

grant select, insert, update, delete on classroom.notices        to authenticated;
grant select, insert, update, delete on classroom.notice_replies to authenticated;

do $$
begin
  alter publication supabase_realtime add table classroom.notice_replies;
exception when duplicate_object then null;
end $$;

/* =============================================================================
   Publishing

   Separate from the insert so that a draft is not announced, and so the
   notification fan-out happens exactly once.
   ============================================================================= */
create or replace function classroom.publish_notice(target_notice uuid)
returns classroom.notices
language plpgsql
security definer
set search_path = classroom, public
as $fn$
declare
  n classroom.notices;
begin
  select * into n from classroom.notices where id = target_notice;
  if not found then
    raise exception 'No such notice';
  end if;

  if not classroom.can_post_notices(n.school_id) then
    raise exception 'Only the school office can publish a notice';
  end if;

  if n.published_at is not null then
    return n;
  end if;

  update classroom.notices
  set published_at = now(), updated_at = now()
  where id = target_notice
  returning * into n;

  -- Everybody it is addressed to, once each.
  insert into classroom.notifications (user_id, school_id, kind, title, body, link)
  select distinct m.user_id, n.school_id,
         case when n.is_event then 'notice_event' else 'notice_posted' end,
         n.title,
         left(n.body, 140),
         '/News'
  from classroom.school_members m
  where m.school_id = n.school_id
    and m.is_active
    and case n.audience
      when 'everyone' then true
      when 'parents'  then m.role = 'parent'
      when 'students' then m.role = 'student'
      when 'staff'    then m.role in ('owner','admin','principal','teacher','bursar','admissions')
    end
    and m.user_id <> auth.uid();

  return n;
end;
$fn$;

grant execute on function classroom.publish_notice(uuid) to authenticated;

-- A notice with its author and how busy it is, so a list does not need a
-- query per row.
create view classroom.notice_feed with (security_invoker = true) as
select
  n.id,
  n.school_id,
  n.title,
  n.body,
  n.audience,
  n.is_event,
  n.event_at,
  n.event_place,
  n.pinned,
  n.published_at,
  n.created_at,
  n.edited_at,
  n.author_id,
  coalesce(nullif(btrim(p.first_name || ' ' || p.surname), ''), p.username, p.email)
    as author_name,
  (select count(*) from classroom.notice_replies r where r.notice_id = n.id)
    as replies
from classroom.notices n
left join classroom.profiles p on p.id = n.author_id;

grant select on classroom.notice_feed to authenticated;

notify pgrst, 'reload schema';
