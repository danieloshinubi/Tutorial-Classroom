-- =============================================================================
-- A principal is not an administrator
--
-- Results need three distinct actors: the teacher who enters marks, the
-- principal who approves them, and whoever releases them to parents. Without
-- its own role the approval step collapses into "admin", and the separation
-- the workflow exists to enforce is only a convention.
--
-- This is on its own because ALTER TYPE ... ADD VALUE cannot be used in the
-- same transaction that adds it, and the runner wraps each file in one.
-- =============================================================================

alter type classroom.member_role add value if not exists 'principal';
