import { raw, sql, type Sql } from 'src/engine-prisma-types';
import { COMPARED_ROW_COLUMNS } from 'src/features/share/compared-columns';

const DIGESTED_ROW_COLUMNS = raw(
  ['versionId', ...COMPARED_ROW_COLUMNS]
    .map((column) => `r."${column}"`)
    .join(', '),
);

export function rowDigestSql(tableVersionId: string): Sql {
  return sql`
    SELECT count(*)::text || ':' || coalesce(md5(string_agg(
             jsonb_build_array(${DIGESTED_ROW_COLUMNS})::text, ','
             ORDER BY r."versionId" COLLATE "C"
           )), '') AS "digest"
    FROM "_RowToTable" rt
    JOIN "Row" r ON r."versionId" = rt."A"
    WHERE rt."B" = ${tableVersionId}
  `;
}
