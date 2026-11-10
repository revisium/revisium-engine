import { sql, type Sql } from 'src/engine-prisma-types';
import type { ComparedTable } from 'src/features/partial-changes/snapshot/changes-snapshot';

// A renamed row of a compared table: the Head id it left, the Draft id it took and its two versions.
export interface RenamedRowIds {
  readonly identity: string;
  readonly headRowId: string;
  readonly draftRowId: string;
  readonly headVersionId: string;
  readonly draftVersionId: string;
}

// A Head id and the row that held it in Head: absent, deleted in the Draft, or renamed to draftRowId.
export interface HeadIdHolderRow {
  readonly headRowId: string;
  readonly identity: string | null;
  readonly headVersionId: string | null;
  readonly draftRowId: string | null;
  readonly draftVersionId: string | null;
}

// The renamed rows of a table that hold one of the Draft ids in the Draft, found by row id and identity.
export function renamedRowsSql(
  { headVersionId, draftVersionId }: ComparedTable,
  draftRowIds: readonly string[],
): Sql {
  return sql`
    SELECT d."createdId" AS "identity",
           h."id" AS "headRowId", d."id" AS "draftRowId",
           h."versionId" AS "headVersionId", d."versionId" AS "draftVersionId"
    FROM "Row" d
    JOIN "_RowToTable" dl ON dl."A" = d."versionId" AND dl."B" = ${draftVersionId}
    JOIN "Row" h ON h."createdId" = d."createdId" AND h."id" <> d."id"
    JOIN "_RowToTable" hl ON hl."A" = h."versionId" AND hl."B" = ${headVersionId}
    WHERE d."id" = ANY(${[...draftRowIds]}::text[])
  `;
}

// Follows each Head id to the Draft id of the renamed row that held it, for at most `steps` ids in a row, and returns
// the holder of every id it reached.
export function headIdHoldersSql(
  { headVersionId, draftVersionId }: ComparedTable,
  headRowIds: readonly string[],
  steps: number,
): Sql {
  return sql`
    WITH RECURSIVE walked("rowId", "step") AS (
      SELECT looked_up."rowId", 1
      FROM unnest(${[...headRowIds]}::text[]) AS looked_up("rowId")
      UNION
      SELECT d."id", w."step" + 1
      FROM walked w
      JOIN "Row" h ON h."id" = w."rowId"
      JOIN "_RowToTable" hl ON hl."A" = h."versionId" AND hl."B" = ${headVersionId}
      JOIN "Row" d ON d."createdId" = h."createdId" AND d."id" <> h."id"
      JOIN "_RowToTable" dl ON dl."A" = d."versionId" AND dl."B" = ${draftVersionId}
      WHERE w."step" < ${steps}
    )
    SELECT DISTINCT w."rowId" AS "headRowId",
           h."createdId" AS "identity",
           h."versionId" AS "headVersionId",
           d."id" AS "draftRowId",
           d."versionId" AS "draftVersionId"
    FROM walked w
    LEFT JOIN ("Row" h JOIN "_RowToTable" hl ON hl."A" = h."versionId" AND hl."B" = ${headVersionId})
      ON h."id" = w."rowId"
    LEFT JOIN ("Row" d JOIN "_RowToTable" dl ON dl."A" = d."versionId" AND dl."B" = ${draftVersionId})
      ON d."createdId" = h."createdId"
  `;
}
