-- =============================================================================
-- Deleting a screening_requirements row (School admin → Admissions settings
-- → Delete) never touched the per-application application_screening_items
-- already stamped from it. The FK is ON DELETE SET NULL, and kind/label/
-- is_required are copied onto the item at "Prepare items from config" time
-- rather than looked up live — so a deleted requirement leaves every
-- application that already had it prepared with a permanently orphaned
-- item: still "required", still "pending", with a config nobody manages
-- anymore and no way for staff to understand why it's stuck. Confirmed
-- live on a real application (Jane-Nath College, JNC/2028/0005) — "Application
-- Fee" was removed from the school's screening steps, but kept showing up
-- there, required and pending, and would have blocked screening_state from
-- ever reaching "passed".
--
-- Fix: a BEFORE DELETE trigger on screening_requirements removes any
-- application_screening_items still sitting at 'pending' for that
-- requirement — nobody has acted on them, so there's nothing worth
-- keeping. An item staff already decided (passed/failed/waived/
-- correction_required) is deliberately left alone; the FK's existing
-- ON DELETE SET NULL still clears its requirement_id, same as before, so
-- a real decision already made survives as a historical record even
-- after the requirement definition itself is gone.
--
-- BEFORE (not AFTER) matters here: by the time an AFTER DELETE trigger on
-- the parent runs, ordering against the FK's own internal SET NULL action
-- is not guaranteed, and the child rows might already have requirement_id
-- nulled out, making them unfindable by OLD.id. In BEFORE, the parent row
-- (and OLD.id) is still fully valid and no FK action has fired yet.
-- =============================================================================

create or replace function classroom.cleanup_pending_screening_items_on_requirement_delete()
returns trigger
language plpgsql
security definer
set search_path = classroom, public
as $fn$
begin
  delete from classroom.application_screening_items
  where requirement_id = old.id
    and status = 'pending';
  return old;
end;
$fn$;

drop trigger if exists cleanup_pending_screening_items_trg on classroom.screening_requirements;
create trigger cleanup_pending_screening_items_trg
  before delete on classroom.screening_requirements
  for each row execute function classroom.cleanup_pending_screening_items_on_requirement_delete();

-- One-time repair for the orphans this gap already produced: any item
-- already stuck exactly like JNC/2028/0005's, still pending with no
-- requirement behind it, and no way for a school to ever legitimately
-- resolve it now that the definition is gone.
delete from classroom.application_screening_items
where requirement_id is null
  and status = 'pending';
