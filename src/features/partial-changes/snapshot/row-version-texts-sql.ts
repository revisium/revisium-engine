import { raw, sql, type Sql } from 'src/engine-prisma-types';
import { COMPARED_ROW_COLUMNS } from 'src/features/share/compared-columns';

export interface RowVersionText {
  readonly versionId: string;
  readonly text: string;
}

const FRESHNESS_ROW_COLUMNS = raw(
  ['versionId', 'updatedAt', ...COMPARED_ROW_COLUMNS]
    .map((column) => `r."${column}"`)
    .join(', '),
);

export function rowVersionTextsSql(versionIds: readonly string[]): Sql {
  return sql`
    SELECT r."versionId", jsonb_build_array(${FRESHNESS_ROW_COLUMNS})::text AS "text"
    FROM "Row" r
    WHERE r."versionId" = ANY(${[...versionIds]}::text[])
  `;
}
