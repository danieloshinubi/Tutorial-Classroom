-- =============================================================================
-- The missing link between a physical reader and a Schoolivio person.
--
-- record_school_attendance resolves person_identifier against profiles.id (a
-- uuid) or profiles.email. A biometric reader knows neither: it knows its own
-- enrolment number — "user 37" — and that is all it can send. So the endpoint
-- was only callable by a bridge that already knew everyone's email, and there
-- was nowhere to record the enrolment numbers it would need to translate. This
-- table is that mapping, which makes the reader's own IDs usable directly.
--
-- Scope: a mapping normally belongs to the whole school, because a school runs
-- one enrolment database across its readers — enrol once, recognised at every
-- door. device_id is therefore nullable and usually null. It exists for the
-- case of a school running two INDEPENDENT systems (say a fingerprint reader
-- at the gate and a separate card system for staff) whose numbering overlaps:
-- without it, "37" would be ambiguous and could silently log the wrong person,
-- which is a worse failure than refusing the scan. A row naming a device wins
-- over a school-wide row for that device; everything else falls back.
--
-- external_id is text, not an integer: vendors variously issue zero-padded
-- numbers ("0037"), card hex, and alphanumeric staff codes, and "0037" must
-- not silently collide with "37".
-- =============================================================================

create table if not exists classroom.attendance_enrolments (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references classroom.schools (id) on delete cascade,
  -- null = applies to every reader in the school (the normal case)
  device_id   uuid references classroom.attendance_devices (id) on delete cascade,
  person_id   uuid not null references classroom.profiles (id) on delete cascade,
  external_id text not null check (btrim(external_id) <> ''),
  note        text,
  created_by  uuid references classroom.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

-- Two partial indexes rather than one composite unique: a plain
-- unique (school_id, device_id, external_id) would treat every null device_id
-- as distinct, so the same school-wide id could be inserted any number of
-- times and the lookup below would pick one arbitrarily.
create unique index if not exists attendance_enrolments_school_ext_idx
  on classroom.attendance_enrolments (school_id, external_id)
  where device_id is null;

create unique index if not exists attendance_enrolments_device_ext_idx
  on classroom.attendance_enrolments (school_id, device_id, external_id)
  where device_id is not null;

create index if not exists attendance_enrolments_person_idx
  on classroom.attendance_enrolments (person_id);

alter table classroom.attendance_enrolments enable row level security;

-- Same leadership gate as the devices themselves: issuing a key and saying
-- which human a reader's ID belongs to are the same act of trust.
drop policy if exists "leadership manage attendance enrolments" on classroom.attendance_enrolments;
create policy "leadership manage attendance enrolments"
  on classroom.attendance_enrolments for all to authenticated
  using (classroom.has_role_in(school_id, array['owner', 'admin', 'principal']::classroom.member_role[]))
  with check (classroom.has_role_in(school_id, array['owner', 'admin', 'principal']::classroom.member_role[]));

grant select, insert, update, delete on classroom.attendance_enrolments to authenticated;

-- =============================================================================
-- record_school_attendance: accept an enrolment id as a third form of
-- identifier. uuid and email are tried first and unchanged, so any bridge
-- already sending an email keeps working exactly as before — an enrolment
-- number cannot collide with either of those shapes.
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
  matched_person uuid;
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

  -- Enrolment mapping first: it is the only identifier a reader can actually
  -- send on its own. A row naming this specific device beats a school-wide
  -- one, hence the ordering rather than a plain limit 1.
  select e.person_id into matched_person
  from classroom.attendance_enrolments e
  where e.school_id = device_row.school_id
    and btrim(e.external_id) = btrim(person_identifier)
    and (e.device_id is null or e.device_id = device_row.id)
  order by e.device_id nulls last
  limit 1;

  select p.* into person_row
  from classroom.profiles p
  join classroom.school_members sm on sm.user_id = p.id
  where sm.school_id = device_row.school_id
    and sm.is_active
    and (
      (matched_person is not null and p.id = matched_person)
      or (matched_person is null and (
        p.id::text = person_identifier
        or lower(p.email) = lower(btrim(person_identifier))
      ))
    )
  limit 1;

  if person_row.id is null then
    raise exception 'No active member of this school matches that identifier.';
  end if;

  safe_source := case when event_source in ('biometric', 'card', 'manual') then event_source else 'biometric' end;

  insert into classroom.school_attendance_records (school_id, person_id, resumed_at, source)
  values (device_row.school_id, person_row.id, coalesce(event_time, now()), safe_source)
  returning classroom.school_attendance_records.id into new_id;

  -- Column stays fully qualified: this function's own `returns table (id ...)`
  -- declares a variable named `id` that otherwise shadows the column here and
  -- fails every call with "column reference id is ambiguous". That is what
  -- 113_fix_record_school_attendance_ambiguous_id.sql was for; do not
  -- un-qualify it when editing this function again.
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

notify pgrst, 'reload schema';
