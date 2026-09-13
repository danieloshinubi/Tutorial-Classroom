-- =============================================================================
-- Tickets — an internal support/ops queue for school staff, teachers excluded
--
-- Not admissions, not a family-facing feature: this is staff filing and
-- tracking their own operational issues with each other (a broken
-- projector, a network outage, an access request) — the school's own
-- Freshdesk-style helpdesk, scoped to owner/admin/principal/bursar/
-- admissions. Teachers, students and parents never see this module at all
-- (modules.js keeps them out of the nav; the RLS below keeps them out of
-- the data regardless of what URL they type).
--
-- Run after 007. Safe to re-run.
-- =============================================================================

/* ---------------------------------------------------------------------------
   Who may use this module — everyone who runs school operations, minus the
   one staff role (teacher) explicitly excluded from it.
   --------------------------------------------------------------------------- */
create or replace function classroom.is_ticket_staff(target_school uuid)
returns boolean
language sql stable security definer
set search_path = classroom, public
as $$
  select classroom.has_role_in(
    target_school,
    array['owner','admin','principal','bursar','admissions']::classroom.member_role[]
  );
$$;

/* ---------------------------------------------------------------------------
   Ticket groups — a school names its own, same pattern as clearance
   departments: whatever this school actually calls its support queues
   ("IT Support", "Facilities", "Front Office"), not a fixed list.
   --------------------------------------------------------------------------- */
create table if not exists classroom.ticket_groups (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references classroom.schools (id) on delete cascade,
  name       text not null,
  position   int not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  unique (school_id, name)
);

alter table classroom.ticket_groups enable row level security;

drop policy if exists "ticket staff manage groups" on classroom.ticket_groups;
create policy "ticket staff manage groups"
  on classroom.ticket_groups for all to authenticated
  using (classroom.is_ticket_staff(school_id))
  with check (classroom.is_ticket_staff(school_id));

grant select, insert, update, delete on classroom.ticket_groups to authenticated;

/* ---------------------------------------------------------------------------
   Tickets themselves. A flat, per-school incrementing number — #142774
   style, no year/prefix — because a support ticket isn't scoped to an
   academic session the way an admission reference is.
   --------------------------------------------------------------------------- */
create table if not exists classroom.tickets (
  id                 uuid primary key default gen_random_uuid(),
  school_id          uuid not null references classroom.schools (id) on delete cascade,
  number             int not null,
  subject            text not null,
  description        text not null,
  status             text not null default 'open'
                       check (status in ('open','pending','resolved','closed')),
  priority           text not null default 'low'
                       check (priority in ('low','medium','high','urgent')),
  group_id           uuid references classroom.ticket_groups (id) on delete set null,
  assigned_to        uuid references auth.users (id) on delete set null,
  requester_id       uuid not null references auth.users (id) on delete cascade,
  tags               text[] not null default '{}',
  first_response_at  timestamptz,
  resolved_at        timestamptz,
  closed_at          timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (school_id, number)
);

create index if not exists tickets_school_status_idx on classroom.tickets (school_id, status, created_at desc);
create index if not exists tickets_school_assigned_idx on classroom.tickets (school_id, assigned_to);

alter table classroom.tickets enable row level security;

drop policy if exists "ticket staff manage tickets" on classroom.tickets;
create policy "ticket staff manage tickets"
  on classroom.tickets for all to authenticated
  using (classroom.is_ticket_staff(school_id))
  with check (classroom.is_ticket_staff(school_id));

grant select, insert, update, delete on classroom.tickets to authenticated;

/* ---------------------------------------------------------------------------
   The thread — every reply (visible to whoever raised it, once email/other
   channels are wired up) and every internal note (staff-only, always —
   there is no requester-facing surface yet, so today the distinction is
   about what a future export/email integration would send out).
   --------------------------------------------------------------------------- */
create table if not exists classroom.ticket_messages (
  id         uuid primary key default gen_random_uuid(),
  ticket_id  uuid not null references classroom.tickets (id) on delete cascade,
  author_id  uuid references auth.users (id) on delete set null,
  kind       text not null default 'reply' check (kind in ('reply','note')),
  body       text not null,
  created_at timestamptz not null default now()
);

create index if not exists ticket_messages_ticket_idx on classroom.ticket_messages (ticket_id, created_at);

alter table classroom.ticket_messages enable row level security;

drop policy if exists "ticket staff manage messages" on classroom.ticket_messages;
create policy "ticket staff manage messages"
  on classroom.ticket_messages for all to authenticated
  using (
    exists (select 1 from classroom.tickets t where t.id = ticket_id and classroom.is_ticket_staff(t.school_id))
  )
  with check (
    exists (select 1 from classroom.tickets t where t.id = ticket_id and classroom.is_ticket_staff(t.school_id))
  );

grant select, insert, update, delete on classroom.ticket_messages to authenticated;

/* ---------------------------------------------------------------------------
   Ticket numbers — advisory-locked per school, same technique as admission
   references (019_reference_year.sql), just without a year/prefix.
   --------------------------------------------------------------------------- */
create or replace function classroom.next_ticket_number(target_school uuid)
returns int
language plpgsql
security definer
set search_path = classroom, public
as $fn$
declare
  n int;
begin
  perform pg_advisory_xact_lock(hashtext('ticket_number:' || target_school::text));
  select coalesce(max(number), 0) + 1 into n from classroom.tickets where school_id = target_school;
  return n;
end;
$fn$;

/* ---------------------------------------------------------------------------
   Raising a ticket — one call, gets the number right, stamps the requester
   as the caller (a staff member files their own ticket; nobody files one
   pretending to be someone else).
   --------------------------------------------------------------------------- */
create or replace function classroom.create_ticket(
  target_school uuid,
  subject_in    text,
  description_in text,
  priority_in   text default 'low',
  group_id_in   uuid default null
) returns classroom.tickets
language plpgsql
security definer
set search_path = classroom, public
as $fn$
declare
  ticket classroom.tickets;
begin
  if not classroom.is_ticket_staff(target_school) then
    raise exception 'Only school staff may raise a ticket here';
  end if;
  if btrim(coalesce(subject_in, '')) = '' then
    raise exception 'A ticket needs a subject';
  end if;

  insert into classroom.tickets
    (school_id, number, subject, description, priority, group_id, requester_id)
  values
    (target_school, classroom.next_ticket_number(target_school), btrim(subject_in),
     coalesce(description_in, ''), coalesce(priority_in, 'low'), group_id_in, auth.uid())
  returning * into ticket;

  return ticket;
end;
$fn$;

grant execute on function classroom.create_ticket(uuid, text, text, text, uuid) to authenticated;

/* ---------------------------------------------------------------------------
   Posting to the thread — stamps first_response_at the first time anyone
   other than the requester replies, which is what turns the "New" badge
   off in the UI (a ticket nobody has actually answered yet, versus one
   that's just sitting open).
   --------------------------------------------------------------------------- */
create or replace function classroom.add_ticket_message(
  target_ticket uuid,
  kind_in       text,
  body_in       text
) returns classroom.ticket_messages
language plpgsql
security definer
set search_path = classroom, public
as $fn$
declare
  msg classroom.ticket_messages;
  t   classroom.tickets;
begin
  select * into t from classroom.tickets where id = target_ticket;
  if not found or not classroom.is_ticket_staff(t.school_id) then
    raise exception 'You cannot post to this ticket';
  end if;
  if btrim(coalesce(body_in, '')) = '' then
    raise exception 'A message needs some content';
  end if;

  insert into classroom.ticket_messages (ticket_id, author_id, kind, body)
  values (target_ticket, auth.uid(), coalesce(kind_in, 'reply'), btrim(body_in))
  returning * into msg;

  if kind_in = 'reply' and t.first_response_at is null and t.requester_id <> auth.uid() then
    update classroom.tickets set first_response_at = now(), updated_at = now() where id = target_ticket;
  end if;

  return msg;
end;
$fn$;

grant execute on function classroom.add_ticket_message(uuid, text, text) to authenticated;

/* ---------------------------------------------------------------------------
   Changing status/priority/group/assignee/tags — one RPC rather than a bare
   table update, so resolved_at/closed_at stamp themselves instead of
   depending on the client remembering to set them.
   --------------------------------------------------------------------------- */
create or replace function classroom.update_ticket(
  target_ticket uuid,
  status_in     text default null,
  priority_in   text default null,
  group_id_in   uuid default null,
  assigned_to_in uuid default null,
  tags_in       text[] default null,
  clear_group   boolean default false,
  clear_assignee boolean default false
) returns classroom.tickets
language plpgsql
security definer
set search_path = classroom, public
as $fn$
declare
  t classroom.tickets;
begin
  select * into t from classroom.tickets where id = target_ticket;
  if not found or not classroom.is_ticket_staff(t.school_id) then
    raise exception 'You cannot update this ticket';
  end if;

  update classroom.tickets set
    status       = coalesce(status_in, status),
    priority     = coalesce(priority_in, priority),
    group_id     = case when clear_group then null when group_id_in is not null then group_id_in else group_id end,
    assigned_to  = case when clear_assignee then null when assigned_to_in is not null then assigned_to_in else assigned_to end,
    tags         = coalesce(tags_in, tags),
    resolved_at  = case
                     when status_in = 'resolved' and status <> 'resolved' then now()
                     when status_in is not null and status_in <> 'resolved' then null
                     else resolved_at
                   end,
    closed_at    = case
                     when status_in = 'closed' and status <> 'closed' then now()
                     when status_in is not null and status_in <> 'closed' then null
                     else closed_at
                   end,
    updated_at   = now()
  where id = target_ticket
  returning * into t;

  return t;
end;
$fn$;

grant execute on function classroom.update_ticket(uuid, text, text, uuid, uuid, text[], boolean, boolean) to authenticated;

/* ---------------------------------------------------------------------------
   Audit trail — tickets/ticket_groups already carry school_id directly, so
   write_audit_log()'s fast path covers them the moment the trigger is
   attached. ticket_messages needs the one slow-path branch added below.
   --------------------------------------------------------------------------- */
create trigger audit_trg after insert or update or delete on classroom.tickets
  for each row execute function classroom.write_audit_log();
create trigger audit_trg after insert or update or delete on classroom.ticket_groups
  for each row execute function classroom.write_audit_log();
create trigger audit_trg after insert or update or delete on classroom.ticket_messages
  for each row execute function classroom.write_audit_log();

create or replace function classroom.write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = classroom, public
as $fn$
declare
  old_row  jsonb := case when TG_OP in ('UPDATE', 'DELETE') then to_jsonb(OLD) else null end;
  new_row  jsonb := case when TG_OP in ('INSERT', 'UPDATE') then to_jsonb(NEW) else null end;
  row_data jsonb := coalesce(new_row, old_row);
  resolved_school uuid;
  resolved_record text;
  changed  text[];
  headers  jsonb;
  ip       text;
  country  text;
  ua       text;
  actor    uuid;
  actor_name text;
  actor_role_val text;
begin
  resolved_record := coalesce(
    row_data ->> 'id',
    case TG_TABLE_NAME
      when 'enrollments' then (row_data ->> 'user_id') || ':' || (row_data ->> 'course_id')
      when 'levels'      then (row_data ->> 'year') || ':' || (row_data ->> 'school_id')
      else null
    end
  );

  -- Fast path: most tables carry school_id directly.
  resolved_school := nullif(row_data ->> 'school_id', '')::uuid;

  -- Slow path: a detail/child table one or more hops from its own school_id,
  -- resolved through whichever parent id the row actually has.
  if resolved_school is null then
    resolved_school := case TG_TABLE_NAME
      when 'admission_offers'              then (select a.school_id from classroom.applications a where a.id = (row_data ->> 'application_id')::uuid)
      when 'applicant_documents'           then (select a.school_id from classroom.applications a where a.id = (row_data ->> 'application_id')::uuid)
      when 'application_documents'         then (select a.school_id from classroom.applications a where a.id = (row_data ->> 'application_id')::uuid)
      when 'application_events'            then (select a.school_id from classroom.applications a where a.id = (row_data ->> 'application_id')::uuid)
      when 'application_interviews'        then (select a.school_id from classroom.applications a where a.id = (row_data ->> 'application_id')::uuid)
      when 'application_reviews'           then (select a.school_id from classroom.applications a where a.id = (row_data ->> 'application_id')::uuid)
      when 'application_screening_items'   then (select a.school_id from classroom.applications a where a.id = (row_data ->> 'application_id')::uuid)
      when 'clearance_checklists'          then (select a.school_id from classroom.applications a where a.id = (row_data ->> 'application_id')::uuid)
      when 'original_verifications'        then (select a.school_id from classroom.applications a where a.id = (row_data ->> 'application_id')::uuid)
      when 'assignments'                   then (select c.school_id from classroom.courses c where c.id = (row_data ->> 'course_id')::uuid)
      when 'class_students'                then (select c.school_id from classroom.classes c where c.id = (row_data ->> 'class_id')::uuid)
      when 'enrollments'                   then (select c.school_id from classroom.courses c where c.id = (row_data ->> 'course_id')::uuid)
      when 'exams'                         then (select c.school_id from classroom.courses c where c.id = (row_data ->> 'course_id')::uuid)
      when 'exam_questions'                then (select c.school_id from classroom.exams e join classroom.courses c on c.id = e.course_id where e.id = (row_data ->> 'exam_id')::uuid)
      when 'exam_options'                  then (select c.school_id from classroom.exam_questions q join classroom.exams e on e.id = q.exam_id join classroom.courses c on c.id = e.course_id where q.id = (row_data ->> 'question_id')::uuid)
      when 'exam_attempts'                 then (select c.school_id from classroom.exams e join classroom.courses c on c.id = e.course_id where e.id = (row_data ->> 'exam_id')::uuid)
      when 'exam_answers'                  then (select c.school_id from classroom.exam_attempts t join classroom.exams e on e.id = t.exam_id join classroom.courses c on c.id = e.course_id where t.id = (row_data ->> 'attempt_id')::uuid)
      when 'exam_events'                   then (select c.school_id from classroom.exam_attempts t join classroom.exams e on e.id = t.exam_id join classroom.courses c on c.id = e.course_id where t.id = (row_data ->> 'attempt_id')::uuid)
      when 'fee_items'                     then (select f.school_id from classroom.fee_structures f where f.id = (row_data ->> 'structure_id')::uuid)
      when 'invoice_items'                 then (select i.school_id from classroom.invoices i where i.id = (row_data ->> 'invoice_id')::uuid)
      when 'materials'                     then (select c.school_id from classroom.courses c where c.id = (row_data ->> 'course_id')::uuid)
      when 'messages'                      then (select c.school_id from classroom.courses c where c.id = (row_data ->> 'course_id')::uuid)
      when 'message_comments'              then (select c.school_id from classroom.messages m join classroom.courses c on c.id = m.course_id where m.id = (row_data ->> 'message_id')::uuid)
      when 'message_reactions'             then (select c.school_id from classroom.messages m join classroom.courses c on c.id = m.course_id where m.id = (row_data ->> 'message_id')::uuid)
      when 'notice_reactions'              then (select n.school_id from classroom.notices n where n.id = (row_data ->> 'notice_id')::uuid)
      when 'notice_replies'                then (select n.school_id from classroom.notices n where n.id = (row_data ->> 'notice_id')::uuid)
      when 'result_entries'                then (select s.school_id from classroom.result_sheets s where s.id = (row_data ->> 'sheet_id')::uuid)
      when 'result_events'                 then (select s.school_id from classroom.result_sheets s where s.id = (row_data ->> 'sheet_id')::uuid)
      when 'submissions'                   then (select c.school_id from classroom.assignments asg join classroom.courses c on c.id = asg.course_id where asg.id = (row_data ->> 'assignment_id')::uuid)
      when 'ticket_messages'               then (select t.school_id from classroom.tickets t where t.id = (row_data ->> 'ticket_id')::uuid)
      else null
    end;
  end if;

  if TG_OP = 'UPDATE' then
    select array_agg(k) into changed
    from jsonb_each(new_row) as j(k, v)
    where j.v is distinct from (old_row -> j.k);
  end if;

  headers := nullif(current_setting('request.headers', true), '')::jsonb;
  ip := nullif(split_part(coalesce(
          headers ->> 'cf-connecting-ip',
          headers ->> 'x-forwarded-for',
          headers ->> 'x-real-ip',
          ''
        ), ',', 1), '');
  country := nullif(headers ->> 'cf-ipcountry', '');
  ua := nullif(headers ->> 'user-agent', '');

  actor := auth.uid();
  if actor is not null then
    select coalesce(nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.surname, '')), ''), p.username, p.email)
      into actor_name
      from classroom.profiles p where p.id = actor;
  end if;

  if actor is not null and resolved_school is not null then
    select string_agg(distinct m.role::text, ', ' order by m.role::text)
      into actor_role_val
      from classroom.school_members m
      where m.user_id = actor and m.school_id = resolved_school and m.is_active;
  end if;

  insert into classroom.audit_log
    (school_id, table_name, record_id, action, actor_id, actor_label, actor_role,
     old_data, new_data, changed_fields, ip_address, country, user_agent)
  values
    (resolved_school, TG_TABLE_NAME, resolved_record, TG_OP, actor,
     coalesce(actor_name, 'Anonymous / system'), actor_role_val,
     old_row, new_row, changed, ip, country, ua);

  return coalesce(NEW, OLD);
end;
$fn$;

notify pgrst, 'reload schema';
