import { sql, type JsonValue, type Sql } from 'src/engine-prisma-types';
import type { RowStateIntroductionType } from 'src/features/row/queries/impl/get-previous-row-states.query';

/**
 * Canonical VE-006 SQL source.
 *
 * This query deliberately is not duplicated under prisma/sql. Prisma's
 * generated TypedSQL factory imports src/__generated__/client at runtime,
 * while the published engine excludes that client and supports a
 * consumer-provided PrismaClient. Keeping the schema-independent Sql factory
 * as the sole source avoids hand-maintained SQL drift.
 */

export interface PreviousRowStateSqlResult {
  selectorCount: number;
  projectId: string | null;
  tableCreatedId: string | null;
  rowCreatedId: string | null;
  hasCycle: boolean;
  hasGap: boolean;
  hasDraft: boolean;
  crossesProject: boolean;
  duplicateTable: boolean;
  duplicateRow: boolean;
  rowReappears: boolean;
  cursorValid: boolean;
  totalCount: bigint | number;
  hasNextPage: boolean;
  eventRevisionId: string | null;
  eventDepth: number | null;
  introducedBy: RowStateIntroductionType[] | null;
  rowVersionId: string | null;
  rowId: string | null;
  rowReadonly: boolean | null;
  rowCreatedAt: Date | null;
  rowUpdatedAt: Date | null;
  rowPublishedAt: Date | null;
  rowData: JsonValue | null;
  rowMeta: JsonValue | null;
  rowHash: string | null;
  rowSchemaHash: string | null;
  nodeTableVersionId: string | null;
  nodeTableId: string | null;
  tableReadonly: boolean | null;
  tableCreatedAt: Date | null;
  tableUpdatedAt: Date | null;
  tableSystem: boolean | null;
  revisionSequence: number | null;
  revisionCreatedAt: Date | null;
  revisionComment: string | null;
  revisionIsHead: boolean | null;
  revisionIsDraft: boolean | null;
  revisionIsStart: boolean | null;
  revisionHasChanges: boolean | null;
  revisionBranchId: string | null;
  revisionParentId: string | null;
  branchId: string | null;
  branchCreatedAt: Date | null;
  branchIsRoot: boolean | null;
  branchName: string | null;
  branchProjectId: string | null;
}

export type PreviousRowStatesSqlParams = {
  readonly revisionId: string;
  readonly tableId: string;
  readonly rowId: string;
  readonly first: number;
  readonly afterDepth: number | null;
  readonly afterRevisionId: string | null;
};

export function getPreviousRowStatesSql(
  params: PreviousRowStatesSqlParams,
): Sql {
  return sql`${selectorAndLineageSql(params)}${IDENTITY_SQL}${INTEGRITY_AND_EVENTS_SQL}${PAGINATION_SQL}${HYDRATION_SQL}`;
}

function selectorAndLineageSql({
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

const IDENTITY_SQL = sql`,
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

const INTEGRITY_AND_EVENTS_SQL = sql`,
states AS MATERIALIZED (
  SELECT
    lineage.revision_id,
    lineage.parent_id,
    lineage.branch_id,
    branch."projectId" AS project_id,
    lineage.is_draft,
    lineage.is_start,
    lineage.sequence,
    lineage.depth,
    count(DISTINCT table_candidate.table_version_id)::integer AS table_count,
    count(row_candidate.row_version_id)::integer AS row_count,
    max(table_candidate.table_version_id) AS table_version_id,
    max(table_candidate.table_id) AS table_id,
    max(row_candidate.row_version_id) AS row_version_id,
    max(row_candidate.row_id) AS row_id,
    max(row_candidate.row_data::text)::jsonb AS row_data
  FROM lineage
  LEFT JOIN "Branch" branch ON branch."id" = lineage.branch_id
  LEFT JOIN table_candidates table_candidate
    ON table_candidate.revision_id = lineage.revision_id
  LEFT JOIN row_candidates row_candidate
    ON row_candidate.revision_id = lineage.revision_id
   AND row_candidate.table_version_id = table_candidate.table_version_id
  GROUP BY
    lineage.revision_id,
    lineage.parent_id,
    lineage.branch_id,
    branch."projectId",
    lineage.is_draft,
    lineage.is_start,
    lineage.sequence,
    lineage.depth
),
integrity AS MATERIALIZED (
  SELECT
    selected.selector_count,
    COALESCE((
      SELECT deepest.parent_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM "Revision" invalid_parent
          WHERE invalid_parent."id" = deepest.parent_id
            AND invalid_parent."sequence" >= deepest.sequence
        )
      FROM states deepest
      ORDER BY deepest.depth DESC
      LIMIT 1
    ), false) AS has_cycle,
    COALESCE((
      SELECT
        (
          deepest.parent_id IS NULL
          AND (
            deepest.is_start = false
            OR EXISTS (
              -- Engine-created fork starts are causally later than their
              -- source Revision. The original project start has no older
              -- Revision in that Project, independently of Branch.isRoot.
              SELECT 1
              FROM "Revision" older_revision
              JOIN "Branch" older_branch
                ON older_branch."id" = older_revision."branchId"
              WHERE older_branch."projectId" = selected.project_id
                AND older_revision."sequence" < deepest.sequence
            )
          )
        )
        OR (
          deepest.parent_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM "Revision" missing_parent
            WHERE missing_parent."id" = deepest.parent_id
          )
        )
      FROM states deepest
      ORDER BY deepest.depth DESC
      LIMIT 1
    ), false) AS has_gap,
    COALESCE((
      SELECT bool_or(state.is_draft) FROM states state
    ), false) AS has_draft,
    COALESCE((
      SELECT bool_or(state.project_id IS DISTINCT FROM selected.project_id)
      FROM states state
    ), false) AS crosses_project,
    COALESCE((
      SELECT bool_or(state.table_count > 1) FROM states state
    ), false) AS duplicate_table,
    COALESCE((
      SELECT bool_or(state.row_count > 1) FROM states state
    ), false) AS duplicate_row,
    COALESCE((
      SELECT EXISTS (
        SELECT 1
        FROM states older_state
        WHERE older_state.row_count > 0
          AND older_state.depth > (
            SELECT min(absent_state.depth)
            FROM states absent_state
            WHERE absent_state.row_count = 0
          )
      )
    ), false) AS row_reappears
  FROM selected
),
compared AS MATERIALIZED (
  SELECT
    state.*,
    state.row_count > 0 AS present,
    COALESCE(
      lead(state.row_count > 0) OVER (ORDER BY state.depth),
      false
    ) AS parent_present,
    lead(state.row_id) OVER (ORDER BY state.depth) AS parent_row_id,
    lead(state.row_data) OVER (ORDER BY state.depth) AS parent_row_data
  FROM states state
),
semantic_events AS MATERIALIZED (
  SELECT
    compared.*,
    CASE
      WHEN NOT compared.parent_present THEN ARRAY['created']::text[]
      ELSE array_remove(ARRAY[
        CASE
          WHEN compared.row_id IS DISTINCT FROM compared.parent_row_id
          THEN 'renamed'
        END,
        CASE
          WHEN compared.row_data IS DISTINCT FROM compared.parent_row_data
          THEN 'modified'
        END
      ], NULL)
    END AS introduced_by,
    row_number() OVER (ORDER BY compared.depth) AS event_number
  FROM compared
  WHERE compared.present
    AND (
      NOT compared.parent_present
      OR compared.row_id IS DISTINCT FROM compared.parent_row_id
      OR compared.row_data IS DISTINCT FROM compared.parent_row_data
    )
),
previous_events AS MATERIALIZED (
  SELECT * FROM semantic_events WHERE event_number > 1
)`;

const PAGINATION_SQL = sql`,
cursor_check AS MATERIALIZED (
  SELECT
    params.after_depth IS NULL
    OR EXISTS (
      SELECT 1
      FROM previous_events event
      WHERE event.depth = params.after_depth
        AND event.revision_id = params.after_revision_id
    ) AS cursor_valid
  FROM params
),
page_plus_one AS MATERIALIZED (
  SELECT event.*
  FROM previous_events event
  CROSS JOIN params
  CROSS JOIN cursor_check
  WHERE cursor_check.cursor_valid
    AND (params.after_depth IS NULL OR event.depth > params.after_depth)
  ORDER BY event.depth
  LIMIT (SELECT first_count + 1 FROM params)
),
page AS MATERIALIZED (
  SELECT event.*
  FROM page_plus_one event
  ORDER BY event.depth
  LIMIT (SELECT first_count FROM params)
),
metadata AS MATERIALIZED (
  SELECT
    selected.selector_count,
    selected.project_id,
    selected.table_created_id,
    selected.row_created_id,
    integrity.has_cycle,
    integrity.has_gap,
    integrity.has_draft,
    integrity.crosses_project,
    integrity.duplicate_table,
    integrity.duplicate_row,
    integrity.row_reappears,
    cursor_check.cursor_valid,
    (SELECT count(*) FROM previous_events) AS total_count,
    (SELECT count(*) > params.first_count FROM page_plus_one) AS has_next_page
  FROM selected
  CROSS JOIN integrity
  CROSS JOIN cursor_check
  CROSS JOIN params
)`;

const HYDRATION_SQL = sql`
SELECT
  metadata.selector_count AS "selectorCount",
  metadata.project_id AS "projectId",
  metadata.table_created_id AS "tableCreatedId",
  metadata.row_created_id AS "rowCreatedId",
  metadata.has_cycle AS "hasCycle",
  metadata.has_gap AS "hasGap",
  metadata.has_draft AS "hasDraft",
  metadata.crosses_project AS "crossesProject",
  metadata.duplicate_table AS "duplicateTable",
  metadata.duplicate_row AS "duplicateRow",
  metadata.row_reappears AS "rowReappears",
  metadata.cursor_valid AS "cursorValid",
  metadata.total_count AS "totalCount",
  metadata.has_next_page AS "hasNextPage",
  page.revision_id AS "eventRevisionId",
  page.depth AS "eventDepth",
  page.introduced_by AS "introducedBy",
  row."versionId" AS "rowVersionId",
  row."id" AS "rowId",
  row."readonly" AS "rowReadonly",
  row."createdAt" AS "rowCreatedAt",
  row."updatedAt" AS "rowUpdatedAt",
  row."publishedAt" AS "rowPublishedAt",
  row."data" AS "rowData",
  row."meta" AS "rowMeta",
  row."hash" AS "rowHash",
  row."schemaHash" AS "rowSchemaHash",
  table_version."versionId" AS "nodeTableVersionId",
  table_version."id" AS "nodeTableId",
  table_version."readonly" AS "tableReadonly",
  table_version."createdAt" AS "tableCreatedAt",
  table_version."updatedAt" AS "tableUpdatedAt",
  table_version."system" AS "tableSystem",
  revision."sequence" AS "revisionSequence",
  revision."createdAt" AS "revisionCreatedAt",
  revision."comment" AS "revisionComment",
  revision."isHead" AS "revisionIsHead",
  revision."isDraft" AS "revisionIsDraft",
  revision."isStart" AS "revisionIsStart",
  revision."hasChanges" AS "revisionHasChanges",
  revision."branchId" AS "revisionBranchId",
  revision."parentId" AS "revisionParentId",
  branch."id" AS "branchId",
  branch."createdAt" AS "branchCreatedAt",
  branch."isRoot" AS "branchIsRoot",
  branch."name" AS "branchName",
  branch."projectId" AS "branchProjectId"
FROM metadata
LEFT JOIN page ON true
LEFT JOIN "Row" row ON row."versionId" = page.row_version_id
LEFT JOIN "Table" table_version
  ON table_version."versionId" = page.table_version_id
LEFT JOIN "Revision" revision ON revision."id" = page.revision_id
LEFT JOIN "Branch" branch ON branch."id" = page.branch_id
ORDER BY page.depth NULLS LAST
  `;
