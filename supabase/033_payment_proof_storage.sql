-- =============================================================================
-- Somewhere for a parent to put the receipt
--
-- A family declaring a bank transfer needs to attach the teller slip. The
-- bucket's policies currently understand two shapes of path — course material
-- at <course_id>/... and admissions documents at admissions/<school_id>/... —
-- and anything else falls through to the course branch, where try_uuid()
-- returns null and the upload is refused.
--
-- Payment proofs get their own prefix:
--
--   payments/<school_id>/<invoice_id>/<file>
--
-- Who may write there: whoever the invoice belongs to. Who may read it: that
-- family, and the bursary who has to look at it before approving. Nobody
-- else, and in particular not the rest of the school — a bank slip carries an
-- account number.
-- =============================================================================

create or replace function classroom.may_touch_payment_proof(path_invoice text)
returns boolean
language sql
stable
security definer
set search_path = classroom, public
as $fn$
  select exists (
    select 1 from classroom.invoices i
    where i.id = classroom.try_uuid(path_invoice)
      and (
        classroom.can_do_bursary(i.school_id)
        or i.student_id = auth.uid()
        or exists (
          select 1 from classroom.guardian_students g
          where g.student_id = i.student_id and g.guardian_id = auth.uid()
        )
      )
  );
$fn$;

grant execute on function classroom.may_touch_payment_proof(text) to authenticated;

drop policy if exists "read course files and admissions documents" on storage.objects;
create policy "read course files and admissions documents"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'course-materials'
    and case (storage.foldername(name))[1]
      when 'admissions' then
        classroom.can_do_admissions(classroom.try_uuid((storage.foldername(name))[2]))
      when 'payments' then
        classroom.may_touch_payment_proof((storage.foldername(name))[3])
      else
        classroom.is_enrolled_in(classroom.try_uuid((storage.foldername(name))[1]))
        or classroom.can_manage_course(classroom.try_uuid((storage.foldername(name))[1]))
    end
  );

create policy "families attach a payment receipt"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'course-materials'
    and (storage.foldername(name))[1] = 'payments'
    and classroom.may_touch_payment_proof((storage.foldername(name))[3])
  );

create policy "remove a payment receipt"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'course-materials'
    and (storage.foldername(name))[1] = 'payments'
    and classroom.may_touch_payment_proof((storage.foldername(name))[3])
  );

notify pgrst, 'reload schema';
