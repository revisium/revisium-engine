import { sql, type Sql } from 'src/engine-prisma-types';
import type { PreviousRowStatesSqlParams } from './previous-row-states-sql.types';

// Resolve the selected stable identities and walk the exact parent ancestry.
export function selectorAndLineageSql({
  revisionId,
  tableId,
  rowId,
  first,
  afterDepth,
  afterRevisionId,
}: PreviousRowStatesSqlParams): Sql {
  return sql`
WITH RECURSIVE
params AS MATERIALIZED (
  SELECT
    ${revisionId}::text AS tip_revision_id,
    ${tableId}::text AS table_id,
    ${rowId}::text AS row_id,
    ${first}::integer AS first_count,
    ${afterDepth}::integer AS after_depth,
    ${afterRevisionId}::text AS after_revision_id
),
selected_raw AS MATERIALIZED (
  SELECT
    b."projectId" AS project_id,
    t."createdId" AS table_created_id,
    r."createdId" AS row_created_id
  FROM params p
  JOIN "Revision" selected_revision
    ON selected_revision."id" = p.tip_revision_id
   AND selected_revision."isDraft" = false
  JOIN "Branch" b ON b."id" = selected_revision."branchId"
  JOIN "_RevisionToTable" selected_revision_table
    ON selected_revision_table."A" = selected_revision."id"
  JOIN "Table" t
    ON t."versionId" = selected_revision_table."B"
   AND t."id" = p.table_id
  JOIN "_RowToTable" selected_row_table
    ON selected_row_table."B" = t."versionId"
  JOIN "Row" r
    ON r."versionId" = selected_row_table."A"
   AND r."id" = p.row_id
),
selected AS MATERIALIZED (
  SELECT
    count(*)::integer AS selector_count,
    min(project_id) AS project_id,
    min(table_created_id) AS table_created_id,
    min(row_created_id) AS row_created_id
  FROM selected_raw
),
lineage AS MATERIALIZED (
  SELECT
    revision."id" AS revision_id,
    revision."parentId" AS parent_id,
    revision."branchId" AS branch_id,
    revision."isDraft" AS is_draft,
    revision."isStart" AS is_start,
    revision."sequence" AS sequence,
    0::integer AS depth
  FROM params p
  JOIN "Revision" revision ON revision."id" = p.tip_revision_id

  UNION ALL

  SELECT
    parent."id",
    parent."parentId",
    parent."branchId",
    parent."isDraft",
    parent."isStart",
    parent."sequence",
    child.depth + 1
  FROM lineage child
  JOIN LATERAL (
    SELECT
      candidate."id",
      candidate."parentId",
      candidate."branchId",
      candidate."isDraft",
      candidate."isStart",
      candidate."sequence"
    FROM "Revision" candidate
    WHERE candidate."id" = child.parent_id
    OFFSET 0
  ) parent ON true
  WHERE parent."sequence" < child.sequence
)`;
}
