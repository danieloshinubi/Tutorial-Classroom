-- =============================================================================
-- Audit log — every write, on every table, by everyone
--
-- One generic trigger, attached to every base table in this schema (a few
-- named exclusions below), rather than instrumenting each of the ~40
-- existing RPC functions by hand. That matters for two reasons: it catches
-- writes those functions make AND any plain supabase-js .insert()/.update()/
-- .delete() call used directly against a table (several simpler features in
-- this codebase write straight to a table with no RPC in between at all —
-- an audit trail built only into RPCs would miss every one of those), and
-- it means a table added after this migration only needs the same trigger
-- attached to it, not a parallel logging call written into every function
-- that touches it.
--
-- What gets recorded per row-change: who (auth.uid(), resolved to a name and
-- their role(s) at the relevant school), what table and row, the operation,
-- the full old and new row content, exactly which columns changed on an
-- update, when, and — since PostgREST forwards the original request's
-- headers into Postgres as the `request.headers` GUC — the client's IP
-- address, country and user agent. Verified live against this project's own
-- Supabase/Cloudflare setup before writing this (see cf-connecting-ip /
-- x-forwarded-for / user-agent / cf-ipcountry below): these header names are
-- not a guess.
--
-- Excluded from the generic trigger, deliberately:
--   audit_log itself       — would recurse into logging its own inserts.
--   profiles                — a user's own global identity, not scoped to
--                             any one school (a parent, teacher, admissions
--                             officer etc. can belong to several); which
--                             school a profile edit "belongs to" has no
--                             single correct answer, so it can't be scoped
--                             the same way as everything else here.
--   platform_admins         — platform-level, outside any school entirely.
-- =============================================================================

create table if not exists classroom.audit_log (
  id             uuid primary key default gen_random_uuid(),
  school_id      uuid references classroom.schools (id) on delete cascade,
  table_name     text not null,
  record_id      text,
  action         text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  actor_id       uuid references auth.users (id) on delete set null,
  actor_label    text,
  actor_role     text,
  old_data       jsonb,
  new_data       jsonb,
  changed_fields text[],
  ip_address     text,
  country        text,
  user_agent     text,
  created_at     timestamptz not null default now()
);

create index if not exists audit_log_school_created_idx on classroom.audit_log (school_id, created_at desc);
create index if not exists audit_log_actor_idx           on classroom.audit_log (actor_id, created_at desc);
create index if not exists audit_log_table_idx            on classroom.audit_log (table_name, created_at desc);
create index if not exists audit_log_record_idx           on classroom.audit_log (record_id);

alter table classroom.audit_log enable row level security;

-- Deliberately narrower than "admissions"/"bursary" style modules — an audit
-- trail is a security/compliance surface, not a day-to-day operations one.
-- Owner and admin only; not principal, not admissions, not bursar.
drop policy if exists "administrators read their school's audit log" on classroom.audit_log;
create policy "administrators read their school's audit log"
  on classroom.audit_log for select to authenticated
  using (classroom.has_role_in(school_id, array['owner', 'admin']::classroom.member_role[]));

-- No insert/update/delete grant to any client role, for anyone, including an
-- owner. Every row comes from the trigger function below, which — being
-- SECURITY DEFINER — writes as its owner regardless of what's granted here.
-- An audit log a privileged user could edit or delete from the client isn't
-- one; that immutability is the entire point.
grant select on classroom.audit_log to authenticated;


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
  -- resolved through whichever parent id the row actually has. Every branch
  -- here corresponds to a real table in this schema that lacks school_id —
  -- checked against a full information_schema listing before writing this,
  -- not guessed at.
  if resolved_school is null then
    resolved_school := case TG_TABLE_NAME
      when 'admission_offers'              then (select a.school_id from classroom.applications a where a.id = (row_data ->> 'application_id')::uuid)
      when 'applicant_documents'           then (select a.school_id from classroom.applications a where a.id = (row_data ->> 'application_id')::uuid)
      when 'application_documents'         then (select a.school_id from classroom.applications a where a.id = (row_data ->> 'application_id')::uuid)
      when 'application_events'            then (select a.school_id from classroom.applications a where a.id = (row_data ->> 'application_id')::uuid)
      when 'application_interviews'        then (select a.school_id from classroom.applications a where a.id = (row_data ->> 'application_id')::uuid)
      when 'application_reviews'           then (select a.school_id from classroom.applications a where a.id = (row_data ->> 'application_id')::uuid)
      when 'application_screening_items'   then (select a.school_id from classroom.applications a where a.id = (row_data ->> 'application_id')::uuid)
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
      else null
    end;
  end if;

  if TG_OP = 'UPDATE' then
    select array_agg(k) into changed
    from jsonb_each(new_row) as j(k, v)
    where j.v is distinct from (old_row -> j.k);
  end if;

  -- PostgREST forwards the original HTTP request's headers to Postgres as
  -- this GUC. Confirmed live against this project: Cloudflare sits in front
  -- of Supabase here, so cf-connecting-ip is the most trustworthy client
  -- address (set by Cloudflare itself, not just relayed); x-forwarded-for
  -- and x-real-ip are kept as fallbacks for anything reaching Postgres a
  -- different way. Absent entirely for non-PostgREST callers (a migration
  -- script, a service-role Edge Function) — current_setting's second
  -- argument makes that NULL rather than an error.
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

-- Attaches the trigger to every base table that exists right now. A table
-- added later needs the same two lines run against it by hand (or this DO
-- block re-run — it's idempotent, drop-if-exists then create, per table).
do $$
declare
  t record;
begin
  for t in
    select table_name from information_schema.tables
    where table_schema = 'classroom'
      and table_type = 'BASE TABLE'
      and table_name not in ('audit_log', 'profiles', 'platform_admins')
  loop
    execute format(
      'drop trigger if exists audit_trg on classroom.%I;
       create trigger audit_trg after insert or update or delete on classroom.%I
         for each row execute function classroom.write_audit_log();',
      t.table_name, t.table_name
    );
  end loop;
end $$;

notify pgrst, 'reload schema';
