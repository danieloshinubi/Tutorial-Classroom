-- =============================================================================
-- Group rows in the chat list show initials derived from the GROUP'S NAME
-- ("Testing one or two" -> "TO"), which says nothing about who is actually in
-- the conversation. Teams instead clusters the first few members' own avatars
-- into one circle, so a group is recognisable by its people rather than by
-- whatever it was named.
--
-- The client already holds every school member's profile (names, avatars), so
-- this only needs to say WHICH members to draw — hence a small array of user
-- ids rather than another profile join. Capped at 3 because that is all the
-- cluster draws, and excludes the viewer: a group avatar made partly of your
-- own face is no help in telling one group from another.
--
-- Order is joined_at then user_id, so the same group always renders the same
-- faces in the same positions instead of shuffling with whatever order the
-- rows came back in.
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
      case when c.kind = 'group' then (
        select coalesce(jsonb_agg(gm.user_id order by gm.rn), '[]'::jsonb)
        from (
          select om.user_id,
                 row_number() over (order by om.joined_at, om.user_id) as rn
          from classroom.chat_channel_members om
          where om.channel_id = c.id and om.user_id <> auth.uid()
          order by om.joined_at, om.user_id
          limit 3
        ) gm
      ) end as member_preview,
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
