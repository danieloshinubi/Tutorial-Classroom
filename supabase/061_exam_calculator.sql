-- =============================================================================
-- Per-exam scientific calculator
--
-- A tutor decides whether a calculator is appropriate for a given paper
-- (yes for maths/physics, no for most language exams) — same pattern as
-- every other "Exam conditions" toggle already on this table.
-- =============================================================================

alter table classroom.exams
  add column if not exists allow_calculator boolean not null default false;

notify pgrst, 'reload schema';
