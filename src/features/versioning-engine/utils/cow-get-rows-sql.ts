import { sql, raw, type Sql } from 'src/engine-prisma-types';
import {
  FieldConfig,
  generateOrderByClauses,
  generateWhere,
  OrderByConditions,
  WhereConditionsTyped,
} from '@revisium/prisma-pg-json';

export const COW_ROW_FIELDS: FieldConfig = {
  versionId: 'string',
  createdId: 'string',
  id: 'string',
  hash: 'string',
  schemaHash: 'string',
  readonly: 'boolean',
  createdAt: 'date',
  updatedAt: 'date',
  publishedAt: 'date',
  data: 'json',
  meta: 'json',
};

const ROW_COLUMNS = sql`
  rs."id" AS "versionId",
  rs."rowCreatedId" AS "createdId",
  rs."rowId" AS "id",
  rs."readonly" AS "readonly",
  rs."createdAt" AS "createdAt",
  rs."updatedAt" AS "updatedAt",
  rs."publishedAt" AS "publishedAt",
  rs."data" AS "data",
  rs."meta" AS "meta",
  rs."hash" AS "hash",
  rs."schemaHash" AS "schemaHash"`;

const BASE_JOIN = sql`
  FROM "CowTableStateChunk" tsc
  INNER JOIN "CowChunkEntry" ce ON ce."chunkId" = tsc."chunkId"
  INNER JOIN "CowRowState" rs ON rs."id" = ce."rowStateId"`;

export function getCowRowsSql(
  tableStateId: string,
  take: number,
  skip: number,
  whereConditions?: WhereConditionsTyped<typeof COW_ROW_FIELDS>,
  orderBy?: OrderByConditions[],
  keysetCondition?: Sql,
): Sql {
  const whereClause = generateWhere({
    where: whereConditions ?? {},
    fieldConfig: COW_ROW_FIELDS,
    tableAlias: 'r',
  });

  const userClauses = (orderBy ?? []).length
    ? generateOrderByClauses({
        orderBy,
        fieldConfig: COW_ROW_FIELDS,
        tableAlias: 'r',
      })
    : null;
  const orderByClause = userClauses
    ? sql`ORDER BY ${userClauses}, ${raw('r."versionId" DESC')}`
    : sql`ORDER BY r."createdAt" DESC, r."versionId" DESC`;

  const keysetClause = keysetCondition ? sql`AND ${keysetCondition}` : sql``;
  const offsetClause = keysetCondition ? sql`` : sql`OFFSET ${skip}`;

  return sql`
    WITH _rows AS (
      SELECT ${ROW_COLUMNS}
      ${BASE_JOIN}
      WHERE tsc."tableStateId" = ${tableStateId}
        AND ce."isDeleted" = false
    )
    SELECT * FROM _rows r
    WHERE (${whereClause})
      ${keysetClause}
    ${orderByClause}
    LIMIT ${take}
    ${offsetClause}
  `;
}

export function getCowRowsCountSql(
  tableStateId: string,
  whereConditions?: WhereConditionsTyped<typeof COW_ROW_FIELDS>,
): Sql {
  const whereClause = generateWhere({
    where: whereConditions ?? {},
    fieldConfig: COW_ROW_FIELDS,
    tableAlias: 'r',
  });

  return sql`
    WITH _rows AS (
      SELECT ${ROW_COLUMNS}
      ${BASE_JOIN}
      WHERE tsc."tableStateId" = ${tableStateId}
        AND ce."isDeleted" = false
    )
    SELECT COUNT(*) AS count FROM _rows r
    WHERE (${whereClause})
  `;
}
