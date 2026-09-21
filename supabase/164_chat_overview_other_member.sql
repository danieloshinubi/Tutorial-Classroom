-- =============================================================================
-- The sidebar chat list's own avatar had no way to open the person-info
-- card that clicking a message avatar already opens — chat_overview named
-- the DM ("Ngozi Eze") but never returned the OTHER member's user id, so
-- there was nothing to look up in schoolMembers. Adding it turns the same
-- name subquery already computing the display name into one that also
-- returns the id it read the name from.
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
        when c.kind = 'group' then c.name
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
      select om.user_id, coalesce(p.first_name || ' ' || p.surname, p.email) as display_name
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
