-- =============================================================================
-- Live "something changed" signal on Tickets and Admissions — the same fix
-- 060_application_events_realtime.sql already made for a single
-- application's own timeline, extended to the two places staff actually
-- watch for OTHER people's changes: the Tickets list/detail and the
-- Admissions queue.
--
-- Realtime only pushes postgres_changes for tables explicitly added to the
-- supabase_realtime publication. classroom.tickets, classroom.ticket_
-- messages and classroom.applications were never added — so any client
-- subscribing to them (a live-update banner on a list page, a ticket's own
-- message thread) would silently receive nothing, no matter how correct
-- the subscription code was. That is the actual root cause behind
-- "someone else's correction doesn't make the reload prompt appear": there
-- was no code bug to find in the pages themselves, because nothing could
-- ever reach them.
--
-- Realtime still respects RLS: a subscriber only receives a row change they
-- could SELECT anyway, so the existing policies (can_access_ticket() for
-- tickets/ticket_messages, the admissions staff/applicant policies for
-- applications) are all the scoping this needs — nothing new to write.
-- =============================================================================

alter publication supabase_realtime add table classroom.tickets;
alter publication supabase_realtime add table classroom.ticket_messages;
alter publication supabase_realtime add table classroom.applications;
