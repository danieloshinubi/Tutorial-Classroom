-- =============================================================================
-- Security audit fixes (156)
--
-- Finding: classroom.admission_config, classroom.admission_programmes and
-- classroom.document_requirements are all readable by `anon` with no check
-- that the owning school is actually active. Every other public,
-- unauthenticated surface in this codebase DOES check s.is_active before
-- handing back a school's data:
--   - classroom.public_school()            (110_school_theme_color.sql)
--   - classroom.public_school_levels()     (109_public_school_levels.sql)
--   - classroom.public_admission_sessions()(074_public_admission_sessions.sql)
--   - the admissions document-upload storage policy
--     (051_admissions_public_document_uploads.sql)
--
-- These three policies were the one gap: once a school is suspended or
-- offboarded (is_active = false — see 143_platform_offboarding.sql), its
-- application-fee amount, acceptance-fee amount, programme list and document
-- requirements remained fully queryable by anyone, forever, with no session
-- at all. Closing this brings these three policies in line with the pattern
-- already used everywhere else for public admissions data, and does not
-- change behaviour for any currently-active school's real applicants.
--
-- Run after 040. Safe to re-run.
-- =============================================================================

drop policy if exists "read admission config" on classroom.admission_config;
create policy "read admission config"
  on classroom.admission_config for select to authenticated, anon
  using (
    exists (
      select 1 from classroom.schools s
      where s.id = admission_config.school_id and s.is_active
    )
  );

drop policy if exists "read programmes" on classroom.admission_programmes;
create policy "read programmes"
  on classroom.admission_programmes for select to authenticated, anon
  using (
    is_active
    and exists (
      select 1 from classroom.schools s
      where s.id = admission_programmes.school_id and s.is_active
    )
  );

drop policy if exists "read requirements" on classroom.document_requirements;
create policy "read requirements"
  on classroom.document_requirements for select to authenticated, anon
  using (
    exists (
      select 1 from classroom.schools s
      where s.id = document_requirements.school_id and s.is_active
    )
  );

notify pgrst, 'reload schema';
