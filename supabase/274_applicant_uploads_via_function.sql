-- Admission documents uploaded before an application exists (2026-10-15).
--
-- The public Apply form wrote straight into storage, so storage had to let
-- anyone (no account) read and delete "unsent" files there, and 268 could
-- only narrow that to two hours. Now the form sends files to the apply-upload
-- Edge Function, which stores them and hands the family a private token;
-- removing a file needs that token. Logged-out visitors get no direct access
-- to the admissions folder at all, and submitting an application only
-- attaches files that came through that route (never someone else's path).

create table if not exists classroom.applicant_uploads (
  path        text primary key,
  school_id   uuid not null references classroom.schools (id) on delete cascade,
  token_hash  text not null,
  created_at  timestamptz not null default now()
);
create index if not exists applicant_uploads_school_idx on classroom.applicant_uploads (school_id, created_at);
alter table classroom.applicant_uploads enable row level security;
revoke all on classroom.applicant_uploads from public, anon, authenticated;
grant all on classroom.applicant_uploads to service_role;

/* --------------------------------------------------------- storage rules */

-- Writing: no more anonymous uploads (the Edge Function uses the service
-- role). A signed-in applicant may still upload into their own
-- application's folder: admissions/<school>/<their application>/...
drop policy if exists "anyone applying attaches a document" on storage.objects;
drop policy if exists "an applicant uploads to their own application" on storage.objects;
create policy "an applicant uploads to their own application" on storage.objects for insert to authenticated
  with check (bucket_id = 'course-materials'
              and (storage.foldername(name))[1] = 'admissions'
              and classroom.is_active_school(classroom.try_uuid((storage.foldername(name))[2]))
              and classroom.is_applicant_for(classroom.try_uuid((storage.foldername(name))[3]))
              and coalesce((metadata ->> 'size')::bigint, 0) <= 15728640
              and coalesce(metadata ->> 'mimetype', '') = any (array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic']));

-- Reading and removing an unsent file: only its own signed-in uploader.
drop policy if exists "an applicant can see their own unsent attachment" on storage.objects;
create policy "an applicant can see their own unsent attachment" on storage.objects for select to authenticated
  using (bucket_id = 'course-materials'
         and (storage.foldername(name))[1] = 'admissions'
         and owner_id = (select auth.uid())::text
         and classroom.storage_path_unclaimed(name));

drop policy if exists "an applicant withdraws their own unsent attachment" on storage.objects;
create policy "an applicant withdraws their own unsent attachment" on storage.objects for delete to authenticated
  using (bucket_id = 'course-materials'
         and (storage.foldername(name))[1] = 'admissions'
         and owner_id = (select auth.uid())::text
         and classroom.storage_path_unclaimed(name));

/* ------------------------------------------- submitting an application */

do $do$
declare d text;
begin
  d := replace(pg_get_functiondef('classroom.submit_application(text,text,text,text,text,text,date,text,integer,text,text,text,text,text,text,jsonb)'::regprocedure), chr(13), '');
  -- Only files the apply-upload function stored for this school.
  d := replace(d, $a$    where d->>'path' like 'admissions/' || school.id::text || '/%';
    get diagnostics doc_count = row_count;$a$, $b$    where d->>'path' like 'admissions/' || school.id::text || '/%'
      and exists (select 1 from classroom.applicant_uploads u
                   where u.path = d->>'path' and u.school_id = school.id);
    get diagnostics doc_count = row_count;
    -- Claimed now: they belong to the application from here on.
    delete from classroom.applicant_uploads u
     where u.school_id = school.id
       and u.path in (select d->>'path' from jsonb_array_elements(document_uploads) as d);$b$);
  if position('classroom.applicant_uploads u' in d) = 0 then raise exception 'submit_application patch did not apply'; end if;
  execute d;
end;
$do$;

notify pgrst, 'reload schema';
