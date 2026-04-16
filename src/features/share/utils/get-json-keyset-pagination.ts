import { sql, type Sql, type Row } from 'src/engine-prisma-types';
import {
  type FieldConfig,
  OrderByConditions,
  OrderByPart,
  WhereConditionsTyped,
  encodeCursor,
  decodeCursor,
  computeSortHash,
  extractCursorValues,
  buildKeysetCondition,
  generateOrderByParts,
} from '@revisium/prisma-pg-json';
import { IPaginatedType } from 'src/features/share/pagination.interface';

interface GetJsonKeysetPaginationArgs<T, TFields extends FieldConfig> {
  pageData: { first: number; after?: string };
  sourceId: string;
  whereConditions?: WhereConditionsTyped<TFields>;
  orderBy?: OrderByConditions[];
  fieldConfig: TFields;
  defaultOrderByPart: OrderByPart;
  queryRaw: <R>(sql: Sql) => Promise<R>;
  transformRows: (rows: Row[]) => Promise<T[]>;
  getRowsSql: (
    sourceId: string,
    take: number,
    skip: number,
    whereConditions?: WhereConditionsTyped<TFields>,
    orderBy?: OrderByConditions[],
    keysetCondition?: Sql,
  ) => Sql;
  getRowsCountSql: (
    sourceId: string,
    whereConditions?: WhereConditionsTyped<TFields>,
  ) => Sql;
}

export async function getJsonKeysetPagination<T, TFields extends FieldConfig>({
  pageData,
  sourceId,
  whereConditions,
  orderBy,
  fieldConfig,
  defaultOrderByPart,
  queryRaw,
  transformRows,
  getRowsSql,
  getRowsCountSql,
}: GetJsonKeysetPaginationArgs<T, TFields>): Promise<IPaginatedType<T>> {
  const userParts = generateOrderByParts({
    tableAlias: 'r',
    orderBy,
    fieldConfig,
  });

  const effectiveParts =
    userParts.length > 0 ? userParts : [defaultOrderByPart];
  const sortHash = computeSortHash(effectiveParts);

  let keysetCondition: Sql | undefined;
  let hasPreviousPage = false;

  if (pageData.after) {
    const decoded = decodeCursor(pageData.after);
    if (
      decoded?.sortHash === sortHash &&
      decoded?.values.length === effectiveParts.length
    ) {
      keysetCondition = buildKeysetCondition(
        effectiveParts,
        decoded.values,
        decoded.tiebreaker,
        sql`r."versionId"`,
      );
      hasPreviousPage = true;
    }
  }

  const take = pageData.first;
  const rows = await queryRaw<Row[]>(
    getRowsSql(
      sourceId,
      take + 1,
      0,
      whereConditions,
      orderBy,
      keysetCondition,
    ),
  );

  const hasNextPage = rows.length > take;
  const resultRows = hasNextPage ? rows.slice(0, take) : rows;
  const transformedRows = await transformRows(resultRows);

  const edges = transformedRows.map((node, index) => {
    const row = resultRows[index] as unknown as Record<string, unknown>;
    const cursorValues = extractCursorValues(row, effectiveParts);
    const tiebreaker = row.versionId as string;
    return {
      cursor: encodeCursor(cursorValues, tiebreaker, sortHash),
      node,
    };
  });

  const countResult = await queryRaw<[{ count: bigint }]>(
    getRowsCountSql(sourceId, whereConditions),
  );

  return {
    edges,
    pageInfo: {
      startCursor: edges.at(0)?.cursor,
      endCursor: edges.at(-1)?.cursor,
      hasNextPage,
      hasPreviousPage,
    },
    totalCount: Number(countResult[0].count),
  };
}
