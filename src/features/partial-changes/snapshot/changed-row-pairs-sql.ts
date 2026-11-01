import { raw, sql, type Sql } from 'src/engine-prisma-types';
import type {
  ChangedRowsKeyset,
  ComparedTable,
  RowBound,
} from 'src/features/partial-changes/snapshot/changes-snapshot';
import { rowChangePredicate } from 'src/features/partial-changes/snapshot/row-change-predicate';
import { rowLinkDiffCtes } from 'src/features/share/row-link-diff-sql';

export interface ChangedRowPairIds {
  readonly identity: string;
  readonly headVersionId: string | null;
  readonly draftVersionId: string | null;
}

export function changedRowPairsSql(table: ComparedTable): Sql {
  return sql`
    WITH ${headAndDraftOnly(table)},
    h AS (
      SELECT r.* FROM "Row" r
      WHERE r."versionId" = ANY(ARRAY(SELECT "versionId" FROM head_only))
    ),
    d AS (
      SELECT r.* FROM "Row" r
      WHERE r."versionId" = ANY(ARRAY(SELECT "versionId" FROM draft_only))
    )
    SELECT coalesce(h."createdId", d."createdId") AS "identity",
           h."versionId" AS "headVersionId",
           d."versionId" AS "draftVersionId"
    FROM h FULL OUTER JOIN d ON h."createdId" = d."createdId"
    WHERE h."createdId" IS NULL
       OR d."createdId" IS NULL
       OR (${rowChangePredicate(table.structure)})
  `;
}

export function changedRowPairsFromSql(
  table: ComparedTable,
  { from, rowLimit }: ChangedRowsKeyset,
): Sql {
  return sql`
    WITH ${headAndDraftOnly(table)},
    head_keys AS (${rowKeysOf(raw('head_only'))}),
    draft_keys AS (${rowKeysOf(raw('draft_only'))}),
    candidates AS (
      SELECT coalesce(hk."createdId", dk."createdId") AS "identity",
             coalesce(dk."id", hk."id") AS "rowId",
             hk."versionId" AS "headVersionId",
             dk."versionId" AS "draftVersionId"
      FROM head_keys hk FULL OUTER JOIN draft_keys dk
        ON hk."createdId" = dk."createdId"
    )
    SELECT c.* FROM (
      SELECT * FROM candidates c
      WHERE ${rowsFrom(from)}
      ORDER BY c."rowId" COLLATE "C"
      OFFSET 0
    ) c
    CROSS JOIN LATERAL (
      SELECT 1 FROM (VALUES (1)) AS pair
      LEFT JOIN "Row" h ON h."versionId" = c."headVersionId"
      LEFT JOIN "Row" d ON d."versionId" = c."draftVersionId"
      WHERE c."headVersionId" IS NULL
         OR c."draftVersionId" IS NULL
         OR (${rowChangePredicate(table.structure)})
      LIMIT 1
    ) changed
    ORDER BY c."rowId" COLLATE "C"
    FETCH FIRST ${rowLimit} ROWS WITH TIES
  `;
}

export function changedRowCountSql(table: ComparedTable): Sql {
  return sql`
    SELECT count(*)::int AS "count" FROM (${changedRowPairsSql(table)}) pairs
  `;
}

function headAndDraftOnly({
  headVersionId,
  draftVersionId,
}: ComparedTable): Sql {
  return rowLinkDiffCtes(
    { cte: 'head_only', tableVersionId: headVersionId },
    { cte: 'draft_only', tableVersionId: draftVersionId },
  );
}

function rowKeysOf(versions: Sql): Sql {
  return sql`
    SELECT r."versionId", r."createdId", r."id" FROM "Row" r
    WHERE r."versionId" = ANY(ARRAY(SELECT "versionId" FROM ${versions}))
  `;
}

function rowsFrom(from: RowBound | undefined): Sql {
  if (!from) {
    return sql`TRUE`;
  }

  if (from.inclusive) {
    return sql`c."rowId" COLLATE "C" >= ${from.rowId}`;
  }

  return sql`c."rowId" COLLATE "C" > ${from.rowId}`;
}
