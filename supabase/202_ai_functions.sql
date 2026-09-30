-- The school's own database functions, for the AI assistant.
--
-- The assistant's named actions (192 onwards) will never cover everything a
-- school does: approving a result sheet, recalculating an exam attempt,
-- waiving a document, voiding a store sale... Each of those is already a
-- function here, with its own permission checks and business rules. This
-- lists the ones a signed-in person may call, so the assistant can find the
-- right one, run it straight away if it only reads (a report, a balance),
-- and propose it on a Confirm card if it changes anything. It always runs as
-- the person, so each function's own checks decide what they may do.
--
-- Left out: the platform console's functions, account plumbing the app calls
-- on its own (password flags, push subscriptions), exam-sitting mechanics
-- (a person sits their own exam in the exam page), and internal helpers.
create or replace function classroom.ai_functions()
returns jsonb
language sql
stable
security definer
set search_path = classroom, public
as $fn$
  select coalesce(jsonb_agg(jsonb_build_object(
           'name', p.proname,
           'args', pg_get_function_arguments(p.oid),
           'arg_names', coalesce(to_jsonb(p.proargnames), '[]'::jsonb),
           'returns', pg_get_function_result(p.oid),
           'reads_only', p.provolatile <> 'v',
           'about', left(coalesce(obj_description(p.oid, 'pg_proc'), ''), 240)
         ) order by p.proname), '[]'::jsonb)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'classroom'
     and p.prokind = 'f'
     and p.prorettype <> 'trigger'::regtype
     and has_function_privilege('authenticated', p.oid, 'execute')
     and p.proname !~ '^(platform_|can_|is_|has_|acct_|ai_|audit|write_audit|tidy|current_|public_)'
     and p.proname not in (
       'create_school', 'start_trial_school', 'join_school', 'slug_available',
       'save_push_subscription', 'password_changed', 'require_password_change',
       'storage_path_unclaimed', 'try_uuid', 'start_exam_attempt', 'submit_exam_attempt',
       'record_exam_violation', 'attempt_deadline', 'attempt_is_open', 'reference_year',
       'next_invoice_reference', 'next_ticket_number', 'actor_label', 'admissions_actor_label',
       'profile_label', 'format_money', 'may_touch_payment_proof', 'notice_is_for_me',
       'course_is_visible', 'payroll_run_released', 'invoice_applicant_name'
     );
$fn$;

revoke all on function classroom.ai_functions() from public, anon, authenticated;
grant execute on function classroom.ai_functions() to service_role;
