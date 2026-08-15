import { sql, type Sql } from 'src/engine-prisma-types';
import type { HistorySelectorSqlParams } from './previous-row-states-sql.types';

/**
 * Above this many Row versions the bisection walk's O(versions^2 * log
 * revisions) point probes overtake the membership scan's O(versions *
 * memberships) reads, so the introduction stage switches strategy.
 */
export const BISECT_MAX_ROW_VERSIONS = 100;

/**
 * Resolve the selected snapshot before the history walk: the tip Revision
 * (existence, Draft state, lineage anchor), the stable identities of the
 * exactly-one (Table, Row) pair in it, and the Row version count that picks
 * the walk algorithm (bisection vs membership scan). One statement replaces
 * a separate Revision lookup plus resolution query on the hot path.
 */
export function getHistorySelectorSql({
  revisionId,
  tableId,
  rowId,
}: HistorySelectorSqlParams): Sql {
  return sql`
WITH selected_revision AS (
  SELECT
    revision."id",
    revision."isDraft",
    revision."branchId",
    revision."sequence",
    branch."projectId"
  FROM "Revision" revision
  JOIN "Branch" branch ON branch."id" = revision."branchId"
  WHERE revision."id" = ${revisionId}::text
),
resolved AS (
  SELECT
    selected_table."createdId" AS table_created_id,
    selected_row."createdId" AS row_created_id
  FROM selected_revision
  JOIN "_RevisionToTable" selected_revision_table
    ON selected_revision_table."A" = selected_revision."id"
  JOIN "Table" selected_table
    ON selected_table."versionId" = selected_revision_table."B"
   AND selected_table."id" = ${tableId}::text
  JOIN "_RowToTable" selected_row_table
    ON selected_row_table."B" = selected_table."versionId"
  JOIN "Row" selected_row
    ON selected_row."versionId" = selected_row_table."A"
   AND selected_row."id" = ${rowId}::text
)
SELECT
  selected_revision."isDraft" AS "tipIsDraft",
  selected_revision."branchId" AS "tipBranchId",
  selected_revision."sequence" AS "tipSequence",
  selected_revision."projectId" AS "projectId",
  (SELECT count(*)::integer FROM resolved) AS "selectorCount",
  (SELECT min(table_created_id) FROM resolved) AS "tableCreatedId",
  (SELECT min(row_created_id) FROM resolved) AS "rowCreatedId",
  -- Deliberately unscoped by lineage: bisection probes every candidate
  -- version per point lookup, so the global count is the cost that picks
  -- the walk strategy. Counting stops just past the threshold — the exact
  -- size of an over-threshold identity is irrelevant.
  (
    SELECT count(*)::integer
    FROM (
      SELECT 1
      FROM "Row" candidate
      WHERE candidate."createdId" = (SELECT min(row_created_id) FROM resolved)
      LIMIT ${BISECT_MAX_ROW_VERSIONS + 1}::integer
    ) bounded_versions
  ) AS "rowVersionCount"
FROM selected_revision
  `;
}
