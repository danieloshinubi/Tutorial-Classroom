-- =============================================================================
-- claim_application() never applied the admission-config fee rules —
-- start_application() (115_admissions_payment_fixes.sql) does this for the
-- account-based /Apply/Account → /Apply/Start journey, but an application
-- that came in through the plain anonymous /Apply form and was only later
-- linked to an account via claim_application() never went through that
-- logic at all. Its payment_state sits at its default 'not_required'
-- forever, regardless of what the school's fee config says — not because
-- the fee genuinely doesn't apply, but because nothing ever checked.
--
-- Same fee-invoice shape as start_application(): one invoice_items row so
-- invoice_balances actually sums to something, payment_state flips to
-- 'unpaid'. Guarded so this only ever fires once per application — a
-- second claim attempt (already handled above by the "already linked"
-- exception) or a config re-check on an application that already resolved
-- its fee one way or another never double-invoices.
-- =============================================================================

create or replace function classroom.claim_application(
  target_reference text,
  target_email     text
) returns classroom.applications
language plpgsql security definer
set search_path = classroom, public
as $fn$
declare
  app  classroom.applications;
  acct classroom.applicant_accounts;
  cfg  jsonb;
  invoice_id uuid;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to claim an application';
  end if;

  select * into app from classroom.applications
  where upper(btrim(reference)) = upper(btrim(target_reference))
    and lower(guardian_email) = lower(btrim(target_email));
  if not found then
    raise exception 'That reference and email do not go together';
  end if;

  if app.applicant_id is not null then
    select * into acct from classroom.applicant_accounts where id = app.applicant_id;
    if found and acct.user_id = auth.uid() then
      return app;
    end if;
    raise exception 'This application is already linked to an account. Sign in with that account, or contact the school.';
  end if;

  select * into acct from classroom.applicant_accounts
  where school_id = app.school_id and user_id = auth.uid();
  if not found then
    insert into classroom.applicant_accounts
      (school_id, user_id, email, phone, first_name, surname)
    values
      (app.school_id, auth.uid(), lower(btrim(target_email)), app.guardian_phone,
       app.first_name, app.surname)
    returning * into acct;
  end if;

  update classroom.applications
  set applicant_id     = acct.id,
      personal_info    = coalesce(personal_info, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
        'first_name',    app.first_name,
        'middle_name',   app.middle_name,
        'surname',       app.surname,
        'date_of_birth', app.date_of_birth,
        'gender',        app.gender,
        'address',       app.address,
        'email',         lower(btrim(target_email)),
        'phone',         app.guardian_phone
      )),
      education_history = coalesce(education_history, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
        'school_name', app.previous_school
      )),
      next_of_kin      = coalesce(next_of_kin, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
        'name',         app.guardian_name,
        'relationship', app.guardian_relation,
        'phone',        app.guardian_phone,
        'email',        app.guardian_email,
        'address',      app.address
      )),
      updated_at = now()
  where id = app.id
  returning * into app;

  -- Apply the admission-config fee rules — the same check start_application()
  -- already does, run here for the first time for an application that took
  -- the anonymous-then-claimed route instead.
  if app.payment_state = 'not_required' then
    cfg := classroom.effective_admission_config(app.school_id, app.session_id);
    if coalesce((cfg->>'application_fee_enabled')::boolean, false)
       and not exists (
         select 1 from classroom.invoices
         where application_id = app.id and purpose = 'application_fee'
       ) then
      insert into classroom.invoices (
        school_id, session_id, structure_id, student_id,
        reference, seq, status, purpose, application_id, notes, issued_at, created_by
      ) values (
        app.school_id, app.session_id, null, null,
        app.reference || '-AF', app.seq, 'issued', 'application_fee', app.id,
        'Application fee — ' || app.reference, now(), auth.uid()
      )
      returning id into invoice_id;

      insert into classroom.invoice_items (invoice_id, name, amount, position)
      values (invoice_id, 'Application fee', coalesce((cfg->>'application_fee_amount')::numeric, 0), 0);

      update classroom.applications
      set payment_state = 'unpaid'
      where id = app.id
      returning * into app;
    end if;
  end if;

  insert into classroom.application_events
    (application_id, status_from, status_to, actor_id, actor_label, note)
  values
    (app.id, app.status, app.status, auth.uid(), 'Applicant',
     case
       when app.payment_state = 'unpaid'
         then 'Application claimed and linked to an account — fee invoice generated'
       else 'Application claimed and linked to an account'
     end);

  return app;
end;
$fn$;

grant execute on function classroom.claim_application(text, text) to authenticated;

notify pgrst, 'reload schema';
