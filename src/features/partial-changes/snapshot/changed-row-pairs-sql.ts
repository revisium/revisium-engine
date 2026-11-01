import { sql, type Sql } from 'src/engine-prisma-types';
import type {
  ChangedRowsKeyset,
  ComparedTable,
  RowBound,
} from 'src/features/partial-changes/snapshot/changes-snapshot';
import { rowChangePredicate } from 'src/features/partial-changes/snapshot/row-change-predicate';

export interface ChangedRowPairIds {
  readonly identity: string;
  readonly headVersionId: string | null;
  readonly draftVersionId: string | null;
}

export function changedRowPairsSql(table: ComparedTable): Sql {
  return sql`
    WITH head_only AS MATERIALIZED (
      ${rowLinksMissingIn(table.headVersionId, table.draftVersionId)}
    ),
    draft_only AS MATERIALIZED (
      ${rowLinksMissingIn(table.draftVersionId, table.headVersionId)}
    ),
    h AS (
      SELECT r.* FROM "Row" r
      WHERE r."versionId" = ANY(ARRAY(SELECT "versionId" FROM head_only))
    ),
    d AS (
      SELECT r.* FROM "Row" r
      WHERE r."versionId" = ANY(ARRAY(SELECT "versionId" FROM draft_only))
    )
    SELECT coalesce(h."createdId", d."createdId") AS "identity",
           coalesce(d."id", h."id") AS "rowId",
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
    WITH pairs AS (${changedRowPairsSql(table)}),
    keyset AS (
      SELECT "rowId" FROM pairs
      WHERE ${rowsFrom(from)}
      GROUP BY "rowId"
      ORDER BY "rowId" COLLATE "C"
      LIMIT ${rowLimit}
    )
    SELECT pairs.* FROM pairs
    WHERE pairs."rowId" IN (SELECT "rowId" FROM keyset)
    ORDER BY pairs."rowId" COLLATE "C", pairs."identity" COLLATE "C"
  `;
}

export function changedRowCountSql(table: ComparedTable): Sql {
  return sql`
    SELECT count(*)::int AS "count" FROM (${changedRowPairsSql(table)}) pairs
  `;
}

function rowLinksMissingIn(
  tableVersionId: string,
  otherTableVersionId: string,
): Sql {
  return sql`
    SELECT rt."A" AS "versionId" FROM "_RowToTable" rt
    WHERE rt."B" = ${tableVersionId}
      AND NOT EXISTS (
        SELECT 1 FROM "_RowToTable" other
        WHERE other."B" = ${otherTableVersionId} AND other."A" = rt."A"
      )
  `;
}

function rowsFrom(from: RowBound | undefined): Sql {
  if (!from) {
    return sql`TRUE`;
  }

  if (from.inclusive) {
    return sql`"rowId" COLLATE "C" >= ${from.rowId}`;
  }

  return sql`"rowId" COLLATE "C" > ${from.rowId}`;
}
