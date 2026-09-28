-- =============================================================================
-- AI assistant: per-tenant usage metering.
--
-- The assistant is bundled — every school gets it, nobody is billed separately.
-- That is exactly why this table exists: when no one is charged per call, a
-- single school's traffic is invisible until the Anthropic invoice arrives, and
-- there is no way to say which tenant caused it. One row per model call, keyed
-- by school, makes the per-school cost knowable from day one and lets the edge
-- function refuse a school that has run away with the month's budget.
--
-- user_id is nullable on purpose: the first thing built on this is the public
-- admissions assistant on /Apply, where the visitor has no account at all. Those
-- calls still belong to a school and still cost money, so they are still logged.
--
-- Writes go through record_ai_usage() called with the service-role client, not a
-- direct insert — the same shape as record_admission_message(), which is how
-- every edge function in this project records what it did. Nothing client-side
-- may write here, so a browser cannot forge or erase its own usage.
-- =============================================================================

create table if not exists classroom.ai_usage (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid not null references classroom.schools (id) on delete cascade,
  -- null for public (pre-login) traffic; set once a signed-in user is the caller
  user_id       uuid references auth.users (id) on delete set null,
  -- which assistant made the call, so one surface running hot is identifiable
  surface       text not null default 'admissions'
                check (surface in ('admissions', 'assistant', 'helpdesk', 'reporting')),
  model         text not null,
  input_tokens  integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  -- populated when a call failed, so refusals and errors are visible next to
  -- the successes rather than silently missing from the record
  error         text,
  created_at    timestamptz not null default now()
);

-- The ceiling check reads "this school, this month" on every single call, so
-- that lookup is the one that has to be cheap.
create index if not exists ai_usage_school_created_idx
  on classroom.ai_usage (school_id, created_at desc);

alter table classroom.ai_usage enable row level security;

-- Readable by whoever runs the school, for the same reason they can read the
-- audit log. No insert/update/delete policy at all: the only writer is the
-- security definer function below, invoked by the edge function.
drop policy if exists "leadership read ai usage" on classroom.ai_usage;
create policy "leadership read ai usage"
  on classroom.ai_usage for select to authenticated
  using (classroom.has_role_in(school_id, array['owner', 'admin']::classroom.member_role[]));

grant select on classroom.ai_usage to authenticated;

-- =============================================================================
-- Recording a call. Mirrors record_admission_message: _in-suffixed arguments,
-- security definer, called from the edge function with the service-role client
-- after the model call returns (or fails).
-- =============================================================================

create or replace function classroom.record_ai_usage(
  target_school uuid,
  surface_in text,
  model_in text,
  input_tokens_in integer default 0,
  output_tokens_in integer default 0,
  user_in uuid default null,
  error_in text default null
)
returns void
language plpgsql
security definer
set search_path = classroom, public
as $fn$
begin
  insert into classroom.ai_usage
    (school_id, user_id, surface, model, input_tokens, output_tokens, error)
  values
    (target_school, user_in, coalesce(nullif(btrim(surface_in), ''), 'admissions'),
     model_in, coalesce(input_tokens_in, 0), coalesce(output_tokens_in, 0),
     nullif(btrim(error_in), ''));
end;
$fn$;

grant execute on function classroom.record_ai_usage(uuid, text, text, integer, integer, uuid, text) to authenticated;

-- =============================================================================
-- The ceiling. Returns this month's token total for a school so the edge
-- function can refuse before spending anything.
--
-- Deliberately a function rather than a query in the edge function: the window
-- ("this calendar month") and the definition of what counts toward the cap are
-- policy, and policy belongs next to the data — not duplicated in every surface
-- that later needs to ask the same question.
-- =============================================================================

create or replace function classroom.ai_tokens_this_month(target_school uuid)
returns bigint
language sql
stable
security definer
set search_path = classroom, public
as $fn$
  select coalesce(sum(input_tokens + output_tokens), 0)::bigint
  from classroom.ai_usage
  where school_id = target_school
    and created_at >= date_trunc('month', now());
$fn$;

grant execute on function classroom.ai_tokens_this_month(uuid) to authenticated;

notify pgrst, 'reload schema';
