-- More fixes from the security and reliability review (2026-10-15).
--
-- 1. Links people type (a submission, a material, an assignment's link) may
--    only be web addresses: a "javascript:" one would run as whoever clicks.
-- 2. An applicant's not-yet-sent uploads were visible (and removable) by
--    anyone. Now: a signed-in applicant sees only their own; an upload made
--    without an account stays reachable only for two hours, the window an
--    applicant needs to remove one before submitting.
-- 3. Phone/browser notifications are only sent to the real push services,
--    never to any address someone registers (the server would call it).
-- 4. Four empty tables left over from an unrelated app were open to anyone;
--    nobody but the service role reaches them now.
-- 5. Results: every change of a sheet's state locks the sheet, so two people
--    approving or releasing at once can't both act (duplicate notices to
--    families, an approve and a send-back both "winning"). Opening a sheet
--    is one at a time per subject and term. A mark is checked against the
--    sheet's split while the split is locked. A course sheet, like a class
--    one, adds pupils who joined after it was opened, and checks its term.
-- 6. A released result keeps the grade it was released with: changing the
--    grading scale later no longer rewrites report cards already issued.
-- 7. A grading scale's lowest marks have at most two decimals (the column's
--    precision), so 49.999 is refused rather than silently becoming 50.

/* ------------------------------------------------------------- 1. links */

alter table classroom.submissions drop constraint if exists submissions_url_is_web;
alter table classroom.submissions add constraint submissions_url_is_web
  check (url is null or btrim(url) = '' or url ~* '^https?://') not valid;
alter table classroom.assignments drop constraint if exists assignments_link_is_web;
alter table classroom.assignments add constraint assignments_link_is_web
  check (link_url is null or btrim(link_url) = '' or link_url ~* '^https?://') not valid;
alter table classroom.materials drop constraint if exists materials_url_is_web;
alter table classroom.materials add constraint materials_url_is_web
  check (url is null or btrim(url) = '' or url ~* '^https?://') not valid;

/* ------------------------------------------------ 2. unsent applicant files */

drop policy if exists "an applicant can see their own unsent attachment" on storage.objects;
create policy "an applicant can see their own unsent attachment" on storage.objects for select to anon, authenticated
  using (bucket_id = 'course-materials'
         and (storage.foldername(name))[1] = 'admissions'
         and classroom.storage_path_unclaimed(name)
         and (owner_id = (select auth.uid())::text
              or (owner_id is null and created_at > now() - interval '2 hours')));

drop policy if exists "an applicant withdraws their own unsent attachment" on storage.objects;
create policy "an applicant withdraws their own unsent attachment" on storage.objects for delete to anon, authenticated
  using (bucket_id = 'course-materials'
         and (storage.foldername(name))[1] = 'admissions'
         and classroom.storage_path_unclaimed(name)
         and (owner_id = (select auth.uid())::text
              or (owner_id is null and created_at > now() - interval '2 hours')));

/* --------------------------------------------------- 3. push endpoints */

do $do$
declare d text;
begin
  d := replace(pg_get_functiondef('classroom.save_push_subscription(text,text,text,uuid,text)'::regprocedure), chr(13), '');
  d := replace(d, $a$    raise exception 'That device did not give a complete subscription';
  end if;$a$, $b$    raise exception 'That device did not give a complete subscription';
  end if;
  -- Only the browsers' own push services; the server posts to this address.
  if endpoint_in !~* '^https://([a-z0-9-]+\.)*(fcm\.googleapis\.com|push\.apple\.com|push\.services\.mozilla\.com|notify\.windows\.com|wns\.windows\.com)(/|$)' then
    raise exception 'That is not a browser notification address.';
  end if;$b$);
  -- Re-registering a device keeps it with whoever already has it, unless
  -- that is the caller: an endpoint can't be taken over by someone else.
  d := replace(d, $a$  on conflict (endpoint) do update
    set user_id = excluded.user_id,$a$, $b$  on conflict (endpoint) do update
    set user_id = classroom.push_subscriptions.user_id,$b$);
  d := replace(d, $a$        auth = excluded.auth, user_agent = excluded.user_agent, last_seen_at = now();$a$,
                  $b$        auth = excluded.auth, user_agent = excluded.user_agent, last_seen_at = now()
    where classroom.push_subscriptions.user_id = auth.uid();$b$);
  if position('not a browser notification address' in d) = 0 or position('where classroom.push_subscriptions.user_id = auth.uid()' in d) = 0 then
    raise exception 'save_push_subscription patch did not apply';
  end if;
  execute d;
end;
$do$;

/* ------------------------------------------------ 4. leftover tables */

do $do$
declare t text;
begin
  foreach t in array array['bookings', 'vessels', 'reviews', 'profiles'] loop
    if to_regclass('public.' || t) is not null then
      execute format('revoke all on public.%I from anon, authenticated', t);
    end if;
  end loop;
end;
$do$;

/* ------------------------------------------------------ 5. results */

do $do$
declare
  f text;
  d text;
begin
  foreach f in array array['approve_result_sheet(uuid,text)', 'release_result_sheet(uuid,text)', 'return_result_sheet(uuid,text)',
                           'submit_result_sheet(uuid,text)', 'unrelease_result_sheet(uuid,text)'] loop
    d := replace(pg_get_functiondef(('classroom.' || f)::regprocedure), chr(13), '');
    d := replace(d, 'select * into sheet from classroom.result_sheets where id = target_sheet;',
                    'select * into sheet from classroom.result_sheets where id = target_sheet for update;');
    if position('where id = target_sheet for update;' in d) = 0 then raise exception '% patch did not apply', f; end if;
    execute d;
  end loop;

  d := replace(pg_get_functiondef('classroom.result_entries_guard()'::regprocedure), chr(13), '');
  d := replace(d, 'select * into sheet from classroom.result_sheets where id = new.sheet_id;',
                  'select * into sheet from classroom.result_sheets where id = new.sheet_id for share;');
  if position('for share' in d) = 0 then raise exception 'result_entries_guard patch did not apply'; end if;
  execute d;

  d := replace(pg_get_functiondef('classroom.open_subject_result_sheet(uuid,uuid,integer,integer)'::regprocedure), chr(13), '');
  d := replace(d, $a$  select * into sheet from classroom.result_sheets where class_subject_id = target_class_subject and term_id = target_term;$a$,
                  $b$  -- One opener at a time for this subject and term.
  perform pg_advisory_xact_lock(hashtext('result_sheet:' || target_class_subject || ':' || target_term));
  select * into sheet from classroom.result_sheets where class_subject_id = target_class_subject and term_id = target_term;$b$);
  if position('pg_advisory_xact_lock' in d) = 0 then raise exception 'open_subject_result_sheet patch did not apply'; end if;
  execute d;

  d := replace(pg_get_functiondef('classroom.open_result_sheet(uuid,uuid,integer,integer)'::regprocedure), chr(13), '');
  d := replace(d, $a$  select * into sheet from classroom.result_sheets
  where course_id = target_course and term_id = target_term;
  if found then
    return sheet;
  end if;$a$, $b$  if not exists (select 1 from classroom.terms t where t.id = target_term and t.school_id = course.school_id) then
    raise exception 'No such term';
  end if;
  if ca_max < 0 or exam_max < 0 or ca_max + exam_max <= 0 or ca_max > 100 or exam_max > 100 then
    raise exception 'Choose how many marks the CA and the exam are out of';
  end if;

  -- One opener at a time for this course and term.
  perform pg_advisory_xact_lock(hashtext('result_sheet:' || target_course || ':' || target_term));
  select * into sheet from classroom.result_sheets
  where course_id = target_course and term_id = target_term;
  if found then
    -- Pupils who joined the course since the sheet was opened are added.
    if sheet.status in ('draft', 'returned') then
      insert into classroom.result_entries (sheet_id, student_id, updated_by)
      select sheet.id, e.user_id, auth.uid() from classroom.enrollments e
       where e.course_id = target_course and e.status = 'approved'
      on conflict (sheet_id, student_id) do nothing;
    end if;
    return sheet;
  end if;$b$);
  if position('pg_advisory_xact_lock' in d) = 0 then raise exception 'open_result_sheet patch did not apply'; end if;
  execute d;
end;
$do$;

/* ------------------------------------------------- 6. released grades */

alter table classroom.result_entries add column if not exists grade text;

-- The grade a result was released with, fixed at release.
create or replace function classroom.result_sheets_snapshot_grades()
returns trigger language plpgsql security definer set search_path = classroom, public as $fn$
begin
  if new.status = 'released' and old.status is distinct from 'released' then
    update classroom.result_entries e
       set grade = classroom.grade_for(new.school_id, round(e.total * 100.0 / nullif(new.ca_max + new.exam_max, 0)::numeric, 1))
     where e.sheet_id = new.id;
  elsif old.status = 'released' and new.status is distinct from 'released' then
    update classroom.result_entries set grade = null where sheet_id = new.id;
  end if;
  return null;
end;
$fn$;
drop trigger if exists result_sheets_snapshot_grades on classroom.result_sheets;
create trigger result_sheets_snapshot_grades after update of status on classroom.result_sheets
  for each row execute function classroom.result_sheets_snapshot_grades();

-- What is already out keeps the grade it shows today.
update classroom.result_entries e
   set grade = classroom.grade_for(s.school_id, round(e.total * 100.0 / nullif(s.ca_max + s.exam_max, 0)::numeric, 1))
  from classroom.result_sheets s
 where s.id = e.sheet_id and s.status = 'released' and e.grade is null;

do $do$
declare d text;
begin
  d := pg_get_viewdef('classroom.result_slips'::regclass, true);
  d := regexp_replace(d, '(classroom\.grade_for\(s\.school_id, round\([^\n]*?\)\)) AS grade', 'COALESCE(e.grade, \1) AS grade');
  if position('COALESCE(e.grade,' in d) = 0 then raise exception 'result_slips patch did not apply'; end if;
  execute 'create or replace view classroom.result_slips with (security_invoker = true) as ' || d;
end;
$do$;
grant select on classroom.result_slips to authenticated;

/* ------------------------------------------------- 7. band precision */

do $do$
declare d text;
begin
  d := replace(pg_get_functiondef('classroom.set_grade_bands(uuid,jsonb)'::regprocedure), chr(13), '');
  d := replace(d, '  delete from classroom.grade_bands where school_id = target_school;',
                  $b$  if exists (select 1 from jsonb_array_elements(bands) e
              where (e->>'min_pct')::numeric <> round((e->>'min_pct')::numeric, 2)) then
    raise exception 'Use at most two decimal places for a lowest mark.';
  end if;

  delete from classroom.grade_bands where school_id = target_school;$b$);
  if position('at most two decimal places' in d) = 0 then raise exception 'set_grade_bands patch did not apply'; end if;
  execute d;
end;
$do$;

notify pgrst, 'reload schema';
