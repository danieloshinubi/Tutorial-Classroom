-- Class timetables (Timetable module).
--
-- The principal sets the school's timetable for teachers to follow; owners
-- and admins can too. Everyone else reads it: a teacher their own week,
-- students their class, parents their children's.
--
--   timetable_settings  which days the school teaches (Mon-Fri by default)
--   timetable_periods   the bell schedule: Period 1 08:00-08:40, Break, ...
--   timetable_slots     one cell: a class, a term, a day, a period, and what
--                       happens in it, either one of the class's subjects
--                       (class_subjects, which carries the teacher) or a
--                       plain label such as Assembly or Games, plus a room
--
-- Clashes are refused by the database, not just the screen: a class cannot
-- have two things in one period, a teacher cannot be in two classes at once,
-- and a room cannot hold two classes at once (unique indexes below). Writes
-- go through set_timetable_slot, which says plainly who is already where.

create or replace function classroom.can_manage_timetable(target_school uuid)
returns boolean language sql stable security definer set search_path = classroom, public as $fn$
  select classroom.has_role_in(target_school, array['owner', 'admin', 'principal']::classroom.member_role[]);
$fn$;
grant execute on function classroom.can_manage_timetable(uuid) to authenticated;

create table if not exists classroom.timetable_settings (
  school_id uuid primary key references classroom.schools (id) on delete cascade,
  days smallint[] not null default array[1, 2, 3, 4, 5]::smallint[],
  updated_at timestamptz not null default now(),
  constraint timetable_days_valid check (days <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[] and cardinality(days) between 1 and 7)
);

create table if not exists classroom.timetable_periods (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references classroom.schools (id) on delete cascade,
  name text not null,
  starts_at time not null,
  ends_at time not null,
  is_break boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  constraint timetable_period_name check (btrim(name) <> '' and char_length(name) <= 40),
  constraint timetable_period_times check (ends_at > starts_at)
);
create index if not exists timetable_periods_school_idx on classroom.timetable_periods (school_id, starts_at);

create table if not exists classroom.timetable_slots (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references classroom.schools (id) on delete cascade,
  term_id uuid not null references classroom.terms (id) on delete cascade,
  class_id uuid not null references classroom.classes (id) on delete cascade,
  period_id uuid not null references classroom.timetable_periods (id) on delete cascade,
  day smallint not null check (day between 1 and 7),
  class_subject_id uuid references classroom.class_subjects (id) on delete cascade,
  -- Copied from the class subject so a clash can be refused by an index.
  teacher_id uuid references auth.users (id) on delete set null,
  label text,
  room text,
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  constraint timetable_slot_has_content check (class_subject_id is not null or nullif(btrim(label), '') is not null),
  constraint timetable_slot_label_length check (label is null or char_length(label) <= 60),
  constraint timetable_slot_room_length check (room is null or char_length(room) <= 40)
);

create unique index if not exists timetable_one_per_class_period
  on classroom.timetable_slots (term_id, class_id, day, period_id);
create unique index if not exists timetable_teacher_no_clash
  on classroom.timetable_slots (term_id, teacher_id, day, period_id) where teacher_id is not null;
create unique index if not exists timetable_room_no_clash
  on classroom.timetable_slots (term_id, lower(btrim(room)), day, period_id) where nullif(btrim(room), '') is not null;
create index if not exists timetable_slots_school_term_idx on classroom.timetable_slots (school_id, term_id);
create index if not exists timetable_slots_class_subject_idx on classroom.timetable_slots (class_subject_id);
create index if not exists timetable_slots_class_idx on classroom.timetable_slots (class_id);
create index if not exists timetable_slots_period_idx on classroom.timetable_slots (period_id);
create index if not exists timetable_slots_teacher_idx on classroom.timetable_slots (teacher_id);

-- A class subject's teacher changing moves with its timetable cells. If that
-- would put the new teacher in two places at once, the change is refused
-- with the clash named, rather than leaving a timetable that cannot happen.
create or replace function classroom.timetable_follow_teacher()
returns trigger language plpgsql security definer set search_path = classroom, public as $fn$
begin
  if new.teacher_id is distinct from old.teacher_id then
    update classroom.timetable_slots set teacher_id = new.teacher_id, updated_at = now()
     where class_subject_id = new.id;
  end if;
  return new;
exception when unique_violation then
  raise exception 'That teacher is already teaching another class at one of this subject''s timetabled periods. Change the timetable first.';
end;
$fn$;
drop trigger if exists timetable_follow_teacher on classroom.class_subjects;
create trigger timetable_follow_teacher after update of teacher_id on classroom.class_subjects
  for each row execute function classroom.timetable_follow_teacher();

-- Row-level security: everyone at the school reads; only the timetable's
-- managers write, and slots only through the functions below.
alter table classroom.timetable_settings enable row level security;
alter table classroom.timetable_periods enable row level security;
alter table classroom.timetable_slots enable row level security;

drop policy if exists "members read timetable settings" on classroom.timetable_settings;
create policy "members read timetable settings" on classroom.timetable_settings
  for select to authenticated using (classroom.is_member_of(school_id));
drop policy if exists "managers write timetable settings" on classroom.timetable_settings;
create policy "managers write timetable settings" on classroom.timetable_settings
  for all to authenticated using (classroom.can_manage_timetable(school_id)) with check (classroom.can_manage_timetable(school_id));

drop policy if exists "members read periods" on classroom.timetable_periods;
create policy "members read periods" on classroom.timetable_periods
  for select to authenticated using (classroom.is_member_of(school_id));
drop policy if exists "managers write periods" on classroom.timetable_periods;
create policy "managers write periods" on classroom.timetable_periods
  for all to authenticated using (classroom.can_manage_timetable(school_id)) with check (classroom.can_manage_timetable(school_id));

drop policy if exists "members read slots" on classroom.timetable_slots;
create policy "members read slots" on classroom.timetable_slots
  for select to authenticated using (classroom.is_member_of(school_id));

grant select on classroom.timetable_settings, classroom.timetable_periods, classroom.timetable_slots to authenticated;
grant insert, update, delete on classroom.timetable_settings, classroom.timetable_periods to authenticated;

-- Put something in one cell, replacing what was there. Exactly one of a class
-- subject or a label. Refuses a clash with a sentence naming it.
create or replace function classroom.set_timetable_slot(
  target_term uuid, target_class uuid, target_day smallint, target_period uuid,
  subject_in uuid, label_in text, room_in text)
returns classroom.timetable_slots
language plpgsql security definer set search_path = classroom, public as $fn$
declare
  cls classroom.classes;
  cs classroom.class_subjects;
  per classroom.timetable_periods;
  t classroom.terms;
  clash record;
  result classroom.timetable_slots;
  room_clean text := nullif(btrim(coalesce(room_in, '')), '');
  label_clean text := nullif(btrim(coalesce(label_in, '')), '');
  day_name text;
begin
  select * into cls from classroom.classes where id = target_class;
  if not found then raise exception 'No such class'; end if;
  if not classroom.can_manage_timetable(cls.school_id) then
    raise exception 'Only the principal, an owner or an admin can change the timetable';
  end if;
  select * into t from classroom.terms where id = target_term and school_id = cls.school_id;
  if not found then raise exception 'That term is not at this school'; end if;
  select * into per from classroom.timetable_periods where id = target_period and school_id = cls.school_id;
  if not found then raise exception 'That period is not at this school'; end if;
  if per.is_break then raise exception '% is a break; nothing is taught then', per.name; end if;
  if target_day is null or target_day < 1 or target_day > 7 then raise exception 'Choose a day'; end if;

  if subject_in is not null then
    select * into cs from classroom.class_subjects where id = subject_in and class_id = target_class;
    if not found then raise exception 'That subject is not taught to this class'; end if;
    label_clean := null;
  elsif label_clean is null then
    raise exception 'Choose a subject, or write what happens then (for example Assembly)';
  end if;

  day_name := (array['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'])[target_day];

  if cs.teacher_id is not null then
    select c.name as class_name, coalesce(nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.surname, '')), ''), p.email) as who
      into clash
      from classroom.timetable_slots s
      join classroom.classes c on c.id = s.class_id
      left join classroom.profiles p on p.id = s.teacher_id
     where s.term_id = target_term and s.day = target_day and s.period_id = target_period
       and s.teacher_id = cs.teacher_id and s.class_id <> target_class
     limit 1;
    if found then
      raise exception '% already teaches % on % in %', clash.who, clash.class_name, day_name, per.name;
    end if;
  end if;

  if room_clean is not null then
    select c.name as class_name into clash
      from classroom.timetable_slots s
      join classroom.classes c on c.id = s.class_id
     where s.term_id = target_term and s.day = target_day and s.period_id = target_period
       and lower(btrim(s.room)) = lower(room_clean) and s.class_id <> target_class
     limit 1;
    if found then
      raise exception '% is already being used by % on % in %', room_clean, clash.class_name, day_name, per.name;
    end if;
  end if;

  insert into classroom.timetable_slots
    (school_id, term_id, class_id, period_id, day, class_subject_id, teacher_id, label, room, created_by, updated_at)
  values
    (cls.school_id, target_term, target_class, target_period, target_day, subject_in, cs.teacher_id, label_clean, room_clean, auth.uid(), now())
  on conflict (term_id, class_id, day, period_id) do update
    set class_subject_id = excluded.class_subject_id, teacher_id = excluded.teacher_id,
        label = excluded.label, room = excluded.room, updated_at = now()
  returning * into result;
  return result;
exception when unique_violation then
  raise exception 'Someone else just changed this part of the timetable. Reload and try again.';
end;
$fn$;

create or replace function classroom.clear_timetable_slot(target_term uuid, target_class uuid, target_day smallint, target_period uuid)
returns void language plpgsql security definer set search_path = classroom, public as $fn$
declare cls classroom.classes;
begin
  select * into cls from classroom.classes where id = target_class;
  if not found or not classroom.can_manage_timetable(cls.school_id) then
    raise exception 'Only the principal, an owner or an admin can change the timetable';
  end if;
  delete from classroom.timetable_slots
   where term_id = target_term and class_id = target_class and day = target_day and period_id = target_period;
end;
$fn$;

-- Start a term from another term's timetable (usually the one before).
-- Copies into empty cells only, so anything already set for the new term
-- stays; returns how many cells were copied.
create or replace function classroom.copy_timetable(from_term uuid, to_term uuid)
returns integer language plpgsql security definer set search_path = classroom, public as $fn$
declare src classroom.terms; dst classroom.terms; n integer;
begin
  select * into src from classroom.terms where id = from_term;
  select * into dst from classroom.terms where id = to_term;
  if src.id is null or dst.id is null or src.school_id <> dst.school_id then raise exception 'Choose two terms of this school'; end if;
  if not classroom.can_manage_timetable(dst.school_id) then
    raise exception 'Only the principal, an owner or an admin can change the timetable';
  end if;
  insert into classroom.timetable_slots
    (school_id, term_id, class_id, period_id, day, class_subject_id, teacher_id, label, room, created_by)
  select s.school_id, to_term, s.class_id, s.period_id, s.day, s.class_subject_id, s.teacher_id, s.label, s.room, auth.uid()
    from classroom.timetable_slots s
   where s.term_id = from_term
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end;
$fn$;

revoke all on function classroom.set_timetable_slot(uuid, uuid, smallint, uuid, uuid, text, text) from public, anon;
revoke all on function classroom.clear_timetable_slot(uuid, uuid, smallint, uuid) from public, anon;
revoke all on function classroom.copy_timetable(uuid, uuid) from public, anon;
grant execute on function classroom.set_timetable_slot(uuid, uuid, smallint, uuid, uuid, text, text) to authenticated;
grant execute on function classroom.clear_timetable_slot(uuid, uuid, smallint, uuid) to authenticated;
grant execute on function classroom.copy_timetable(uuid, uuid) to authenticated;

-- Audited like the rest of the school's records.
drop trigger if exists audit_trg on classroom.timetable_slots;
create trigger audit_trg after insert or update or delete on classroom.timetable_slots
  for each row execute function classroom.write_audit_log();
drop trigger if exists audit_trg on classroom.timetable_periods;
create trigger audit_trg after insert or update or delete on classroom.timetable_periods
  for each row execute function classroom.write_audit_log();

notify pgrst, 'reload schema';
