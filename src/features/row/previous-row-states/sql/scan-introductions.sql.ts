import { sql } from 'src/engine-prisma-types';

/**
 * Introductions by membership scan: every candidate Row version joined to the
 * lineage Revisions that carry it, keeping the earliest sequence. O(versions
 * * memberships) — the escape hatch for rows edited so often that bisection's
 * O(versions^2 * log revisions) probe count would dominate.
 *
 * Duplicate-Table and vanish/reappear corruption is not observable here
 * without a full per-revision lineage scan, so those flags stay false;
 * duplicate Row states still surface as two versions introduced by one
 * Revision.
 */
export const SCAN_INTRODUCTIONS_SQL = sql`,
introductions AS MATERIALIZED (
  SELECT
    version."versionId" AS row_version_id,
    min(lineage_revision."sequence") AS introduced_seq
  FROM params p
  JOIN "Row" version ON version."createdId" = p.row_created_id
  JOIN "_RowToTable" row_link ON row_link."A" = version."versionId"
  JOIN "Table" table_version
    ON table_version."versionId" = row_link."B"
   AND table_version."createdId" = p.table_created_id
  JOIN "_RevisionToTable" revision_link ON revision_link."B" = row_link."B"
  JOIN "Revision" lineage_revision
    ON lineage_revision."id" = revision_link."A"
  JOIN lineage l
    ON lineage_revision."branchId" = l.branch_id
   AND lineage_revision."sequence" <= l.max_seq
  GROUP BY version."versionId"
),
introduction_flags AS MATERIALIZED (
  SELECT
    false AS duplicate_table,
    COALESCE((
      SELECT bool_or(collision.version_count > 1)
      FROM (
        SELECT count(*)::integer AS version_count
        FROM introductions
        GROUP BY introduced_seq
      ) collision
    ), false) AS duplicate_row,
    false AS row_reappears
)`;
