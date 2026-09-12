-- =============================================================================
-- Admissions engine — Phase 4 functions
--
-- Clearance and original-document verification. Same rules as every function
-- before it: SECURITY DEFINER, search_path pinned, role checked before
-- anything moves, an application_events row on every real transition.
--
-- Entry guard (mirrors the acceptance-fee gate already enforced by
-- accept_offer/set_screening_item_status elsewhere): clearance can only be
-- opened once the applicant has accepted their offer and — if the school
-- charges one — the acceptance fee is verified. There is nothing to clear
-- before that point.
--
-- application_workspace() and admissions_queues() are both extended in
-- place. Neither changes shape (same columns/keys, just more of them or one
-- more UNION ALL branch), so no DROP FUNCTION is needed for either.
-- write_audit_log() (062) is extended the same way, plus the three new
-- tables are wired into it explicitly — the audit trigger only attaches
-- itself to tables that already existed when 062 ran.
-- =============================================================================


/* =============================================================================
   1. create_application_clearance_items — lazy instantiation, offer-gated
   ---------------------------------------------------------------------------
   Mirrors create_application_screening_items (048): idempotent, only inserts
   rows that don't already exist. A school with zero active clearance
   departments configured has nothing to clear — recompute_clearance_state
   below resolves that straight to 'cleared' rather than leaving the
   applicant stuck on a step nobody ever set up.
   ============================================================================= */

create or replace function classroom.create_application_clearance_items(
  target_application uuid
) returns setof classroom.clearance_checklists
language plpgsql security definer
set search_path = classroom, public
as $fn$
declare
  app classroom.applications;
  cfg jsonb;
  acc_on boolean;
begin
  select * into app from classroom.applications where id = target_application;
  if not found then
    raise exception 'No such application';
  end if;
  if not classroom.can_do_admissions(app.school_id) then
    raise exception 'Only admissions staff can open clearance';
  end if;

  if app.offer_state <> 'accepted' then
    raise exception 'Clearance opens once the applicant has accepted their offer';
  end if;

  cfg := classroom.effective_admission_config(app.school_id, app.session_id);
  acc_on := coalesce((cfg->>'acceptance_fee_enabled')::boolean, false);
  if acc_on and app.payment_state <> 'verified' then
    raise exception 'The acceptance fee has not been verified yet';
  end if;

  insert into classroom.clearance_checklists (application_id, department_id)
  select target_application, d.id
  from classroom.clearance_departments d
  where d.school_id = app.school_id
    and d.is_active
    and not exists (
      select 1 from classroom.clearance_checklists c
      where c.application_id = target_application and c.department_id = d.id
    );

  perform classroom.recompute_clearance_state(target_application);

  insert into classroom.application_events
    (application_id, status_from, status_to, actor_id, actor_label, note)
  values
    (target_application, app.status, app.status, auth.uid(), classroom.admissions_actor_label(),
     'Clearance opened');

  return query
    select * from classroom.clearance_checklists
    where application_id = target_application
    order by created_at;
end;
$fn$;

grant execute on function classroom.create_application_clearance_items(uuid) to authenticated;


-- Shared aggregate recompute, used by the function above and by
-- set_clearance_status below — kept in one place so the rule for what
-- clearance_state means is never duplicated. Not granted to authenticated:
-- called only via `perform` from the two functions that already checked
-- permission, same precedent as refresh_documents_state (048).
create or replace function classroom.recompute_clearance_state(
  target_application uuid
) returns void
language sql security definer
set search_path = classroom, public
as $fn$
  update classroom.applications a
  set clearance_state = case
    -- Nothing was ever instantiated for this application. Once the
    -- applicant has actually reached clearance (offer accepted) that can
    -- only mean zero active departments are configured — nothing blocks
    -- them, so clearance auto-passes rather than stranding them on a step
    -- nobody set up. Before that point (offer not yet accepted) leave the
    -- default 'not_started' alone.
    when not exists (select 1 from classroom.clearance_checklists c where c.application_id = a.id)
      then case when a.offer_state = 'accepted' then 'cleared' else a.clearance_state end
    when exists (
      select 1 from classroom.clearance_checklists c
      where c.application_id = a.id and c.status = 'rejected'
    ) then 'rejected'
    when exists (
      select 1 from classroom.clearance_checklists c
      where c.application_id = a.id and c.status not in ('cleared','waived')
    ) then 'in_progress'
    else 'cleared'
  end,
  updated_at = now()
  where a.id = target_application;
$fn$;


/* =============================================================================
   2. set_clearance_status — move one department's checklist item
   ============================================================================= */

create or replace function classroom.set_clearance_status(
  target_checklist uuid,
  new_status       text,
  note_in          text default null
) returns classroom.clearance_checklists
language plpgsql security definer
set search_path = classroom, public
as $fn$
declare
  item classroom.clearance_checklists;
  app  classroom.applications;
  dept_name text;
  was  text;
  old_clearance_state text;
begin
  select * into item from classroom.clearance_checklists where id = target_checklist;
  if not found then
    raise exception 'No such clearance item';
  end if;
  select * into app from classroom.applications where id = item.application_id;
  select name into dept_name from classroom.clearance_departments where id = item.department_id;

  if not classroom.can_do_admissions(app.school_id) then
    raise exception 'Only admissions staff can move a clearance item';
  end if;

  if new_status not in ('pending','in_progress','cleared','rejected','waived') then
    raise exception 'Unknown clearance status: %', new_status;
  end if;

  -- Waiving a clearance requirement is a policy exception, same bar as
  -- waiving a required document (048).
  if new_status = 'waived'
     and not classroom.has_role_in(app.school_id, array['owner','admin','principal']::classroom.member_role[]) then
    raise exception 'Only admin/principal can waive a clearance requirement';
  end if;

  if new_status = 'rejected' and btrim(coalesce(note_in, '')) = '' then
    raise exception 'A rejected clearance item must carry a reason';
  end if;

  was := item.status;
  old_clearance_state := app.clearance_state;

  if was = new_status then
    return item;
  end if;

  update classroom.clearance_checklists
  set status = new_status,
      decided_by = auth.uid(),
      decided_at = now(),
      decision_note = coalesce(note_in, decision_note),
      updated_at = now()
  where id = target_checklist
  returning * into item;

  perform classroom.recompute_clearance_state(app.id);
  select * into app from classroom.applications where id = app.id;

  insert into classroom.application_events
    (application_id, status_from, status_to, actor_id, actor_label, note)
  values
    (app.id, app.status, app.status, auth.uid(), classroom.admissions_actor_label(),
     format('Clearance — %s: %s%s', coalesce(dept_name, 'department'), new_status,
            case when note_in is not null then ' — ' || note_in else '' end));

  if new_status = 'rejected' then
    insert into classroom.notifications (user_id, school_id, kind, title, body, link)
    select ac.user_id, app.school_id, 'clearance_action_required',
           format('%s: clearance needs attention', app.reference),
           format('%s — %s', coalesce(dept_name, 'A department'), note_in),
           format('/Applications/%s', app.id)
    from classroom.applicant_accounts ac
    where ac.id = app.applicant_id;
  end if;

  -- Whole-application milestone: only fires the moment every department
  -- clears, not on every individual item change once already cleared.
  if old_clearance_state <> 'cleared' and app.clearance_state = 'cleared' then
    insert into classroom.notifications (user_id, school_id, kind, title, body, link)
    select ac.user_id, app.school_id, 'clearance_completed',
           format('%s: clearance complete', app.reference),
           'Every clearance department has signed off. The school will confirm your next steps.',
           format('/Applications/%s', app.id)
    from classroom.applicant_accounts ac
    where ac.id = app.applicant_id;
  end if;

  return item;
end;
$fn$;

grant execute on function classroom.set_clearance_status(uuid, text, text) to authenticated;


/* =============================================================================
   3. record_original_verification — a physical document was seen in person
   ---------------------------------------------------------------------------
   Distinct from the digital applicant_documents/application_documents
   uploads: this is the log of "the original certificate was physically
   presented and checked", a step no upload can satisfy on its own. A pure
   append-only log — nothing here changes any state column, it exists to be
   read back later (and picked up by the audit trigger like everything else).
   ============================================================================= */

create or replace function classroom.record_original_verification(
  target_application uuid,
  document_kind_in   text,
  remarks_in         text default null
) returns classroom.original_verifications
language plpgsql security definer
set search_path = classroom, public
as $fn$
declare
  app classroom.applications;
  row_out classroom.original_verifications;
begin
  select * into app from classroom.applications where id = target_application;
  if not found then
    raise exception 'No such application';
  end if;
  if not classroom.can_do_admissions(app.school_id) then
    raise exception 'Only admissions staff can record an original-document sighting';
  end if;
  if btrim(coalesce(document_kind_in, '')) = '' then
    raise exception 'Say which document was seen';
  end if;

  insert into classroom.original_verifications
    (application_id, document_kind, seen_by, remarks)
  values (target_application, document_kind_in, auth.uid(), remarks_in)
  returning * into row_out;

  insert into classroom.application_events
    (application_id, status_from, status_to, actor_id, actor_label, note)
  values
    (app.id, app.status, app.status, auth.uid(), classroom.admissions_actor_label(),
     format('Original sighted: %s%s', document_kind_in,
            case when remarks_in is not null then ' — ' || remarks_in else '' end));

  return row_out;
end;
$fn$;

grant execute on function classroom.record_original_verification(uuid, text, text) to authenticated;


/* =============================================================================
   4. application_workspace — extended with clearance and originals
   ============================================================================= */

create or replace function classroom.application_workspace(target_application uuid)
returns jsonb
language plpgsql stable security definer
set search_path = classroom, public
as $fn$
declare
  app classroom.applications;
  out jsonb;
begin
  select * into app from classroom.applications where id = target_application;
  if not found then
    return null;
  end if;
  if not classroom.can_do_admissions(app.school_id) then
    raise exception 'Only admissions staff can open the workspace';
  end if;

  select jsonb_build_object(
    'application', to_jsonb(app),
    'screening',   coalesce((select jsonb_agg(to_jsonb(i) order by i.position) from classroom.application_screening_items i where i.application_id = app.id), '[]'::jsonb),
    'documents',   coalesce((select jsonb_agg(jsonb_build_object(
                                 'id', d.id,
                                 'requirement_id', d.requirement_id,
                                 'status', d.status,
                                 'decided_by', d.decided_by,
                                 'decided_at', d.decided_at,
                                 'decision_note', d.decision_note,
                                 'requirement', to_jsonb(r),
                                 'file', to_jsonb(ad)
                               )) from classroom.applicant_documents d
                              left join classroom.document_requirements r on r.id = d.requirement_id
                              left join classroom.application_documents ad on ad.id = d.document_id
                              where d.application_id = app.id), '[]'::jsonb),
    'reviews',     coalesce((select jsonb_agg(to_jsonb(r) order by r.assigned_at desc) from classroom.application_reviews r where r.application_id = app.id), '[]'::jsonb),
    'interviews',  coalesce((select jsonb_agg(to_jsonb(i) order by i.scheduled_at desc) from classroom.application_interviews i where i.application_id = app.id), '[]'::jsonb),
    'events',      coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at asc) from classroom.application_events e where e.application_id = app.id), '[]'::jsonb),
    'config',      classroom.effective_admission_config(app.school_id, app.session_id),
    'offer',       (select to_jsonb(o) from classroom.admission_offers o
                     where o.application_id = app.id
                     order by o.issued_at desc limit 1),
    'acceptance_invoice', (
      select jsonb_build_object(
        'invoice', to_jsonb(i),
        'payments', coalesce((select jsonb_agg(to_jsonb(p) order by p.submitted_at desc)
                               from classroom.payments p where p.invoice_id = i.id), '[]'::jsonb)
      )
      from classroom.invoices i
      where i.application_id = app.id and i.purpose = 'acceptance_fee'
      order by i.issued_at desc limit 1
    ),
    -- Phase 4: every configured department (so the panel can show "not
    -- opened yet" placeholders before create_application_clearance_items
    -- has run), and the checklist rows that actually exist, joined to their
    -- department's name so the client never has to cross-reference.
    'clearance_departments', coalesce((
      select jsonb_agg(to_jsonb(d) order by d.position)
      from classroom.clearance_departments d
      where d.school_id = app.school_id and d.is_active
    ), '[]'::jsonb),
    'clearance', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id,
               'department_id', c.department_id,
               'department_name', dep.name,
               'position', dep.position,
               'status', c.status,
               'decided_by', c.decided_by,
               'decided_at', c.decided_at,
               'decision_note', c.decision_note
             ) order by dep.position)
      from classroom.clearance_checklists c
      join classroom.clearance_departments dep on dep.id = c.department_id
      where c.application_id = app.id
    ), '[]'::jsonb),
    'original_verifications', coalesce((
      select jsonb_agg(to_jsonb(v) order by v.seen_at desc)
      from classroom.original_verifications v
      where v.application_id = app.id
    ), '[]'::jsonb)
  ) into out;

  return out;
end;
$fn$;

grant execute on function classroom.application_workspace(uuid) to authenticated;


/* =============================================================================
   5. admissions_queues — a clearance bucket, so an accepted application
      doesn't silently vanish from every staff queue the moment it's
      accepted (nothing before this pointed staff back at it).
   ============================================================================= */

create or replace function classroom.admissions_queues(target_school uuid)
returns table (
  bucket text,
  application_id uuid,
  reference text,
  applicant text,
  status classroom.application_status,
  form_state text,
  payment_state text,
  documents_state text,
  screening_state text,
  review_state text,
  interview_state text,
  submitted_at timestamptz,
  updated_at timestamptz
) language sql stable security definer
set search_path = classroom, public
as $fn$
  with base as (
    select a.*,
      trim(a.first_name || ' ' || a.surname) as applicant
    from classroom.applications a
    where a.school_id = target_school
      and classroom.can_do_admissions(target_school)
  )
  select 'payment' as bucket, id, reference, applicant, status, form_state, payment_state, documents_state, screening_state, review_state, interview_state, submitted_at, updated_at
  from base where payment_state = 'processing'
  union all
  select 'documents', id, reference, applicant, status, form_state, payment_state, documents_state, screening_state, review_state, interview_state, submitted_at, updated_at
  from base where documents_state in ('pending','partial','rejected') and form_state in ('submitted','resubmitted')
  union all
  select 'screening', id, reference, applicant, status, form_state, payment_state, documents_state, screening_state, review_state, interview_state, submitted_at, updated_at
  from base where screening_state in ('not_started','in_progress','failed','correction_required') and form_state in ('submitted','resubmitted')
  union all
  select 'action', id, reference, applicant, status, form_state, payment_state, documents_state, screening_state, review_state, interview_state, submitted_at, updated_at
  from base where form_state = 'action_required'
  union all
  select 'review', id, reference, applicant, status, form_state, payment_state, documents_state, screening_state, review_state, interview_state, submitted_at, updated_at
  from base where review_state in ('assigned','in_progress')
  union all
  select 'interview', id, reference, applicant, status, form_state, payment_state, documents_state, screening_state, review_state, interview_state, submitted_at, updated_at
  from base where interview_state = 'scheduled'
  union all
  select 'decision', id, reference, applicant, status, form_state, payment_state, documents_state, screening_state, review_state, interview_state, submitted_at, updated_at
  from base where review_state = 'completed' and decision_state = 'pending'
  union all
  select 'clearance', id, reference, applicant, status, form_state, payment_state, documents_state, screening_state, review_state, interview_state, submitted_at, updated_at
  from base where status = 'accepted'::classroom.application_status
    and clearance_state in ('not_started','in_progress','pending_action','rejected');
$fn$;

grant execute on function classroom.admissions_queues(uuid) to authenticated;


/* =============================================================================
   6. write_audit_log — teach it about the three new Phase 4 tables
   ---------------------------------------------------------------------------
   clearance_departments carries school_id directly, so the existing fast
   path (062) already covers it once the trigger is attached below.
   clearance_checklists and original_verifications only carry
   application_id, same shape as every other Phase 1-3 child table, so they
   join through applications exactly like applicant_documents does.
   Everything above the two new CASE lines is the deployed 062 body,
   unchanged.
   ============================================================================= */

create or replace function classroom.write_audit_log()
returns trigger
language plpgsql security definer
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

do $$
declare
  t text;
begin
  foreach t in array array['clearance_departments','clearance_checklists','original_verifications']
  loop
    execute format(
      'drop trigger if exists audit_trg on classroom.%I;
       create trigger audit_trg after insert or update or delete on classroom.%I
         for each row execute function classroom.write_audit_log();',
      t, t
    );
  end loop;
end $$;


notify pgrst, 'reload schema';
