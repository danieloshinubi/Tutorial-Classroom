-- =============================================================================
-- Sending/receiving a document or image inside a chat message.
--
-- New private bucket (chat-attachments, created via the Storage Management
-- API from this session — the storage schema is owned by
-- supabase_storage_admin, same limitation 073_public_media_storage.sql
-- documents, so bucket creation itself can't happen from this file). Path
-- convention matches every other file feature in this app:
--   <channel_id>/<uuid>-<filename>
-- The first segment is the channel id, so the same classroom.is_chat_member
-- helper RLS on chat_messages/chat_message_reactions already uses also
-- gates the file itself — a person who can read the channel's messages can
-- read its files, and only a member can upload into it.
--
-- chat_messages gets four new nullable columns rather than a separate
-- attachments table: a chat message is exactly one text body and at most
-- one attached file (never several), so there's nothing a join buys here
-- that four columns don't already give for free. body stays NOT NULL —
-- an attachment-only message just sends body = ''.
-- =============================================================================

alter table classroom.chat_messages
  add column attachment_path text,
  add column attachment_name text,
  add column attachment_size bigint,
  add column attachment_mime text;

drop policy if exists "chat members upload to their channel" on storage.objects;
create policy "chat members upload to their channel"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'chat-attachments'
    and classroom.is_chat_member(classroom.try_uuid((storage.foldername(name))[1]))
  );

drop policy if exists "chat members read their channel's files" on storage.objects;
create policy "chat members read their channel's files"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'chat-attachments'
    and classroom.is_chat_member(classroom.try_uuid((storage.foldername(name))[1]))
  );

drop policy if exists "chat members remove their channel's files" on storage.objects;
create policy "chat members remove their channel's files"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'chat-attachments'
    and classroom.is_chat_member(classroom.try_uuid((storage.foldername(name))[1]))
  );

notify pgrst, 'reload schema';
