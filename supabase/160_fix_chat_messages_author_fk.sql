-- =============================================================================
-- chat_messages.author_id referenced auth.users(id), but PostgREST's
-- embed syntax (author:profiles(...), used by fetchChatMessages/
-- sendChatMessage in src/lib/api.js) needs an actual foreign key pointing
-- at classroom.profiles to know how to join — confirmed live: "Could not
-- find a relationship between 'chat_messages' and 'profiles' in the schema
-- cache" the moment a message was sent. ticket_messages.author_id already
-- gets this right (references classroom.profiles(id)) — chat_messages
-- should have matched it from the start.
-- =============================================================================

alter table classroom.chat_messages drop constraint if exists chat_messages_author_id_fkey;
alter table classroom.chat_messages
  add constraint chat_messages_author_id_fkey
  foreign key (author_id) references classroom.profiles (id) on delete set null;

notify pgrst, 'reload schema';
