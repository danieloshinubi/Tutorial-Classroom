-- =============================================================================
-- 167's fix made a nameless profile's chat name fall back to their full
-- email address — correct in principle, but initials() (src/Components/
-- UI.jsx) splits a name on space/dot/underscore/hyphen to build two-letter
-- initials, which was never meant to parse an email address. On
-- "danieloshinubi@gmail.com" it split on the dot in ".com", read
-- "danieloshinubi@gmail" and "com" as two words, and took their first
-- letters — "D" and "C". Not a typo in that function; it's simply the
-- wrong input. Everywhere ELSE in this app that falls back to an email
-- already strips it to the local part first (displayName() in UI.jsx does
-- exactly this for its own email fallback) — chat_overview's SQL-side
-- fallback just wasn't matching that same convention yet.
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
          split_part(p.email, '@', 1)
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
