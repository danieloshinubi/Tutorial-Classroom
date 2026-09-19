-- =============================================================================
-- Two new edge functions (admissions-notify, auth-email-send) need to send a
-- branded email through a school's own connected mailbox without a ticket
-- to hang the lookup off of — get_ticket_mailbox() takes a mailbox id, which
-- assumes a ticket already told you which one. This is the school-scoped
-- equivalent, same security shape as get_ticket_mailbox (service_role only,
-- since service_role has no table-level grant on ticket_mailboxes either).
--
-- admissions-notify's own authorization reuses classroom.can_do_admissions()
-- (027) as-is — 'owner','admin','principal','admissions' is exactly the
-- caller-scoped check it needs, already granted to authenticated.
-- =============================================================================

create or replace function classroom.get_school_mailbox(target_school uuid)
returns classroom.ticket_mailboxes
language sql
security definer
set search_path = classroom, public
as $$
  select * from classroom.ticket_mailboxes
  where school_id = target_school and is_active
  order by created_at asc
  limit 1;
$$;

revoke all on function classroom.get_school_mailbox(uuid) from public;
grant execute on function classroom.get_school_mailbox(uuid) to service_role;

-- A record of what admissions-notify actually sent — the same reasoning as
-- classroom.audit_log for platform actions: a staff member composing a
-- one-off message to an applicant is exactly the kind of action worth being
-- able to look back on, and "was the applicant actually emailed about this
-- offer" is a real support question this makes answerable.
create table if not exists classroom.admission_messages (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references classroom.applications (id) on delete cascade,
  school_id      uuid not null references classroom.schools (id) on delete cascade,
  kind           text not null check (kind in ('offered', 'enrolled', 'rejected', 'message')),
  subject        text not null,
  sent_to        text not null,
  status         text not null check (status in ('sent', 'failed', 'skipped')),
  error          text,
  sent_by        uuid references classroom.profiles (id) on delete set null,
  created_at     timestamptz not null default now()
);

create index if not exists admission_messages_application_idx
  on classroom.admission_messages (application_id, created_at desc);

alter table classroom.admission_messages enable row level security;

create policy "admissions staff can view messages for their school"
  on classroom.admission_messages for select
  using (classroom.can_do_admissions(school_id));

create trigger audit_trg
  after insert or update or delete on classroom.admission_messages
  for each row execute function classroom.write_audit_log();

-- Only the service-role edge function writes these — never the client
-- directly, since "an email was sent" has to be true, not just claimed.
create or replace function classroom.record_admission_message(
  target_application uuid,
  target_school      uuid,
  kind_in            text,
  subject_in         text,
  sent_to_in         text,
  status_in          text,
  error_in           text,
  sent_by_in         uuid
) returns void
language sql
security definer
set search_path = classroom, public
as $$
  insert into classroom.admission_messages
    (application_id, school_id, kind, subject, sent_to, status, error, sent_by)
  values
    (target_application, target_school, kind_in, subject_in, sent_to_in, status_in, error_in, sent_by_in);
$$;

revoke all on function classroom.record_admission_message(uuid, uuid, text, text, text, text, text, uuid) from public;
grant execute on function classroom.record_admission_message(uuid, uuid, text, text, text, text, text, uuid) to service_role;

notify pgrst, 'reload schema';
