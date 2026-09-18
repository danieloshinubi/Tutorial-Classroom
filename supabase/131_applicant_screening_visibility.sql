-- =============================================================================
-- The applicant's own dashboard has no visibility into screening at all —
-- confirmed live: staff see "Online Interview: passed, On-site Interview:
-- passed, Common Entrance Exam: pending" on a real application, while the
-- applicant looking at the exact same application sees only the generic
-- Progress tracker's "Under review" dot lit up, with no idea which of the
-- school's actual steps they've cleared or what's still outstanding.
-- application_screening_items has no applicant-facing read path at all —
-- only "staff read screening items" (048_admissions_phase2_functions.sql)
-- exists. Same shape as my_application_documents()
-- (104_admissions_claim_and_document_prep.sql): a security-definer RPC
-- gated on is_applicant_for(), not a raw RLS policy, since a plain SELECT
-- policy would need the same applicant_accounts join duplicated at the
-- table level for no benefit over one function.
-- =============================================================================

create or replace function classroom.my_application_screening(target_application uuid)
returns jsonb
language plpgsql stable security definer
set search_path = classroom, public
as $fn$
begin
  if not classroom.is_applicant_for(target_application) then
    raise exception 'Not your application';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', i.id,
             'kind', i.kind,
             'label', i.label,
             'is_required', i.is_required,
             'status', i.status,
             'decision_note', i.decision_note
           ) order by i.position, i.label)
    from classroom.application_screening_items i
    where i.application_id = target_application
  ), '[]'::jsonb);
end;
$fn$;

grant execute on function classroom.my_application_screening(uuid) to authenticated;

notify pgrst, 'reload schema';
