import { sql } from 'src/engine-prisma-types';

// Resolve stable Table/Row identities with planner-preserving M:N probes.
export const IDENTITY_SQL = sql`,
table_identity_versions AS MATERIALIZED (
  SELECT
    table_version."versionId" AS table_version_id,
    table_version."id" AS table_id
  FROM selected s
  JOIN LATERAL (
    SELECT candidate."versionId", candidate."id"
    FROM "Table" candidate
    WHERE candidate."createdId" = s.table_created_id
    OFFSET 0
  ) table_version ON true
),
table_identity_memberships AS MATERIALIZED (
  SELECT membership."A" AS revision_id, table_version.*
  FROM table_identity_versions table_version
  JOIN LATERAL (
    SELECT candidate."A"
    FROM "_RevisionToTable" candidate
    WHERE candidate."B" = table_version.table_version_id
    OFFSET 0
  ) membership ON true
),
table_candidates AS MATERIALIZED (
  SELECT membership.*
  FROM table_identity_memberships membership
  JOIN lineage ON lineage.revision_id = membership.revision_id
),
row_identity_versions AS MATERIALIZED (
  SELECT
    row_version."versionId" AS row_version_id,
    row_version."id" AS row_id,
    row_version."data" AS row_data
  FROM selected s
  JOIN LATERAL (
    SELECT candidate."versionId", candidate."id", candidate."data"
    FROM "Row" candidate
    WHERE candidate."createdId" = s.row_created_id
    OFFSET 0
  ) row_version ON true
),
row_identity_memberships AS MATERIALIZED (
  SELECT membership."B" AS table_version_id, row_version.*
  FROM row_identity_versions row_version
  JOIN LATERAL (
    SELECT candidate."B"
    FROM "_RowToTable" candidate
    WHERE candidate."A" = row_version.row_version_id
    OFFSET 0
  ) membership ON true
),
row_candidates AS MATERIALIZED (
  SELECT
    table_candidate.revision_id,
    table_candidate.table_version_id,
    table_candidate.table_id,
    row_membership.row_version_id,
    row_membership.row_id,
    row_membership.row_data
  FROM row_identity_memberships row_membership
  JOIN table_candidates table_candidate
    ON table_candidate.table_version_id = row_membership.table_version_id
)`;
