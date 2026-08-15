import { sql } from 'src/engine-prisma-types';

// Hydrate only the page selected by the preceding stages.
export const HYDRATION_SQL = sql`
SELECT
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
  page.introduced_seq AS "eventSequence",
  page.introduced_by AS "introducedBy",
  row."versionId" AS "rowVersionId",
  row."createdId" AS "rowCreatedId",
  row."id" AS "rowId",
  row."readonly" AS "rowReadonly",
  row."createdAt" AS "rowCreatedAt",
  row."updatedAt" AS "rowUpdatedAt",
  row."publishedAt" AS "rowPublishedAt",
  row."data" AS "rowData",
  row."meta" AS "rowMeta",
  row."hash" AS "rowHash",
  row."schemaHash" AS "rowSchemaHash",
  node_table."versionId" AS "nodeTableVersionId",
  node_table."createdId" AS "tableCreatedId",
  node_table."id" AS "nodeTableId",
  node_table."readonly" AS "tableReadonly",
  node_table."createdAt" AS "tableCreatedAt",
  node_table."updatedAt" AS "tableUpdatedAt",
  node_table."system" AS "tableSystem",
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
LEFT JOIN "Revision" revision ON revision."id" = page.revision_id
LEFT JOIN "Branch" branch ON branch."id" = revision."branchId"
LEFT JOIN LATERAL (
  SELECT
    table_version."versionId",
    table_version."createdId",
    table_version."id",
    table_version."readonly",
    table_version."createdAt",
    table_version."updatedAt",
    table_version."system"
  FROM "_RevisionToTable" revision_table
  JOIN "Table" table_version
    ON table_version."versionId" = revision_table."B"
  CROSS JOIN params
  WHERE revision_table."A" = page.revision_id
    AND table_version."createdId" = params.table_created_id
  ORDER BY table_version."versionId"
  LIMIT 1
) node_table ON true
ORDER BY page.introduced_seq DESC NULLS LAST
  `;
