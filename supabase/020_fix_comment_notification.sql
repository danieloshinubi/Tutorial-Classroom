-- =============================================================================
-- Fix: posting a comment failed with
--
--   column reference "code" is ambiguous
--
-- on_comment_posted() declared a variable called `code`, then used it bare in
-- an INSERT ... SELECT whose FROM is classroom.courses — a table that has its
-- own `code` column. Postgres cannot tell which one is meant and refuses the
-- whole statement, so the comment never lands.
--
-- The other notification triggers are unaffected: they only ever reference the
-- variable in a query with no courses in its FROM.
--
-- Renaming the variables out of the way is the durable fix; qualifying one
-- reference would leave the same trap for the next person editing this.
-- =============================================================================

create or replace function classroom.on_comment_posted()
returns trigger language plpgsql security definer
set search_path = classroom, public as $$
declare
  msg         classroom.messages;
  course_code text;
  author      text;
begin
  select * into msg from classroom.messages where id = new.message_id;
  if not found then
    return new;
  end if;

  select c.code into course_code from classroom.courses c where c.id = msg.course_id;

  select coalesce(nullif(btrim(p.first_name || ' ' || p.surname), ''), p.username, p.email, 'Someone')
  into author from classroom.profiles p where p.id = new.user_id;

  -- The author of the post hears about it directly; everyone else on the
  -- course would be buried under replies, so they are left alone.
  if msg.user_id is distinct from new.user_id then
    insert into classroom.notifications (user_id, school_id, course_id, kind, title, body, link)
    select msg.user_id, c.school_id, msg.course_id, 'comment_posted',
           format('%s replied to your post in %s', author, course_code),
           left(new.body, 140),
           format('/Courses/%s', course_code)
    from classroom.courses c where c.id = msg.course_id;
  end if;

  return new;
end;
$$;
