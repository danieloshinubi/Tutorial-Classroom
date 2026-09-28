-- "My bills" means bills for me or my own children, never every bill I am
-- allowed to read.
--
-- Found in testing: signed in as the owner, the parent Fees page showed every
-- family's term bills as the owner's own ("Still to pay ₦424,000 on 2
-- bills") with live Pay now and I already paid buttons. The page read
-- invoice_balances and left the narrowing to RLS, and RLS has three read
-- rules, not two: families read their children's bills, applicants read
-- their application fees, and the bursary (owner, admin, bursar) reads every
-- bill in the school. That last rule is right for Bursary and wrong here.
-- The route is now guarded as well (App.js), but a member of staff can also
-- be a parent at the school, and would still have seen every family.
--
-- This view keeps only the first two rules, on top of RLS
-- (security_invoker), so it can never show more than invoice_balances would.
-- The predicates are the same as the policies "families read their issued
-- invoices" and "applicants read their fee invoice" on classroom.invoices.

create or replace view classroom.my_invoice_balances
with (security_invoker = true) as
select b.*
from classroom.invoice_balances b
join classroom.invoices i on i.id = b.invoice_id
where
  (
    i.status <> 'draft'
    and (
      i.student_id = auth.uid()
      or exists (
        select 1 from classroom.guardian_students g
        where g.student_id = i.student_id and g.guardian_id = auth.uid()
      )
    )
  )
  or (
    i.application_id is not null
    and exists (
      select 1
      from classroom.applications a
      join classroom.applicant_accounts ac on ac.id = a.applicant_id
      where a.id = i.application_id and ac.user_id = auth.uid()
    )
  );

grant select on classroom.my_invoice_balances to authenticated;

notify pgrst, 'reload schema';
