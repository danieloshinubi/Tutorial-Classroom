-- Server functions locked down to who actually needs them (2026-10-15).
--
-- Postgres lets everyone (PUBLIC, so also logged-out visitors) run a new
-- function unless told otherwise, and most here were never told. Listed
-- from the live database: a function stays callable by logged-out visitors
-- only if the app calls it by name, or a row-level rule, view or ordinary
-- function uses it; an internal helper nothing outside calls is closed to
-- users altogether (server functions and the service role still use it).

-- Not needed by logged-out visitors: signed-in users keep them.
grant execute on function classroom.ai_whoami() to authenticated, service_role;
revoke execute on function classroom.ai_whoami() from public, anon;
grant execute on function classroom.mail_snippet(text) to authenticated, service_role;
revoke execute on function classroom.mail_snippet(text) from public, anon;
grant execute on function classroom.module_access(uuid,text) to authenticated, service_role;
revoke execute on function classroom.module_access(uuid,text) from public, anon;
grant execute on function classroom.can_view_bursary(uuid) to authenticated, service_role;
revoke execute on function classroom.can_view_bursary(uuid) from public, anon;
grant execute on function classroom.can_view_store(uuid) to authenticated, service_role;
revoke execute on function classroom.can_view_store(uuid) from public, anon;
grant execute on function classroom.can_view_payroll(uuid) to authenticated, service_role;
revoke execute on function classroom.can_view_payroll(uuid) from public, anon;
grant execute on function classroom.can_do_store(uuid) to authenticated, service_role;
revoke execute on function classroom.can_do_store(uuid) from public, anon;
grant execute on function classroom.attempt_is_open(uuid) to authenticated, service_role;
revoke execute on function classroom.attempt_is_open(uuid) from public, anon;
grant execute on function classroom.may_view_payment_proof(text) to authenticated, service_role;
revoke execute on function classroom.may_view_payment_proof(text) from public, anon;
grant execute on function classroom.has_role_in(uuid,classroom.member_role[]) to authenticated, service_role;
revoke execute on function classroom.has_role_in(uuid,classroom.member_role[]) from public, anon;
grant execute on function classroom.is_school_admin(uuid) to authenticated, service_role;
revoke execute on function classroom.is_school_admin(uuid) from public, anon;
grant execute on function classroom.is_school_staff(uuid) to authenticated, service_role;
revoke execute on function classroom.is_school_staff(uuid) from public, anon;
grant execute on function classroom.reference_year(text) to authenticated, service_role;
revoke execute on function classroom.reference_year(text) from public, anon;
grant execute on function classroom.is_guardian_of(uuid) to authenticated, service_role;
revoke execute on function classroom.is_guardian_of(uuid) from public, anon;
grant execute on function classroom.can_release_results(uuid) to authenticated, service_role;
revoke execute on function classroom.can_release_results(uuid) from public, anon;
grant execute on function classroom.is_applicant_for(uuid) to authenticated, service_role;
revoke execute on function classroom.is_applicant_for(uuid) from public, anon;
grant execute on function classroom.rt_body(text,text,jsonb,jsonb) to authenticated, service_role;
revoke execute on function classroom.rt_body(text,text,jsonb,jsonb) from public, anon;
grant execute on function classroom.is_my_family_sheet(uuid) to authenticated, service_role;
revoke execute on function classroom.is_my_family_sheet(uuid) from public, anon;
grant execute on function classroom.can_do_admissions(uuid) to authenticated, service_role;
revoke execute on function classroom.can_do_admissions(uuid) from public, anon;
grant execute on function classroom.can_do_bursary(uuid) to authenticated, service_role;
revoke execute on function classroom.can_do_bursary(uuid) from public, anon;
grant execute on function classroom.can_manage_timetable(uuid) to authenticated, service_role;
revoke execute on function classroom.can_manage_timetable(uuid) from public, anon;
grant execute on function classroom.can_post_notices(uuid) to authenticated, service_role;
revoke execute on function classroom.can_post_notices(uuid) from public, anon;
grant execute on function classroom.notice_is_for_me(uuid,classroom.notice_audience) to authenticated, service_role;
revoke execute on function classroom.notice_is_for_me(uuid,classroom.notice_audience) from public, anon;
grant execute on function classroom.may_touch_payment_proof(text) to authenticated, service_role;
revoke execute on function classroom.may_touch_payment_proof(text) from public, anon;
grant execute on function classroom.is_allowed_reaction(text) to authenticated, service_role;
revoke execute on function classroom.is_allowed_reaction(text) from public, anon;
grant execute on function classroom.is_my_invoice(uuid) to authenticated, service_role;
revoke execute on function classroom.is_my_invoice(uuid) from public, anon;
grant execute on function classroom.ticket_bare_subject(text) to authenticated, service_role;
revoke execute on function classroom.ticket_bare_subject(text) from public, anon;
grant execute on function classroom.can_access_ticket(uuid) to authenticated, service_role;
revoke execute on function classroom.can_access_ticket(uuid) from public, anon;
grant execute on function classroom.can_mark_attendance(uuid) to authenticated, service_role;
revoke execute on function classroom.can_mark_attendance(uuid) from public, anon;
grant execute on function classroom.acct_invoice_label(uuid) to authenticated, service_role;
revoke execute on function classroom.acct_invoice_label(uuid) from public, anon;
grant execute on function classroom.is_chat_channel_admin(uuid) to authenticated, service_role;
revoke execute on function classroom.is_chat_channel_admin(uuid) from public, anon;
grant execute on function classroom.format_money(numeric,text) to authenticated, service_role;
revoke execute on function classroom.format_money(numeric,text) from public, anon;
grant execute on function classroom.acct_local_date(uuid,timestamp with time zone) to authenticated, service_role;
revoke execute on function classroom.acct_local_date(uuid,timestamp with time zone) from public, anon;
grant execute on function classroom.acct_enabled(uuid,date) to authenticated, service_role;
revoke execute on function classroom.acct_enabled(uuid,date) from public, anon;
grant execute on function classroom.acct_swap(jsonb) to authenticated, service_role;
revoke execute on function classroom.acct_swap(jsonb) from public, anon;
grant execute on function classroom.acct_store_sale_lines(uuid) to authenticated, service_role;
revoke execute on function classroom.acct_store_sale_lines(uuid) from public, anon;
grant execute on function classroom.can_see_envelope(uuid) to authenticated, service_role;
revoke execute on function classroom.can_see_envelope(uuid) from public, anon;
grant execute on function classroom.acct_invoice_lines(uuid) to authenticated, service_role;
revoke execute on function classroom.acct_invoice_lines(uuid) from public, anon;
grant execute on function classroom.can_see_person(uuid) to authenticated, service_role;
revoke execute on function classroom.can_see_person(uuid) from public, anon;
grant execute on function classroom.module_override(uuid,text) to authenticated, service_role;
revoke execute on function classroom.module_override(uuid,text) from public, anon;
grant execute on function classroom.can_do_payroll(uuid) to authenticated, service_role;
revoke execute on function classroom.can_do_payroll(uuid) from public, anon;
grant execute on function classroom.can_work_ticket(uuid) to authenticated, service_role;
revoke execute on function classroom.can_work_ticket(uuid) from public, anon;
grant execute on function classroom.payroll_run_released(uuid) to authenticated, service_role;
revoke execute on function classroom.payroll_run_released(uuid) from public, anon;
grant execute on function classroom.owns_mailbox(uuid) to authenticated, service_role;
revoke execute on function classroom.owns_mailbox(uuid) from public, anon;
grant execute on function classroom.can_teach_result(uuid,uuid) to authenticated, service_role;
revoke execute on function classroom.can_teach_result(uuid,uuid) from public, anon;
grant execute on function classroom.default_grade_bands() to authenticated, service_role;
revoke execute on function classroom.default_grade_bands() from public, anon;
grant execute on function classroom.in_period(timestamp with time zone,timestamp with time zone,timestamp with time zone) to authenticated, service_role;
revoke execute on function classroom.in_period(timestamp with time zone,timestamp with time zone,timestamp with time zone) from public, anon;
grant execute on function classroom.audit_addresses(jsonb) to authenticated, service_role;
revoke execute on function classroom.audit_addresses(jsonb) from public, anon;

-- Internal helpers: called only inside other server functions or by the
-- service role (notify_course could send any school a fake notification;
-- profile_label returned anyone's email; sznd_school_balance any school's
-- wallet; ai_tokens_this_month, next_ticket_number and others leaked counts).
grant execute on function classroom.mail_unread(uuid) to service_role;
revoke execute on function classroom.mail_unread(uuid) from public, anon, authenticated;
grant execute on function classroom.is_teaching_staff(uuid,uuid) to service_role;
revoke execute on function classroom.is_teaching_staff(uuid,uuid) from public, anon, authenticated;
grant execute on function classroom.my_role() to service_role;
revoke execute on function classroom.my_role() from public, anon, authenticated;
grant execute on function classroom.is_admin() to service_role;
revoke execute on function classroom.is_admin() from public, anon, authenticated;
grant execute on function classroom.is_staff() to service_role;
revoke execute on function classroom.is_staff() from public, anon, authenticated;
grant execute on function classroom.can_do_accounts(uuid) to service_role;
revoke execute on function classroom.can_do_accounts(uuid) from public, anon, authenticated;
grant execute on function classroom.sznd_school_balance(uuid) to service_role;
revoke execute on function classroom.sznd_school_balance(uuid) from public, anon, authenticated;
grant execute on function classroom.payroll_approver_label(uuid) to service_role;
revoke execute on function classroom.payroll_approver_label(uuid) from public, anon, authenticated;
grant execute on function classroom.attempt_deadline(uuid) to service_role;
revoke execute on function classroom.attempt_deadline(uuid) from public, anon, authenticated;
grant execute on function classroom.course_is_visible(uuid) to service_role;
revoke execute on function classroom.course_is_visible(uuid) from public, anon, authenticated;
grant execute on function classroom.my_school_ids() to service_role;
revoke execute on function classroom.my_school_ids() from public, anon, authenticated;
grant execute on function classroom.can_view_student(uuid) to service_role;
revoke execute on function classroom.can_view_student(uuid) from public, anon, authenticated;
grant execute on function classroom.next_invoice_reference(uuid,uuid) to service_role;
revoke execute on function classroom.next_invoice_reference(uuid,uuid) from public, anon, authenticated;
grant execute on function classroom.admissions_actor_label() to service_role;
revoke execute on function classroom.admissions_actor_label() from public, anon, authenticated;
grant execute on function classroom.can_finalise_admission(uuid) to service_role;
revoke execute on function classroom.can_finalise_admission(uuid) from public, anon, authenticated;
grant execute on function classroom.refresh_documents_state(uuid) to service_role;
revoke execute on function classroom.refresh_documents_state(uuid) from public, anon, authenticated;
grant execute on function classroom.recompute_clearance_state(uuid) to service_role;
revoke execute on function classroom.recompute_clearance_state(uuid) from public, anon, authenticated;
grant execute on function classroom.next_ticket_number(uuid) to service_role;
revoke execute on function classroom.next_ticket_number(uuid) from public, anon, authenticated;
grant execute on function classroom.ai_tokens_this_month(uuid) to service_role;
revoke execute on function classroom.ai_tokens_this_month(uuid) from public, anon, authenticated;
grant execute on function classroom.profile_label(uuid) to service_role;
revoke execute on function classroom.profile_label(uuid) from public, anon, authenticated;
grant execute on function classroom.ai_allowance(uuid) to service_role;
revoke execute on function classroom.ai_allowance(uuid) from public, anon, authenticated;
grant execute on function classroom.undo_carry_forward(uuid) to service_role;
revoke execute on function classroom.undo_carry_forward(uuid) from public, anon, authenticated;
grant execute on function classroom.module_level(uuid,text,classroom.member_role[]) to service_role;
revoke execute on function classroom.module_level(uuid,text,classroom.member_role[]) from public, anon, authenticated;
grant execute on function classroom.mail_domain(uuid) to service_role;
revoke execute on function classroom.mail_domain(uuid) from public, anon, authenticated;
grant execute on function classroom.result_sheet_label(classroom.result_sheets) to service_role;
revoke execute on function classroom.result_sheet_label(classroom.result_sheets) from public, anon, authenticated;
grant execute on function classroom.result_sheet_teachers(classroom.result_sheets) to service_role;
revoke execute on function classroom.result_sheet_teachers(classroom.result_sheets) from public, anon, authenticated;
grant execute on function classroom.mail_admin_set_members(uuid,jsonb) to service_role;
revoke execute on function classroom.mail_admin_set_members(uuid,jsonb) from public, anon, authenticated;
grant execute on function classroom.can_set_grading(uuid) to service_role;
revoke execute on function classroom.can_set_grading(uuid) from public, anon, authenticated;
-- school_rank: used by the owner guard below, which runs as the signed-in user.
grant execute on function classroom.school_rank(uuid,uuid) to authenticated, service_role;
revoke execute on function classroom.school_rank(uuid,uuid) from public, anon;
grant execute on function classroom.course_teacher_ids(uuid) to service_role;
revoke execute on function classroom.course_teacher_ids(uuid) from public, anon, authenticated;
grant execute on function classroom.is_course_teacher(uuid,uuid) to service_role;
revoke execute on function classroom.is_course_teacher(uuid,uuid) from public, anon, authenticated;
grant execute on function classroom.notify_course(uuid,text,text,text,text,uuid) to service_role;
revoke execute on function classroom.notify_course(uuid,text,text,text,text,uuid) from public, anon, authenticated;

-- Called by Edge Functions as the signed-in user: not for logged-out visitors.
grant execute on function classroom.email_change_blocker(uuid,uuid) to authenticated, service_role;
revoke execute on function classroom.email_change_blocker(uuid,uuid) from public, anon;
grant execute on function classroom.payable_now(uuid) to authenticated, service_role;
revoke execute on function classroom.payable_now(uuid) from public, anon;
grant execute on function classroom.mail_can_import(uuid) to authenticated, service_role;
revoke execute on function classroom.mail_can_import(uuid) from public, anon;
grant execute on function classroom.can_manage_member_account(uuid,uuid) to authenticated, service_role;
revoke execute on function classroom.can_manage_member_account(uuid,uuid) from public, anon;
grant execute on function classroom.gateway_settings_for_payer(uuid) to authenticated, service_role;
revoke execute on function classroom.gateway_settings_for_payer(uuid) from public, anon;
grant execute on function classroom.mail_import_append(uuid,text,bigint) to authenticated, service_role;
revoke execute on function classroom.mail_import_append(uuid,text,bigint) from public, anon;
grant execute on function classroom.mail_import_finish(uuid) to authenticated, service_role;
revoke execute on function classroom.mail_import_finish(uuid) from public, anon;
grant execute on function classroom.mail_admin_box(uuid) to authenticated, service_role;
revoke execute on function classroom.mail_admin_box(uuid) from public, anon;

-- New functions from here on: signed-in users and the service role only,
-- never logged-out visitors by default (grant anon explicitly when a public
-- page really needs one).
alter default privileges in schema classroom revoke execute on functions from public;
alter default privileges in schema classroom grant execute on functions to authenticated, service_role;

/* ------------------------------------------------- staff mailboxes guard */

-- A person edits their own mailbox's settings (name, signature, automatic
-- reply, undo, alerts) but not what it IS: its address, older addresses,
-- school, owner, kind, size limit or whether it is active. Those change only
-- through School admin → Mail (the mail_admin_* server functions). Without
-- this, staff could take any address (even another school's) and receive
-- colleagues' mail by listing their address as one of their own.
create or replace function classroom.mail_mailboxes_guard()
returns trigger language plpgsql set search_path = classroom, public as $fn$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if new.address is distinct from old.address
     or new.previous_addresses is distinct from old.previous_addresses
     or new.school_id is distinct from old.school_id
     or new.user_id is distinct from old.user_id
     or new.kind is distinct from old.kind
     or new.quota_bytes is distinct from old.quota_bytes
     or new.used_bytes is distinct from old.used_bytes
     or new.is_active is distinct from old.is_active then
    raise exception 'A mailbox''s address, size and status are changed by the school''s admin, under School admin → Mail.';
  end if;
  return new;
end;
$fn$;
drop trigger if exists mail_mailboxes_guard on classroom.mail_mailboxes;
create trigger mail_mailboxes_guard before update on classroom.mail_mailboxes
  for each row execute function classroom.mail_mailboxes_guard();

/* ---------------------------------------------- owners and own roles */

-- Only an owner makes, changes or removes an owner (owners approve payroll,
-- among other things); nobody changes their own role.
create or replace function classroom.school_members_role_guard()
returns trigger language plpgsql set search_path = classroom, public as $fn$
declare
  school uuid := coalesce(new.school_id, old.school_id);
begin
  if current_user not in ('authenticated', 'anon') then return coalesce(new, old); end if;
  if classroom.is_platform_admin() then return coalesce(new, old); end if;
  if ((tg_op <> 'DELETE' and new.role::text = 'owner') or (tg_op <> 'INSERT' and old.role::text = 'owner'))
     and classroom.school_rank(school, auth.uid()) <> 1 then
    raise exception 'Only an owner can make, change or remove an owner.';
  end if;
  if tg_op = 'UPDATE' and old.user_id = auth.uid() and new.role is distinct from old.role then
    raise exception 'You cannot change your own role. Ask another administrator.';
  end if;
  return coalesce(new, old);
end;
$fn$;
drop trigger if exists school_members_role_guard on classroom.school_members;
create trigger school_members_role_guard before insert or update or delete on classroom.school_members
  for each row execute function classroom.school_members_role_guard();

notify pgrst, 'reload schema';
