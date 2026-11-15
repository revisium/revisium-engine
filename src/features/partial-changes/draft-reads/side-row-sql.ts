import { sql, type Sql } from 'src/engine-prisma-types';

// The row version that holds the row id in a table version.
export function rowOfTableVersionSql(
  tableVersionId: string,
  rowId: string,
): Sql {
  return sql`
    SELECT r.*
    FROM "Row" r
    JOIN "_RowToTable" l ON l."A" = r."versionId" AND l."B" = ${tableVersionId}
    WHERE r."id" = ${rowId}
  `;
}

// The row version in a table version of the row that holds the row id in the other side's table version.
export function rowOfOtherSideIdSql(
  tableVersionId: string,
  otherTableVersionId: string,
  rowId: string,
): Sql {
  return sql`
    SELECT r.*
    FROM "Row" o
    JOIN "_RowToTable" ol ON ol."A" = o."versionId" AND ol."B" = ${otherTableVersionId}
    JOIN "Row" r ON r."createdId" = o."createdId"
    JOIN "_RowToTable" l ON l."A" = r."versionId" AND l."B" = ${tableVersionId}
    WHERE o."id" = ${rowId}
  `;
}
