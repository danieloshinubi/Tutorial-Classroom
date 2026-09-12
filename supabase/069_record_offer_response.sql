-- =============================================================================
-- Found live, demoing a genuinely anonymous application through to an offer:
-- accept_offer()/decline_offer() (050) both require is_applicant_for(), which
-- is always false for an anonymous application (no applicant_accounts row —
-- there is no account to be the applicant for). Once such an application
-- reaches 'offered', nothing in the UI or the database let staff move it any
-- further — not decide_application() either, since accepting is really
-- accept_offer()'s job (the acceptance-fee invoice, admission_offers.status,
-- offer_state) and decide_application() was never taught any of that.
--
-- record_offer_response() is accept_offer()/decline_offer()'s own logic,
-- verbatim, with is_applicant_for() swapped for can_finalise_admission() —
-- for the one case those two functions cannot handle: a family who told the
-- school by phone or email, not through a dashboard that does not exist for
-- them. Refuses outright when the applicant does have their own account, so
-- staff can never override a pending self-service decision by accident.
-- =============================================================================

create or replace function classroom.record_offer_response(
  target_offer uuid,
  response     text,
  note_in      text default null
) returns classroom.applications
language plpgsql security definer
set search_path = classroom, public
as $fn$
declare
  offer classroom.admission_offers;
  app   classroom.applications;
  cfg   jsonb;
  invoice_id uuid;
  fee_note text := '';
  who text;
begin
  if response not in ('accepted', 'declined') then
    raise exception 'Unknown response: %', response;
  end if;

  select * into offer from classroom.admission_offers where id = target_offer;
  if not found then
    raise exception 'No such offer';
  end if;

  select * into app from classroom.applications where id = offer.application_id;

  if not classroom.can_finalise_admission(app.school_id) then
    raise exception 'Only owner/admin/principal can record a response on the applicant''s behalf';
  end if;

  if app.applicant_id is not null then
    raise exception 'This applicant has their own account — they accept or decline the offer themselves';
  end if;

  if offer.status <> 'issued' then
    raise exception 'This offer is %, not open to respond to', offer.status;
  end if;

  if offer.expires_at is not null and offer.expires_at < now() then
    update classroom.admission_offers
    set status = 'expired', updated_at = now()
    where id = target_offer;
    raise exception 'This offer expired on %', to_char(offer.expires_at, 'DD Mon YYYY');
  end if;

  who := classroom.admissions_actor_label();

  if response = 'accepted' then
    update classroom.admission_offers
    set status = 'accepted', accepted_at = now(), updated_at = now()
    where id = target_offer;

    cfg := classroom.effective_admission_config(app.school_id, app.session_id);

    update classroom.applications
    set status = 'accepted'::classroom.application_status,
        offer_state = 'accepted',
        payment_state = case
          when coalesce((cfg->>'acceptance_fee_enabled')::boolean, false) then 'unpaid'
          else payment_state
        end,
        updated_at = now()
    where id = app.id
    returning * into app;

    if coalesce((cfg->>'acceptance_fee_enabled')::boolean, false) then
      insert into classroom.invoices (
        school_id, session_id, structure_id, student_id,
        reference, seq, status, purpose, application_id, notes, issued_at, created_by
      ) values (
        app.school_id, app.session_id, null, null,
        app.reference || '-ACF', app.seq, 'issued', 'acceptance_fee', app.id,
        'Acceptance fee — ' || app.reference, now(), auth.uid()
      )
      returning id into invoice_id;
      fee_note := ', acceptance-fee invoice generated';
    end if;

    insert into classroom.application_events
      (application_id, status_from, status_to, actor_id, actor_label, note)
    values
      (app.id, 'offered'::classroom.application_status, 'accepted'::classroom.application_status,
       auth.uid(), who,
       'Offer accepted on the applicant''s behalf' || fee_note
       || case when note_in is not null then ' — ' || note_in else '' end);
  else
    update classroom.admission_offers
    set status = 'declined', declined_at = now(), decline_reason = note_in, updated_at = now()
    where id = target_offer;

    update classroom.applications
    set status = 'declined'::classroom.application_status,
        offer_state = 'declined',
        updated_at = now()
    where id = app.id
    returning * into app;

    insert into classroom.application_events
      (application_id, status_from, status_to, actor_id, actor_label, note)
    values
      (app.id, 'offered'::classroom.application_status, 'declined'::classroom.application_status,
       auth.uid(), who,
       'Offer declined on the applicant''s behalf'
       || case when note_in is not null then ' — ' || note_in else '' end);
  end if;

  return app;
end;
$fn$;

grant execute on function classroom.record_offer_response(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
