-- =============================================================================
-- Live "something changed" signal on an application's timeline
--
-- Realtime only pushes postgres_changes for tables explicitly added to the
-- supabase_realtime publication — notifications/messages/message_comments/
-- notice_replies/message_reactions are already there; application_events
-- was not, so a client subscribing to it (as api.js's
-- subscribeToApplicationEvents now does) would silently receive nothing.
-- Realtime still respects RLS: a subscriber only receives an INSERT they
-- could SELECT anyway, so the existing application_events read policy
-- (staff, or the applicant on their own application) is all the scoping
-- this needs.
-- =============================================================================

alter publication supabase_realtime add table classroom.application_events;
