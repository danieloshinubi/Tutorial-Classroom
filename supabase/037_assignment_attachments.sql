-- =============================================================================
-- Assignments carry an attachment
--
-- A brief without the brief is half a brief. Materials have had file columns
-- since day one; assignments never did, and teachers were writing
-- "download the paper from the materials tab" instead. This gives an
-- assignment the same shape as a material: an uploaded file, or an outside
-- link, or nothing at all.
-- =============================================================================

alter table classroom.assignments
  add column if not exists file_path text,
  add column if not exists file_name text,
  add column if not exists file_size bigint,
  add column if not exists mime_type text,
  add column if not exists link_url text;

notify pgrst, 'reload schema';
