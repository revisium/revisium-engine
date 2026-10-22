import { sql, type Sql } from 'src/engine-prisma-types';

export function linksMissingIn(
  tableVersionId: string,
  otherTableVersionId: string,
): Sql {
  return sql`
    SELECT rt."A" FROM "_RowToTable" rt
    WHERE rt."B" = ${tableVersionId}
      AND NOT EXISTS (
        SELECT 1 FROM "_RowToTable" o WHERE o."B" = ${otherTableVersionId} AND o."A" = rt."A"
      )
  `;
}
