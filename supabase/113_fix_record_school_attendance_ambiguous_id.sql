-- =============================================================================
-- Fix: record_school_attendance() failed on every call
--
-- Found immediately by simulating a real device call: the function's own
-- `returns table (id uuid, ...)` declares a PL/pgSQL variable named `id`,
-- which then shadowed attendance_devices.id inside
-- "update ... where id = device_row.id", failing with
-- "column reference \"id\" is ambiguous" before a single row could ever be
-- recorded. Same fix as the RETURNING clauses in this function already
-- use elsewhere — qualify the column with its table name.
-- =============================================================================

create or replace function classroom.record_school_attendance(
  device_api_key text,
  person_identifier text,
  event_time timestamptz default now(),
  event_source text default 'biometric'
)
returns table (id uuid, person_name text, resumed_at timestamptz)
language plpgsql
security definer
set search_path = classroom, public
as $fn$
declare
  device_row classroom.attendance_devices;
  person_row classroom.profiles;
  new_id uuid;
  safe_source text;
begin
  select d.* into device_row
  from classroom.attendance_devices d
  where d.is_active
    and d.key_hash = extensions.crypt(device_api_key, d.key_hash)
  limit 1;

  if device_row.id is null then
    raise exception 'Invalid or inactive device key.';
  end if;

  select p.* into person_row
  from classroom.profiles p
  join classroom.school_members sm on sm.user_id = p.id
  where sm.school_id = device_row.school_id
    and sm.is_active
    and (p.id::text = person_identifier or lower(p.email) = lower(btrim(person_identifier)))
  limit 1;

  if person_row.id is null then
    raise exception 'No active member of this school matches that identifier.';
  end if;

  safe_source := case when event_source in ('biometric', 'card', 'manual') then event_source else 'biometric' end;

  insert into classroom.school_attendance_records (school_id, person_id, resumed_at, source)
  values (device_row.school_id, person_row.id, coalesce(event_time, now()), safe_source)
  returning classroom.school_attendance_records.id into new_id;

  update classroom.attendance_devices
    set last_used_at = now()
    where classroom.attendance_devices.id = device_row.id;

  return query
    select
      new_id,
      coalesce(nullif(btrim(person_row.first_name || ' ' || person_row.surname), ''), person_row.username, person_row.email),
      coalesce(event_time, now());
end;
$fn$;

grant execute on function classroom.record_school_attendance(text, text, timestamptz, text) to anon, authenticated;
