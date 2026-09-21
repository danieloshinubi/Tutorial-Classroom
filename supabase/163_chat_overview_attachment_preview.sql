-- =============================================================================
-- An attachment-only message (empty body) made the sidebar preview read
-- "No messages yet" — chat_overview returned last_message_preview = '', and
-- the client's `preview || "No messages yet"` treats an empty string as
-- falsy same as null. Falling back to the attachment's own name here (with
-- a paperclip marker) fixes it at the source rather than teaching every
-- client of this RPC the same empty-string special case.
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
        else (
          select coalesce(p.first_name || ' ' || p.surname, p.email)
          from classroom.chat_channel_members om
          join classroom.profiles p on p.id = om.user_id
          where om.channel_id = c.id and om.user_id <> auth.uid()
          limit 1
        )
      end as name,
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
