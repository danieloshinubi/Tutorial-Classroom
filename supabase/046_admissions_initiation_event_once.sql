-- =============================================================================
-- Admissions validation pass — pay_application_fee_initiated writes one
-- event per real transition, not per call.
--
-- A jittery client polling initiation was writing "Payment initiated" every
-- time. The state is idempotent (unpaid → processing, subsequent no-op)
-- but the timeline was noisy. Same shape of fix as 045.
-- =============================================================================

create or replace function classroom.pay_application_fee_initiated(
  target_application uuid
) returns classroom.applications
language plpgsql security definer
set search_path = classroom, public
as $fn$
declare
  app classroom.applications;
  actually_changed boolean := false;
begin
  if not classroom.is_applicant_for(target_application) then
    raise exception 'You cannot pay for this application';
  end if;

  update classroom.applications
  set payment_state = 'processing', updated_at = now()
  where id = target_application and payment_state in ('unpaid','rejected')
  returning * into app;

  if found then
    actually_changed := true;
  else
    select * into app from classroom.applications where id = target_application;
  end if;

  if actually_changed then
    insert into classroom.application_events
      (application_id, status_from, status_to, actor_id, actor_label, note)
    values
      (app.id, app.status, app.status, auth.uid(), 'Applicant',
       'Payment initiated');
  end if;

  return app;
end;
$fn$;

grant execute on function classroom.pay_application_fee_initiated(uuid) to authenticated;
