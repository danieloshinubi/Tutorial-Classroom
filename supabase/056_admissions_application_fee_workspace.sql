-- =============================================================================
-- The application-fee invoice was never surfaced to staff
--
-- verify_application_payment() (040_admissions_engine.sql) has existed since
-- Phase 1, grantable to bursar/admissions/owner/admin/principal — but no
-- screen ever called it. A bursar had no way to see a pending application-fee
-- payment declaration at all, let alone approve it; the only working manual
-- "verify payment" button in the whole app is Phase 3's acceptance-fee one.
--
-- Same shape as acceptance_invoice, added to application_workspace() so the
-- staff workspace can show and approve the application fee too, in the same
-- single round trip.
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
    -- The application fee, raised at start_application() — the very first
    -- payment gate, distinct from the acceptance fee below it.
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
    )
  ) into out;

  return out;
end;
$fn$;

grant execute on function classroom.application_workspace(uuid) to authenticated;

notify pgrst, 'reload schema';
