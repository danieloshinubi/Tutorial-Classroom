-- Editing a fee structure after it is made (Bursary → Fee structures → Edit).
--
-- A structure could be created and deleted, never changed, so moving a due
-- date meant deleting it and building it again. This changes its name and
-- due date. A new due date also moves the due date of this structure's
-- DRAFT bills, which nobody has been sent yet; bills already issued keep
-- the date their family was given.
--
-- Who it applies to and which term stay fixed: bills may already have been
-- raised against them. Charges on it are edited line by line (fee_items).
create or replace function classroom.update_fee_structure(target_structure uuid, name_in text, due_on_in date)
returns classroom.fee_structures
language plpgsql
security definer
set search_path = classroom, public
as $fn$
declare
  st classroom.fee_structures;
begin
  select * into st from classroom.fee_structures where id = target_structure for update;
  if not found then raise exception 'No such fee structure'; end if;
  if not classroom.can_do_bursary(st.school_id) then
    raise exception 'Only the bursary can change a fee structure';
  end if;
  if btrim(coalesce(name_in, '')) = '' then raise exception 'Give the structure a name'; end if;

  update classroom.fee_structures
     set name = btrim(name_in), due_on = due_on_in, updated_at = now()
   where id = st.id
  returning * into st;

  update classroom.invoices
     set due_on = due_on_in, updated_at = now()
   where structure_id = st.id and status = 'draft';

  return st;
end;
$fn$;

grant execute on function classroom.update_fee_structure(uuid, text, date) to authenticated;

notify pgrst, 'reload schema';
