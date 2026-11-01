import { raw, sql, type Sql } from 'src/engine-prisma-types';

export interface RowLinkSide {
  readonly cte: string;
  readonly tableVersionId: string;
}

export function rowLinkDiffCtes(
  side: RowLinkSide,
  otherSide: RowLinkSide,
): Sql {
  return sql`
    ${raw(side.cte)} AS MATERIALIZED (
      ${rowLinksMissingIn(side.tableVersionId, otherSide.tableVersionId)}
    ),
    ${raw(otherSide.cte)} AS MATERIALIZED (
      ${rowLinksMissingIn(otherSide.tableVersionId, side.tableVersionId)}
    )
  `;
}

function rowLinksMissingIn(
  tableVersionId: string,
  otherTableVersionId: string,
): Sql {
  return sql`
    SELECT link."A" AS "versionId" FROM "_RowToTable" link
    WHERE link."B" = ${tableVersionId}
      AND NOT EXISTS (
        SELECT 1 FROM "_RowToTable" other
        WHERE other."B" = ${otherTableVersionId} AND other."A" = link."A"
      )
  `;
}
