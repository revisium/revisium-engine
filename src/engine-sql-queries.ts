/**
 * Hand-written SQL query factories that replace the Prisma-generated
 * `$queryRawTyped` helpers.
 *
 * Each factory accepts the same parameters as the original generated
 * function but returns a plain `Sql` value suitable for `$queryRaw`.
 *
 * Result types are exported so call sites keep their typing.
 */
import { sql, Sql, InputJsonObject } from 'src/engine-prisma-types';
import type { JsonValue } from 'src/engine-prisma-types';

// ---------------------------------------------------------------------------
// getTableDiffsPaginatedBetweenRevisions
// ---------------------------------------------------------------------------
export interface GetTableDiffsPaginatedResult {
  fromId: string;
  fromCreatedId: string;
  fromVersionId: string;
  toId: string;
  toCreatedId: string;
  toVersionId: string;
  changeType: string | null;
}

export function getTableDiffsPaginatedBetweenRevisionsSql(
  fromRevisionId: string,
  toRevisionId: string,
  changeTypes: InputJsonObject | null,
  limit: number,
  offset: number,
  includeSystem: boolean,
): Sql {
  return sql`
WITH parent_tables AS (SELECT "id", "createdId", "versionId"
FROM "Table"
WHERE ("Table"."versionId") IN (SELECT "t1"."B"
FROM "_RevisionToTable" AS "t1"
INNER JOIN "Revision" AS "j1" ON ("j1"."id") = ("t1"."A")
WHERE ("j1"."id" = ${fromRevisionId} AND "t1"."B" IS NOT NULL))
AND (${includeSystem}::boolean IS TRUE OR "Table"."system" = FALSE)),
child_tables AS (SELECT "id", "createdId", "versionId"
FROM "Table"
WHERE ("Table"."versionId") IN (SELECT "t1"."B"
FROM "_RevisionToTable" AS "t1"
INNER JOIN "Revision" AS "j1" ON ("j1"."id") = ("t1"."A")
WHERE ("j1"."id" = ${toRevisionId} AND "t1"."B" IS NOT NULL))
AND (${includeSystem}::boolean IS TRUE OR "Table"."system" = FALSE))
SELECT pt."id"        AS "fromId",
pt."createdId" AS "fromCreatedId",
pt."versionId" AS "fromVersionId",
ct."id"        AS "toId",
ct."createdId" AS "toCreatedId",
ct."versionId" AS "toVersionId",
CASE
WHEN pt."createdId" IS NULL THEN 'added'
WHEN ct."createdId" IS NULL THEN 'removed'
WHEN pt."id" != ct."id" AND ct."versionId" != pt."versionId" THEN 'renamed_and_modified'
WHEN pt."id" != ct."id" THEN 'renamed'
WHEN ct."versionId" != pt."versionId" THEN 'modified'
END        AS "changeType"
FROM child_tables ct
FULL OUTER JOIN parent_tables pt USING ("createdId")
WHERE (pt."createdId" IS NULL
OR ct."createdId" IS NULL
OR pt."id" != ct."id"
OR ct."versionId" != pt."versionId")
AND (${changeTypes}::jsonb IS NULL OR LOWER(CASE
WHEN pt."createdId" IS NULL THEN 'added'
WHEN ct."createdId" IS NULL THEN 'removed'
WHEN pt."id" != ct."id" AND ct."versionId" != pt."versionId" THEN 'renamed_and_modified'
WHEN pt."id" != ct."id" THEN 'renamed'
WHEN ct."versionId" != pt."versionId" THEN 'modified'
END) = ANY(ARRAY(SELECT LOWER(jsonb_array_elements_text(${changeTypes}::jsonb)))))

LIMIT ${limit}
OFFSET ${offset}
  `;
}

// ---------------------------------------------------------------------------
// hasTableDiffsBetweenRevisions
// ---------------------------------------------------------------------------
export interface HasTableDiffsResult {
  exists: boolean | null;
}

export function hasTableDiffsBetweenRevisionsSql(
  fromRevisionId: string,
  toRevisionId: string,
): Sql {
  return sql`
SELECT EXISTS (
WITH
parent_tables AS (SELECT "id", "createdId", "versionId"
FROM "Table"
WHERE ("Table"."versionId") IN (SELECT "t1"."B"
FROM "_RevisionToTable" AS "t1"
INNER JOIN "Revision" AS "j1" ON ("j1"."id") = ("t1"."A")
WHERE ("j1"."id" = ${fromRevisionId} AND "t1"."B" IS NOT NULL))),
child_tables AS (SELECT "id", "createdId", "versionId"
FROM "Table"
WHERE ("Table"."versionId") IN (SELECT "t1"."B"
FROM "_RevisionToTable" AS "t1"
INNER JOIN "Revision" AS "j1" ON ("j1"."id") = ("t1"."A")
WHERE ("j1"."id" = ${toRevisionId} AND "t1"."B" IS NOT NULL)))
SELECT 1
FROM
child_tables ct
FULL OUTER JOIN parent_tables pt USING ("createdId")
WHERE
pt."createdId" IS NULL OR
ct."createdId" IS NULL OR
pt."id" != ct."id" OR
ct."versionId" != pt."versionId"

LIMIT 1)
  `;
}

// ---------------------------------------------------------------------------
// countTableDiffsBetweenRevisions
// ---------------------------------------------------------------------------
export interface CountTableDiffsResult {
  count: number | null;
}

export function countTableDiffsBetweenRevisionsSql(
  fromRevisionId: string,
  toRevisionId: string,
  changeTypes: InputJsonObject | null,
  includeSystem: boolean,
): Sql {
  return sql`
WITH parent_tables AS (SELECT "id", "createdId", "versionId"
FROM "Table"
WHERE ("Table"."versionId") IN (SELECT "t1"."B"
FROM "_RevisionToTable" AS "t1"
INNER JOIN "Revision" AS "j1" ON ("j1"."id") = ("t1"."A")
WHERE ("j1"."id" = ${fromRevisionId} AND "t1"."B" IS NOT NULL))
AND (${includeSystem}::boolean IS TRUE OR "Table"."system" = FALSE)),
child_tables AS (SELECT "id", "createdId", "versionId"
FROM "Table"
WHERE ("Table"."versionId") IN (SELECT "t1"."B"
FROM "_RevisionToTable" AS "t1"
INNER JOIN "Revision" AS "j1" ON ("j1"."id") = ("t1"."A")
WHERE ("j1"."id" = ${toRevisionId} AND "t1"."B" IS NOT NULL))
AND (${includeSystem}::boolean IS TRUE OR "Table"."system" = FALSE))
SELECT COUNT(*) ::integer AS count
FROM
child_tables ct
FULL OUTER JOIN parent_tables pt USING ("createdId")
WHERE
(pt."createdId" IS NULL
OR ct."createdId" IS NULL
OR pt."id" != ct."id"
OR ct."versionId" != pt."versionId")
AND (${changeTypes}::jsonb IS NULL OR LOWER(CASE
WHEN pt."createdId" IS NULL THEN 'added'
WHEN ct."createdId" IS NULL THEN 'removed'
WHEN pt."id" != ct."id" AND ct."versionId" != pt."versionId" THEN 'renamed_and_modified'
WHEN pt."id" != ct."id" THEN 'renamed'
WHEN ct."versionId" != pt."versionId" THEN 'modified'
END) = ANY(ARRAY(SELECT LOWER(jsonb_array_elements_text(${changeTypes}::jsonb)))))
  `;
}

// ---------------------------------------------------------------------------
// getTableDiffsStatsBetweenRevisions
// ---------------------------------------------------------------------------
export interface GetTableDiffsStatsResult {
  total: number | null;
  added: number | null;
  removed: number | null;
  renamed: number | null;
  modified: number | null;
}

export function getTableDiffsStatsBetweenRevisionsSql(
  fromRevisionId: string,
  toRevisionId: string,
  includeSystem: boolean,
): Sql {
  return sql`
WITH parent_tables AS (SELECT "id", "createdId", "versionId"
FROM "Table"
WHERE ("Table"."versionId") IN (SELECT "t1"."B"
FROM "_RevisionToTable" AS "t1"
INNER JOIN "Revision" AS "j1" ON ("j1"."id") = ("t1"."A")
WHERE ("j1"."id" = ${fromRevisionId} AND "t1"."B" IS NOT NULL))
AND (${includeSystem}::boolean IS TRUE OR "Table"."system" = FALSE)),
child_tables AS (SELECT "id", "createdId", "versionId"
FROM "Table"
WHERE ("Table"."versionId") IN (SELECT "t1"."B"
FROM "_RevisionToTable" AS "t1"
INNER JOIN "Revision" AS "j1" ON ("j1"."id") = ("t1"."A")
WHERE ("j1"."id" = ${toRevisionId} AND "t1"."B" IS NOT NULL))
AND (${includeSystem}::boolean IS TRUE OR "Table"."system" = FALSE))
SELECT
COUNT(*) ::integer AS total,
COUNT(*) FILTER (WHERE pt."createdId" IS NULL) ::integer AS added,
COUNT(*) FILTER (WHERE ct."createdId" IS NULL) ::integer AS removed,
COUNT(*) FILTER (
WHERE (pt."id" != ct."id" AND ct."versionId" = pt."versionId" AND pt."createdId" IS NOT NULL AND ct."createdId" IS NOT NULL)
OR (pt."id" != ct."id" AND ct."versionId" != pt."versionId" AND pt."createdId" IS NOT NULL AND ct."createdId" IS NOT NULL)
) ::integer AS renamed,
COUNT(*) FILTER (
WHERE (pt."id" = ct."id" AND ct."versionId" != pt."versionId")
OR (pt."id" != ct."id" AND ct."versionId" != pt."versionId" AND pt."createdId" IS NOT NULL AND ct."createdId" IS NOT NULL)
) ::integer AS modified
FROM
child_tables ct
FULL OUTER JOIN parent_tables pt USING ("createdId")
WHERE
pt."createdId" IS NULL
OR
ct."createdId" IS NULL
OR
pt."id" != ct."id"
OR
ct."versionId" != pt."versionId"
  `;
}

// ---------------------------------------------------------------------------
// hasRowDiffsBetweenRevisions
// ---------------------------------------------------------------------------
export interface HasRowDiffsResult {
  exists: boolean | null;
}

export function hasRowDiffsBetweenRevisionsSql(
  tableCreatedId: string,
  fromRevisionId: string,
  toRevisionId: string,
): Sql {
  return sql`
SELECT EXISTS (
WITH
parent_rows AS (SELECT "id", "createdId", "versionId"
FROM "Row"
WHERE ("Row"."versionId") IN (SELECT "t1"."A"
FROM "_RowToTable" AS "t1"
INNER JOIN "Table" AS "j1" ON ("j1"."versionId") = ("t1"."B")
WHERE ("j1"."createdId" = ${tableCreatedId} AND
("j1"."versionId") IN (SELECT "t2"."B"
FROM "_RevisionToTable" AS "t2"
INNER JOIN "Revision" AS "j2" ON ("j2"."id") = ("t2"."A")
WHERE ("j2"."id" = ${fromRevisionId} AND "t2"."B" IS NOT NULL)) AND
"t1"."A" IS NOT NULL))),

child_rows AS (SELECT "id", "createdId", "versionId"
FROM "Row"
WHERE ("Row"."versionId") IN (SELECT "t1"."A"
FROM "_RowToTable" AS "t1"
INNER JOIN "Table" AS "j1" ON ("j1"."versionId") = ("t1"."B")
WHERE ("j1"."createdId" = ${tableCreatedId} AND ("j1"."versionId") IN (SELECT "t2"."B"
FROM "_RevisionToTable" AS "t2"
INNER JOIN "Revision" AS "j2" ON ("j2"."id") = ("t2"."A")
WHERE ("j2"."id" = ${toRevisionId} AND "t2"."B" IS NOT NULL)) AND
"t1"."A" IS NOT NULL)))
SELECT 1
FROM
child_rows ct
FULL OUTER JOIN parent_rows pt USING ("createdId")
WHERE
pt."createdId" IS NULL OR
ct."createdId" IS NULL OR
ct."versionId" != pt."versionId"

LIMIT 1)
  `;
}

// ---------------------------------------------------------------------------
// getRowChangesPaginatedBetweenRevisions
// ---------------------------------------------------------------------------
export interface GetRowChangesPaginatedResult {
  fromRowId: string;
  fromRowCreatedId: string;
  fromRowVersionId: string;
  fromData: JsonValue;
  fromHash: string;
  fromSchemaHash: string;
  fromReadonly: boolean;
  fromMeta: JsonValue;
  fromRowCreatedAt: Date;
  fromRowUpdatedAt: Date;
  fromRowPublishedAt: Date;
  toRowId: string;
  toRowCreatedId: string;
  toRowVersionId: string;
  toData: JsonValue;
  toHash: string;
  toSchemaHash: string;
  toReadonly: boolean;
  toMeta: JsonValue;
  toRowCreatedAt: Date;
  toRowUpdatedAt: Date;
  toRowPublishedAt: Date;
  fromTableId: string;
  fromTableCreatedId: string;
  fromTableVersionId: string;
  fromTableReadonly: boolean;
  fromTableSystem: boolean;
  fromTableCreatedAt: Date;
  fromTableUpdatedAt: Date;
  toTableId: string;
  toTableCreatedId: string;
  toTableVersionId: string;
  toTableReadonly: boolean;
  toTableSystem: boolean;
  toTableCreatedAt: Date;
  toTableUpdatedAt: Date;
  rowCreatedId: string | null;
  tableCreatedId: string | null;
  changeType: string | null;
}

export interface GetRowChangesPaginatedOptions {
  fromRevisionId: string;
  toRevisionId: string;
  tableCreatedId: string | null;
  searchTerm: string | null;
  changeTypes: InputJsonObject | null;
  limit: number;
  offset: number;
  includeSystem: boolean;
}

export function getRowChangesPaginatedBetweenRevisionsSql(
  options: GetRowChangesPaginatedOptions,
): Sql {
  const {
    fromRevisionId,
    toRevisionId,
    tableCreatedId,
    searchTerm,
    changeTypes,
    limit,
    offset,
    includeSystem,
  } = options;
  return sql`
WITH parent_rows AS (
SELECT
r."id" AS "rowId",
r."createdId" AS "rowCreatedId",
r."versionId" AS "rowVersionId",
r."data",
r."hash",
r."schemaHash",
r."readonly",
r."meta",
r."createdAt" AS "rowCreatedAt",
r."updatedAt" AS "rowUpdatedAt",
r."publishedAt" AS "rowPublishedAt",
t."id" AS "tableId",
t."createdId" AS "tableCreatedId",
t."versionId" AS "tableVersionId",
t."readonly" AS "tableReadonly",
t."system" AS "tableSystem",
t."createdAt" AS "tableCreatedAt",
t."updatedAt" AS "tableUpdatedAt"
FROM "Row" r
INNER JOIN "_RowToTable" rt ON r."versionId" = rt."A"
INNER JOIN "Table" t ON t."versionId" = rt."B"
INNER JOIN "_RevisionToTable" revt ON t."versionId" = revt."B"
WHERE revt."A" = ${fromRevisionId}
AND (${tableCreatedId}::text IS NULL OR t."createdId" = ${tableCreatedId})
AND (${includeSystem}::boolean IS TRUE OR t."system" = FALSE)
),
child_rows AS (
SELECT
r."id" AS "rowId",
r."createdId" AS "rowCreatedId",
r."versionId" AS "rowVersionId",
r."data",
r."hash",
r."schemaHash",
r."readonly",
r."meta",
r."createdAt" AS "rowCreatedAt",
r."updatedAt" AS "rowUpdatedAt",
r."publishedAt" AS "rowPublishedAt",
t."id" AS "tableId",
t."createdId" AS "tableCreatedId",
t."versionId" AS "tableVersionId",
t."readonly" AS "tableReadonly",
t."system" AS "tableSystem",
t."createdAt" AS "tableCreatedAt",
t."updatedAt" AS "tableUpdatedAt"
FROM "Row" r
INNER JOIN "_RowToTable" rt ON r."versionId" = rt."A"
INNER JOIN "Table" t ON t."versionId" = rt."B"
INNER JOIN "_RevisionToTable" revt ON t."versionId" = revt."B"
WHERE revt."A" = ${toRevisionId}
AND (${tableCreatedId}::text IS NULL OR t."createdId" = ${tableCreatedId})
AND (${includeSystem}::boolean IS TRUE OR t."system" = FALSE)
),
all_changes AS (
SELECT
pr."rowId" AS "fromRowId",
pr."rowCreatedId" AS "fromRowCreatedId",
pr."rowVersionId" AS "fromRowVersionId",
pr."data" AS "fromData",
pr."hash" AS "fromHash",
pr."schemaHash" AS "fromSchemaHash",
pr."readonly" AS "fromReadonly",
pr."meta" AS "fromMeta",
pr."rowCreatedAt" AS "fromRowCreatedAt",
pr."rowUpdatedAt" AS "fromRowUpdatedAt",
pr."rowPublishedAt" AS "fromRowPublishedAt",

cr."rowId" AS "toRowId",
cr."rowCreatedId" AS "toRowCreatedId",
cr."rowVersionId" AS "toRowVersionId",
cr."data" AS "toData",
cr."hash" AS "toHash",
cr."schemaHash" AS "toSchemaHash",
cr."readonly" AS "toReadonly",
cr."meta" AS "toMeta",
cr."rowCreatedAt" AS "toRowCreatedAt",
cr."rowUpdatedAt" AS "toRowUpdatedAt",
cr."rowPublishedAt" AS "toRowPublishedAt",

pr."tableId" AS "fromTableId",
pr."tableCreatedId" AS "fromTableCreatedId",
pr."tableVersionId" AS "fromTableVersionId",
pr."tableReadonly" AS "fromTableReadonly",
pr."tableSystem" AS "fromTableSystem",
pr."tableCreatedAt" AS "fromTableCreatedAt",
pr."tableUpdatedAt" AS "fromTableUpdatedAt",

cr."tableId" AS "toTableId",
cr."tableCreatedId" AS "toTableCreatedId",
cr."tableVersionId" AS "toTableVersionId",
cr."tableReadonly" AS "toTableReadonly",
cr."tableSystem" AS "toTableSystem",
cr."tableCreatedAt" AS "toTableCreatedAt",
cr."tableUpdatedAt" AS "toTableUpdatedAt",

COALESCE(cr."rowCreatedId", pr."rowCreatedId") AS "rowCreatedId",
COALESCE(cr."tableCreatedId", pr."tableCreatedId") AS "tableCreatedId",

CASE
WHEN pr."rowCreatedId" IS NULL THEN 'ADDED'
WHEN cr."rowCreatedId" IS NULL THEN 'REMOVED'
WHEN pr."rowId" != cr."rowId" AND cr."hash" != pr."hash" THEN 'RENAMED_AND_MODIFIED'
WHEN pr."rowId" != cr."rowId" THEN 'RENAMED'
WHEN cr."hash" != pr."hash" THEN 'MODIFIED'
END AS "changeType"

FROM child_rows cr
FULL OUTER JOIN parent_rows pr ON cr."rowCreatedId" = pr."rowCreatedId"
WHERE
(pr."rowCreatedId" IS NULL OR
cr."rowCreatedId" IS NULL OR
pr."rowId" != cr."rowId" OR
cr."hash" != pr."hash")
)
SELECT * FROM all_changes
WHERE
(${searchTerm}::text IS NULL OR
"fromRowId" ILIKE '%' || ${searchTerm} || '%' OR
"toRowId" ILIKE '%' || ${searchTerm} || '%')
AND (${changeTypes}::jsonb IS NULL OR (
"changeType" = ANY(ARRAY(SELECT jsonb_array_elements_text(${changeTypes}::jsonb)))
OR ("changeType" = 'RENAMED_AND_MODIFIED' AND (
'RENAMED' = ANY(ARRAY(SELECT jsonb_array_elements_text(${changeTypes}::jsonb)))
OR 'MODIFIED' = ANY(ARRAY(SELECT jsonb_array_elements_text(${changeTypes}::jsonb)))
))
))
ORDER BY
COALESCE("toRowUpdatedAt", "fromRowUpdatedAt") DESC,
"rowCreatedId" ASC
LIMIT ${limit}
OFFSET ${offset}
  `;
}

// ---------------------------------------------------------------------------
// getRowChangesStatsBetweenRevisions
// ---------------------------------------------------------------------------
export interface GetRowChangesStatsResult {
  total: bigint | null;
  added: bigint | null;
  removed: bigint | null;
  renamed: bigint | null;
  modified: bigint | null;
}

export function getRowChangesStatsBetweenRevisionsSql(
  fromRevisionId: string,
  toRevisionId: string,
  tableCreatedId: string | null,
  includeSystem: boolean,
): Sql {
  return sql`
WITH parent_rows AS (
SELECT
r."id",
r."createdId",
r."hash",
r."schemaHash",
t."createdId" as "tableCreatedId"
FROM "Row" r
INNER JOIN "_RowToTable" rt ON r."versionId" = rt."A"
INNER JOIN "Table" t ON t."versionId" = rt."B"
INNER JOIN "_RevisionToTable" revt ON t."versionId" = revt."B"
WHERE revt."A" = ${fromRevisionId}
AND (${tableCreatedId}::text IS NULL OR t."createdId" = ${tableCreatedId})
AND (${includeSystem}::boolean IS TRUE OR t."system" = FALSE)
),
child_rows AS (
SELECT
r."id",
r."createdId",
r."hash",
r."schemaHash",
t."createdId" as "tableCreatedId"
FROM "Row" r
INNER JOIN "_RowToTable" rt ON r."versionId" = rt."A"
INNER JOIN "Table" t ON t."versionId" = rt."B"
INNER JOIN "_RevisionToTable" revt ON t."versionId" = revt."B"
WHERE revt."A" = ${toRevisionId}
AND (${tableCreatedId}::text IS NULL OR t."createdId" = ${tableCreatedId})
AND (${includeSystem}::boolean IS TRUE OR t."system" = FALSE)
)
SELECT
COUNT(*) AS "total",
COUNT(*) FILTER (WHERE pr."createdId" IS NULL) AS "added",
COUNT(*) FILTER (WHERE cr."createdId" IS NULL) AS "removed",
COUNT(*) FILTER (
WHERE (pr."id" != cr."id" AND cr."hash" = pr."hash" AND pr."createdId" IS NOT NULL AND cr."createdId" IS NOT NULL)
OR (pr."id" != cr."id" AND cr."hash" != pr."hash" AND pr."createdId" IS NOT NULL AND cr."createdId" IS NOT NULL)
) AS "renamed",
COUNT(*) FILTER (
WHERE (pr."id" = cr."id" AND cr."hash" != pr."hash")
OR (pr."id" != cr."id" AND cr."hash" != pr."hash" AND pr."createdId" IS NOT NULL AND cr."createdId" IS NOT NULL)
) AS "modified"
FROM child_rows cr
FULL OUTER JOIN parent_rows pr USING ("createdId")
WHERE
pr."createdId" IS NULL OR
cr."createdId" IS NULL OR
pr."id" != cr."id" OR
cr."hash" != pr."hash"
  `;
}

// ---------------------------------------------------------------------------
// countRowChangesBetweenRevisions
// ---------------------------------------------------------------------------
export interface CountRowChangesResult {
  count: bigint | null;
}

export function countRowChangesBetweenRevisionsSql(
  fromRevisionId: string,
  toRevisionId: string,
  tableCreatedId: string | null,
  searchTerm: string | null,
  changeTypes: InputJsonObject | null,
  includeSystem: boolean,
): Sql {
  return sql`
WITH parent_rows AS (
SELECT
r."id",
r."createdId",
r."hash",
r."schemaHash"
FROM "Row" r
INNER JOIN "_RowToTable" rt ON r."versionId" = rt."A"
INNER JOIN "Table" t ON t."versionId" = rt."B"
INNER JOIN "_RevisionToTable" revt ON t."versionId" = revt."B"
WHERE revt."A" = ${fromRevisionId}
AND (${tableCreatedId}::text IS NULL OR t."createdId" = ${tableCreatedId})
AND (${includeSystem}::boolean IS TRUE OR t."system" = FALSE)
),
child_rows AS (
SELECT
r."id",
r."createdId",
r."hash",
r."schemaHash"
FROM "Row" r
INNER JOIN "_RowToTable" rt ON r."versionId" = rt."A"
INNER JOIN "Table" t ON t."versionId" = rt."B"
INNER JOIN "_RevisionToTable" revt ON t."versionId" = revt."B"
WHERE revt."A" = ${toRevisionId}
AND (${tableCreatedId}::text IS NULL OR t."createdId" = ${tableCreatedId})
AND (${includeSystem}::boolean IS TRUE OR t."system" = FALSE)
),
all_changes AS (
SELECT
CASE
WHEN pr."createdId" IS NULL THEN 'ADDED'
WHEN cr."createdId" IS NULL THEN 'REMOVED'
WHEN pr."id" != cr."id" AND cr."hash" != pr."hash" THEN 'RENAMED_AND_MODIFIED'
WHEN pr."id" != cr."id" THEN 'RENAMED'
WHEN cr."hash" != pr."hash" THEN 'MODIFIED'
END AS "changeType",
pr."id" AS "fromRowId",
cr."id" AS "toRowId"
FROM child_rows cr
FULL OUTER JOIN parent_rows pr USING ("createdId")
WHERE
(pr."createdId" IS NULL OR
cr."createdId" IS NULL OR
pr."id" != cr."id" OR
cr."hash" != pr."hash")
)
SELECT
COUNT(*) AS "count"
FROM all_changes
WHERE
(${searchTerm}::text IS NULL OR
"fromRowId" ILIKE '%' || ${searchTerm} || '%' OR
"toRowId" ILIKE '%' || ${searchTerm} || '%')
AND (${changeTypes}::jsonb IS NULL OR (
"changeType" = ANY(ARRAY(SELECT jsonb_array_elements_text(${changeTypes}::jsonb)))
OR ("changeType" = 'RENAMED_AND_MODIFIED' AND (
'RENAMED' = ANY(ARRAY(SELECT jsonb_array_elements_text(${changeTypes}::jsonb)))
OR 'MODIFIED' = ANY(ARRAY(SELECT jsonb_array_elements_text(${changeTypes}::jsonb)))
))
))
  `;
}
