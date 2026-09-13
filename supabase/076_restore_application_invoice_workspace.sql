-- =============================================================================
-- Restores application_workspace()'s missing 'application_invoice' key
--
-- 056_admissions_application_fee_workspace.sql originally gave
-- application_workspace() both an 'application_invoice' key (purpose =
-- 'application_fee') and an 'acceptance_invoice' key (purpose =
-- 'acceptance_fee'). 064_admissions_phase4_functions.sql replaced the whole
-- function body (CREATE OR REPLACE replaces, it does not merge) to add
-- Phase 4's clearance keys, and the rebuilt jsonb_build_object kept
-- 'acceptance_invoice' but silently dropped 'application_invoice' — despite
-- 064's own header comment claiming the function was merely "extended in
-- place... same columns/keys, just more of them."
--
-- The effect: AdmissionsWorkspace.jsx's "Application fee" card (guarded on
-- applicationInvoice?.invoice, using workspace.application_invoice) has
-- never rendered since 064 shipped, for any school charging an application
-- fee — a bursar/admissions officer had no way to see a submitted proof of
-- payment or click "Verify payment", regardless of what actually exists in
-- the database. Found live, while walking a fresh applicant through a
-- payment-gated application end to end.
--
-- This restores that one key, in the exact same shape as the
-- acceptance_invoice key beside it, and touches nothing else.
--
-- Run after 064. Safe to re-run.
-- =============================================================================

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

notify pgrst, 'reload schema';
