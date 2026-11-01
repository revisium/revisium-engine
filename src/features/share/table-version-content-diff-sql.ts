import { join, raw, sql, type Sql } from 'src/engine-prisma-types';
import {
  COMPARED_ROW_COLUMNS,
  COMPARED_TABLE_COLUMNS,
} from 'src/features/share/compared-columns';
import { rowLinkDiffCtes } from 'src/features/share/row-link-diff-sql';

export interface TableVersionContentDiff {
  readonly differs: boolean;
}

export function tableVersionContentDiffSql(
  fromTableVersionId: string,
  toTableVersionId: string,
): Sql {
  return sql`
    WITH ${fromAndToOnly(fromTableVersionId, toTableVersionId)},
    f AS (
      SELECT r.* FROM "Row" r
      WHERE r."versionId" = ANY(ARRAY(SELECT "versionId" FROM from_only))
    ),
    t AS (
      SELECT r.* FROM "Row" r
      WHERE r."versionId" = ANY(ARRAY(SELECT "versionId" FROM to_only))
    )
    SELECT EXISTS (
      SELECT 1 FROM "Table" f, "Table" t
      WHERE f."versionId" = ${fromTableVersionId}
        AND t."versionId" = ${toTableVersionId}
        AND (${columnsDiffer(COMPARED_TABLE_COLUMNS)})
    ) OR EXISTS (
      SELECT 1 FROM f FULL OUTER JOIN t ON f."createdId" = t."createdId"
      WHERE f."createdId" IS NULL
         OR t."createdId" IS NULL
         OR ${columnsDiffer(COMPARED_ROW_COLUMNS)}
    ) AS "differs"
  `;
}

function fromAndToOnly(
  fromTableVersionId: string,
  toTableVersionId: string,
): Sql {
  return rowLinkDiffCtes(
    { cte: 'from_only', tableVersionId: fromTableVersionId },
    { cte: 'to_only', tableVersionId: toTableVersionId },
  );
}

function columnsDiffer(columns: readonly string[]): Sql {
  return join(
    columns.map((column) =>
      raw(`f."${column}" IS DISTINCT FROM t."${column}"`),
    ),
    ' OR ',
  );
}
