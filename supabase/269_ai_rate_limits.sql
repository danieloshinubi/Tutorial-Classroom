-- Limits on how fast the AI assistant can be used (2026-10-15).
--
-- The public admissions chat needs no account, so anyone could call it in a
-- loop and run up the AI bill (and use up the school's monthly allowance for
-- its own staff). Signed-in use had the same gap per person. Each request now
-- counts against a per-visitor (or per-person) hourly limit and a per-school
-- daily one; the Edge Function asks before calling the model.

create table if not exists classroom.ai_requests (
  id         bigint generated always as identity primary key,
  school_id  uuid,
  who        text not null,
  at         timestamptz not null default now()
);
create index if not exists ai_requests_who_idx on classroom.ai_requests (who, at desc);
create index if not exists ai_requests_school_idx on classroom.ai_requests (school_id, at desc);
alter table classroom.ai_requests enable row level security;
revoke all on classroom.ai_requests from public, anon, authenticated;

-- True (and counted) when this request is within the limits.
create or replace function classroom.ai_rate_ok(target_school uuid, who_in text, per_hour int, per_school_day int)
returns boolean language plpgsql security definer set search_path = classroom, public as $fn$
declare n int;
begin
  -- Serialise per caller so a burst of parallel requests can't all slip in.
  perform pg_advisory_xact_lock(hashtext('ai_rate:' || who_in));
  delete from classroom.ai_requests where at < now() - interval '2 days';
  select count(*) into n from classroom.ai_requests where who = who_in and at > now() - interval '1 hour';
  if n >= per_hour then return false; end if;
  if per_school_day is not null and target_school is not null then
    select count(*) into n from classroom.ai_requests where school_id = target_school and at > now() - interval '1 day';
    if n >= per_school_day then return false; end if;
  end if;
  insert into classroom.ai_requests (school_id, who) values (target_school, who_in);
  return true;
end;
$fn$;
revoke execute on function classroom.ai_rate_ok(uuid, text, int, int) from public, anon, authenticated;
grant execute on function classroom.ai_rate_ok(uuid, text, int, int) to service_role;
