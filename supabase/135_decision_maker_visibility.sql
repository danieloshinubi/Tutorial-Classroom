-- =============================================================================
-- decide_application() already writes applications.decided_by/decided_at on
-- every offer/reject/waitlist/defer (and its finaliser guard already limits
-- who can do that to owner/admin/principal — Proprietor, per the People
-- panel's own label for "owner" — so nothing changes there: that gate was
-- already correct). What was missing is anywhere in the UI actually reading
-- decided_by back — application_workspace() hands the whole applications
-- row over as jsonb, decided_by included, but only ever as a bare uuid, so
-- AdmissionsWorkspace.jsx had nothing displayable to show.
--
-- classroom.profile_label() is the existing admissions_actor_label() name-
-- resolution rule (real name, else username, else email), pulled out into a
-- parameterised version so it can be pointed at any profile id, not just
-- auth.uid(). application_workspace() gains one new top-level key,
-- decided_by_name, resolved the same way.
-- =============================================================================

create or replace function classroom.profile_label(target_profile uuid)
returns text
language sql stable security definer
set search_path = classroom, public
as $fn$
  select coalesce(
    nullif(btrim(p.first_name || ' ' || p.surname), ''),
    p.username,
    p.email
  ) from classroom.profiles p where p.id = target_profile;
$fn$;

grant execute on function classroom.profile_label(uuid) to authenticated;

create or replace function classroom.application_workspace(target_application uuid, target_school uuid)
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
  if app.school_id <> target_school then
    raise exception 'Application not found in this school';
  end if;
  if not classroom.can_do_admissions(app.school_id) then
    raise exception 'Only admissions staff can open the workspace';
  end if;

  select jsonb_build_object(
    'application', to_jsonb(app),
    'decided_by_name', case when app.decided_by is not null
                             then classroom.profile_label(app.decided_by) end,
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
    'application_invoice', (
      select jsonb_build_object(
        'invoice', to_jsonb(i),
        'payments', coalesce((select jsonb_agg(to_jsonb(p) order by p.submitted_at desc)
                               from classroom.payments p where p.invoice_id = i.id), '[]'::jsonb)
      )
      from classroom.invoices i
      where i.application_id = app.id and i.purpose = 'application_fee'
      order by i.issued_at desc limit 1
    ),
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

grant execute on function classroom.application_workspace(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
