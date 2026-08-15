-- Indexes behind the previous-row-states history read.
--
-- This migration replaces 20260814180000_add_previous_row_state_identity_indexes
-- (only ever published in v0.8.0-alpha.0). A database that already ran the
-- replaced migration must drop its journal row first — `migrate deploy`
-- refuses to run while an applied migration is missing from this directory,
-- and `migrate resolve --applied` would skip the new Revision indexes:
--   DELETE FROM "_prisma_migrations"
--    WHERE migration_name = '20260814180000_add_previous_row_state_identity_indexes';
--   prisma migrate deploy
-- The DDL below is idempotent, so re-running over the alpha indexes is safe.
--
-- Stable logical identities are intentionally non-unique: copy-on-write
-- versions of one Table or Row share the same createdId. These back the
-- selector and the candidate-version lookup.
CREATE INDEX IF NOT EXISTS "Table_createdId_idx" ON "Table"("createdId");
CREATE INDEX IF NOT EXISTS "Row_createdId_idx" ON "Row"("createdId");

-- Ancestry is read as (branch, sequence interval) pairs instead of walking
-- one Revision per recursion step. Composite indexes back the three
-- per-branch probes that walk uses:
--   (branchId, sequence) — floor lookup "latest branch revision with
--     sequence <= S" and interval membership; replaces the plain branchId
--     index, which it covers as a prefix.
--   (branchId, isStart)  — one probe per fork hop to find the branch start.
--   (branchId, isDraft)  — draft-in-ancestry integrity without scanning the
--     whole branch (at most one Draft exists per branch).
CREATE INDEX IF NOT EXISTS "Revision_branchId_sequence_idx" ON "Revision"("branchId", "sequence");
CREATE INDEX IF NOT EXISTS "Revision_branchId_isStart_idx" ON "Revision"("branchId", "isStart");
CREATE INDEX IF NOT EXISTS "Revision_branchId_isDraft_idx" ON "Revision"("branchId", "isDraft");
DROP INDEX IF EXISTS "Revision_branchId_idx";
