-- =============================================================================
-- Point tickets' person columns at classroom.profiles, not auth.users
--
-- Found live: fetching a ticket list with its requester/assignee embedded
-- failed with "Could not find a relationship between 'tickets' and
-- 'profiles' in the schema cache". PostgREST can only embed a table through
-- a *direct* foreign key between the two tables in the query — a shared
-- reference to a third table (auth.users) doesn't count, even though
-- classroom.profiles.id and auth.users.id are the same value. The working
-- precedent already in this codebase is classroom.school_members.user_id,
-- which references classroom.profiles(id) directly for exactly this
-- reason — 077 should have matched it and didn't.
--
-- Run after 077. Safe to re-run.
-- =============================================================================

alter table classroom.tickets drop constraint if exists tickets_assigned_to_fkey;
alter table classroom.tickets
  add constraint tickets_assigned_to_fkey foreign key (assigned_to)
  references classroom.profiles (id) on delete set null;

alter table classroom.tickets drop constraint if exists tickets_requester_id_fkey;
alter table classroom.tickets
  add constraint tickets_requester_id_fkey foreign key (requester_id)
  references classroom.profiles (id) on delete cascade;

alter table classroom.ticket_messages drop constraint if exists ticket_messages_author_id_fkey;
alter table classroom.ticket_messages
  add constraint ticket_messages_author_id_fkey foreign key (author_id)
  references classroom.profiles (id) on delete set null;

notify pgrst, 'reload schema';
