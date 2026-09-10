-- =============================================================================
-- Reactions
--
-- Not every student knows what to write. A quiet one who reads the post and
-- taps 👍 has taken part; the platform simply could not see it before, and
-- their contribution score read zero next to a classmate who wrote "ok" three
-- times.
--
-- So reactions count toward participation — but at a fraction of a written
-- comment, because they are worth less and pretending otherwise would just
-- move the gaming from typing "ok" to tapping a thumb. The weighting lives in
-- src/lib/analysis.js where the rest of the scoring is; this file only counts
-- them honestly.
--
-- Two tables rather than one polymorphic table. A single reactions table with
-- target_type / target_id cannot have a foreign key, so a deleted post would
-- leave its reactions behind forever and nothing in the database would object.
-- Two tables keep the cascade and let each one reuse the visibility rules
-- that already exist for the thing being reacted to.
-- =============================================================================

-- A fixed palette, enforced here rather than in the page.
--
-- Free-form emoji would let anyone put anything on a teacher's post, and
-- moderating that is not a job a school wants. It also keeps the aggregation
-- tidy: eight columns of counts, not a long tail of one-offs.
create or replace function classroom.is_allowed_reaction(symbol text)
returns boolean
language sql
immutable
as $fn$
  select symbol in ('👍', '❤️', '🎉', '👏', '😂', '😮', '🤔', '✅');
$fn$;

grant execute on function classroom.is_allowed_reaction(text) to authenticated;

create table classroom.message_reactions (
  id         uuid primary key default gen_random_uuid(),
  message_id uuid not null references classroom.messages (id) on delete cascade,
  user_id    uuid not null references classroom.profiles (id) on delete cascade,
  emoji      text not null check (classroom.is_allowed_reaction(emoji)),
  created_at timestamptz not null default now(),
  -- One of each emoji per person per post: you may add 👍 and 🎉, but not 👍
  -- twice. Tapping it again removes it, which is a delete rather than a
  -- second row.
  constraint message_reactions_once unique (message_id, user_id, emoji)
);

create index message_reactions_message_idx on classroom.message_reactions (message_id);
create index message_reactions_user_idx    on classroom.message_reactions (user_id);

create table classroom.notice_reactions (
  id         uuid primary key default gen_random_uuid(),
  notice_id  uuid not null references classroom.notices (id) on delete cascade,
  user_id    uuid not null references classroom.profiles (id) on delete cascade,
  emoji      text not null check (classroom.is_allowed_reaction(emoji)),
  created_at timestamptz not null default now(),
  constraint notice_reactions_once unique (notice_id, user_id, emoji)
);

create index notice_reactions_notice_idx on classroom.notice_reactions (notice_id);

alter table classroom.message_reactions enable row level security;
alter table classroom.notice_reactions  enable row level security;

/* --- who may react ---------------------------------------------------------
   Exactly whoever may read the thing. The messages policies already scope a
   stream to course members, and a notice to its audience, so these lean on
   the same helpers rather than restating the rule and drifting from it.
   -------------------------------------------------------------------------- */

create policy "read reactions on posts you can see"
  on classroom.message_reactions for select to authenticated
  using (
    exists (select 1 from classroom.messages m where m.id = message_reactions.message_id)
  );

create policy "react to a post you can see"
  on classroom.message_reactions for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from classroom.messages m
      where m.id = message_reactions.message_id
        and (classroom.is_enrolled_in(m.course_id) or classroom.can_manage_course(m.course_id))
    )
  );

-- Tapping it again takes it back. Only your own.
create policy "take back your own reaction"
  on classroom.message_reactions for delete to authenticated
  using (user_id = auth.uid());

create policy "read reactions on notices you can see"
  on classroom.notice_reactions for select to authenticated
  using (
    exists (select 1 from classroom.notices n where n.id = notice_reactions.notice_id)
  );

create policy "react to a notice addressed to you"
  on classroom.notice_reactions for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from classroom.notices n
      where n.id = notice_reactions.notice_id
        and n.published_at is not null
        and classroom.notice_is_for_me(n.school_id, n.audience)
    )
  );

create policy "take back your own notice reaction"
  on classroom.notice_reactions for delete to authenticated
  using (user_id = auth.uid());

grant select, insert, delete on classroom.message_reactions to authenticated;
grant select, insert, delete on classroom.notice_reactions  to authenticated;

do $$
begin
  alter publication supabase_realtime add table classroom.message_reactions;
exception when duplicate_object then null;
end $$;

notify pgrst, 'reload schema';
