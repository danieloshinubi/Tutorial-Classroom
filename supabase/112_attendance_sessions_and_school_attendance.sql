-- =============================================================================
-- Two distinct kinds of attendance, per the product owner's own words:
--
--   "Class attendance" — a teacher documents it. Redesigned here from one
--   mark per class per DAY to one mark per class SESSION (a specific date
--   and time), so a class taught by different teachers at different periods
--   in the same day gets a separate mark each time, not one shared slot.
--   Two states only now — present/absent — not the earlier four.
--
--   "School attendance" — proves a person (student OR staff) actually
--   walked onto the premises that day, fed by a biometric/card reader (or a
--   manual entry until one is wired up). Entirely new; not scoped to
--   students, since staff resumption is being monitored the same way.
--
-- Run after 111_attendance.sql. attendance_records has no real data yet in
-- production (confirmed before writing this), so this ALTERs it in place
-- rather than migrating rows.
-- =============================================================================

/* ---------------------------------------------------------------------------
   Class attendance: date -> session_at, four statuses -> two
   --------------------------------------------------------------------------- */
alter table classroom.attendance_records
  add column if not exists session_at timestamptz;

update classroom.attendance_records
  set session_at = date::timestamptz
  where session_at is null;

alter table classroom.attendance_records
  alter column session_at set not null;

alter table classroom.attendance_records drop column if exists date;

alter table classroom.attendance_records drop constraint if exists attendance_records_class_id_student_id_date_key;
alter table classroom.attendance_records drop constraint if exists attendance_records_class_id_student_id_session_at_key;
alter table classroom.attendance_records
  add constraint attendance_records_class_id_student_id_session_at_key
  unique (class_id, student_id, session_at);

alter table classroom.attendance_records drop constraint if exists attendance_records_status_check;
alter table classroom.attendance_records
  add constraint attendance_records_status_check check (status in ('present', 'absent'));

drop index if exists classroom.attendance_records_class_date_idx;
drop index if exists classroom.attendance_records_student_date_idx;
drop index if exists classroom.attendance_records_school_date_idx;
create index if not exists attendance_records_class_session_idx
  on classroom.attendance_records (class_id, session_at);
create index if not exists attendance_records_student_session_idx
  on classroom.attendance_records (student_id, session_at);
create index if not exists attendance_records_school_session_idx
  on classroom.attendance_records (school_id, session_at);

-- A pupil reading their own marks was left out the first time round (staff
-- and their guardian only) — showing them nothing on their own report page
-- reads as broken rather than intentional, and there is nothing sensitive
-- about a student seeing their own attendance.
drop policy if exists "a student reads their own class attendance" on classroom.attendance_records;
create policy "a student reads their own class attendance"
  on classroom.attendance_records for select to authenticated
  using (student_id = auth.uid());

/* ---------------------------------------------------------------------------
   School attendance — the biometric/card feed, students and staff alike
   --------------------------------------------------------------------------- */
create table if not exists classroom.school_attendance_records (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references classroom.schools (id) on delete cascade,
  person_id   uuid not null references classroom.profiles (id) on delete cascade,
  resumed_at  timestamptz not null,
  source      text not null default 'manual' check (source in ('biometric', 'card', 'manual')),
  -- Who logged it, for a manual entry (a front-desk sign-in); null for
  -- anything a device reported on its own.
  recorded_by uuid references classroom.profiles (id) on delete set null,
  note        text,
  created_at  timestamptz not null default now()
);

create index if not exists school_attendance_person_idx
  on classroom.school_attendance_records (person_id, resumed_at);
create index if not exists school_attendance_school_idx
  on classroom.school_attendance_records (school_id, resumed_at);

alter table classroom.school_attendance_records enable row level security;

drop policy if exists "leadership manage school attendance" on classroom.school_attendance_records;
create policy "leadership manage school attendance"
  on classroom.school_attendance_records for all to authenticated
  using (classroom.has_role_in(school_id, array['owner', 'admin', 'principal']::classroom.member_role[]))
  with check (
    classroom.has_role_in(school_id, array['owner', 'admin', 'principal']::classroom.member_role[])
    and classroom.is_member_of(school_id)
  );

drop policy if exists "read your own school attendance" on classroom.school_attendance_records;
create policy "read your own school attendance"
  on classroom.school_attendance_records for select to authenticated
  using (person_id = auth.uid());

drop policy if exists "a guardian reads their child's school attendance" on classroom.school_attendance_records;
create policy "a guardian reads their child's school attendance"
  on classroom.school_attendance_records for select to authenticated
  using (classroom.is_guardian_of(person_id));

/* ---------------------------------------------------------------------------
   Attendance devices — how a biometric/card reader authenticates itself.
   One shared secret per device, hashed the same way a password would be;
   the raw key is only ever seen once, right after it's generated.
   --------------------------------------------------------------------------- */
create table if not exists classroom.attendance_devices (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null references classroom.schools (id) on delete cascade,
  label        text not null default 'Biometric device',
  key_hash     text not null,
  is_active    boolean not null default true,
  created_by   uuid references classroom.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);

alter table classroom.attendance_devices enable row level security;

drop policy if exists "leadership manage attendance devices" on classroom.attendance_devices;
create policy "leadership manage attendance devices"
  on classroom.attendance_devices for all to authenticated
  using (classroom.has_role_in(school_id, array['owner', 'admin', 'principal']::classroom.member_role[]))
  with check (classroom.has_role_in(school_id, array['owner', 'admin', 'principal']::classroom.member_role[]));

-- Generates and stores a new device key, returning the raw value exactly
-- once — the row itself only ever keeps the bcrypt hash, the same
-- "shown once, gone after" treatment PeoplePanel already gives a freshly
-- issued account password.
create or replace function classroom.create_attendance_device(target_school uuid, device_label text default 'Biometric device')
returns table (id uuid, api_key text)
language plpgsql
security definer
set search_path = classroom, public
as $fn$
declare
  raw_key text;
  new_id uuid;
begin
  if not classroom.has_role_in(target_school, array['owner', 'admin', 'principal']::classroom.member_role[]) then
    raise exception 'Only school leadership may connect an attendance device.';
  end if;

  raw_key := encode(extensions.gen_random_bytes(24), 'hex');

  insert into classroom.attendance_devices (school_id, label, key_hash, created_by)
  values (
    target_school,
    coalesce(nullif(btrim(device_label), ''), 'Biometric device'),
    extensions.crypt(raw_key, extensions.gen_salt('bf')),
    auth.uid()
  )
  returning classroom.attendance_devices.id into new_id;

  return query select new_id, raw_key;
end;
$fn$;

grant execute on function classroom.create_attendance_device(uuid, text) to authenticated;

-- What an actual reader/bridge script calls, once per scan. No user session
-- exists on a physical device, so this authenticates with the device's own
-- key instead of auth.uid() — the same shape as any webhook in this schema
-- that has to accept a call from outside a signed-in session.
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

  update classroom.attendance_devices set last_used_at = now() where id = device_row.id;

  return query
    select
      new_id,
      coalesce(nullif(btrim(person_row.first_name || ' ' || person_row.surname), ''), person_row.username, person_row.email),
      coalesce(event_time, now());
end;
$fn$;

grant execute on function classroom.record_school_attendance(text, text, timestamptz, text) to anon, authenticated;
