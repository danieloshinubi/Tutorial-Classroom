-- =============================================================================
-- Root cause of "the chat shows SO and no name at all": a real profile in
-- production has first_name and surname stored as empty strings, not NULL.
-- classroom.chat_overview()'s name resolution was
--   coalesce(p.first_name || ' ' || p.surname, p.email)
-- and '' || ' ' || '' is the single-space string ' ' — NOT NULL — so
-- coalesce never fell through to email. The DM's name became a literal
-- single space:
--   - the header <h1>{activeChannel?.name || "Chat"}</h1> never fell back
--     to "Chat" either, because JS || only treats falsy values that way,
--     and a non-empty (if blank-looking) string is truthy — so it rendered
--     an invisible single space instead.
--   - the avatar's initials(), on the frontend, DOES correctly trim that
--     space to "" and fall back through its own chain to a generic
--     "Someone" — whose first two letters happen to spell "SO". That's
--     where the mysterious "SO" avatar came from: not a real person's
--     initials, the fallback string's own initials.
--
-- Fixed the same way the frontend's own displayName() already does it:
-- trim the concatenated name and treat a blank result as NULL, so a
-- genuinely nameless profile properly falls through to their email
-- instead of a blank string that reads as present to `||`/coalesce.
-- =============================================================================

create or replace function classroom.chat_overview(target_school uuid)
returns jsonb
language sql
stable
security definer
set search_path = classroom, public
as $fn$
  select coalesce(jsonb_agg(row_to_json(t) order by t.last_message_at desc), '[]'::jsonb)
  from (
    select
      c.id,
      c.kind,
      case
        when c.kind = 'group' then coalesce(nullif(btrim(c.name), ''), 'Unnamed group')
        else other.display_name
      end as name,
      case when c.kind = 'dm' then other.user_id end as other_user_id,
      c.last_message_at,
      coalesce(lm.preview_text, lm.attachment_preview) as last_message_preview,
      (
        select count(*) from classroom.chat_messages m
        where m.channel_id = c.id
          and m.deleted_at is null
          and m.author_id <> auth.uid()
          and m.created_at > mine.last_read_at
      ) as unread_count
    from classroom.chat_channels c
    join classroom.chat_channel_members mine
      on mine.channel_id = c.id and mine.user_id = auth.uid()
    left join lateral (
      select
        om.user_id,
        coalesce(
          nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.surname, '')), ''),
          p.email
        ) as display_name
      from classroom.chat_channel_members om
      join classroom.profiles p on p.id = om.user_id
      where om.channel_id = c.id and om.user_id <> auth.uid()
      limit 1
    ) other on c.kind = 'dm'
    left join lateral (
      select nullif(m.body, '') as preview_text,
             case when m.attachment_name is not null then '📎 ' || m.attachment_name end as attachment_preview
      from classroom.chat_messages m
      where m.channel_id = c.id and m.deleted_at is null
      order by m.created_at desc
      limit 1
    ) lm on true
    where c.school_id = target_school
  ) t;
$fn$;

notify pgrst, 'reload schema';
