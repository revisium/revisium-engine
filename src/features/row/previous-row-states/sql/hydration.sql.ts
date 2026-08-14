import { sql } from 'src/engine-prisma-types';

// Hydrate only the page selected by the preceding stages.
export const HYDRATION_SQL = sql`
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
