import { BadRequestException } from '@nestjs/common';
import { sql, type Sql, type Row } from 'src/engine-prisma-types';
import {
  OrderByConditions,
  OrderByPart,
  WhereConditionsTyped,
  buildKeysetCondition,
  computeSortHash,
  decodeCursor,
  encodeCursor,
  extractCursorValues,
  generateOrderByParts,
} from '@revisium/prisma-pg-json';
import { IPaginatedType } from 'src/features/share/pagination.interface';
import {
  COW_ROW_FIELDS,
  getCowRowsCountSql,
  getCowRowsSql,
} from 'src/features/versioning-engine/utils/cow-get-rows-sql';

interface GetCowKeysetPaginationArgs<T> {
  pageData: { first: number; after?: string };
  tableStateId: string;
  whereConditions?: WhereConditionsTyped<typeof COW_ROW_FIELDS>;
  orderBy?: OrderByConditions[];
  queryRaw: <R>(sql: Sql) => Promise<R>;
  transformRows: (rows: Row[]) => Promise<T[]>;
}

export async function getCowKeysetPagination<T>({
  pageData,
  tableStateId,
  whereConditions,
  orderBy,
  queryRaw,
  transformRows,
}: GetCowKeysetPaginationArgs<T>): Promise<IPaginatedType<T>> {
  if (!Number.isInteger(pageData.first) || pageData.first <= 0) {
    throw new BadRequestException(
      'Invalid "first" parameter: must be a positive integer',
    );
  }

  const userParts = generateOrderByParts({
    tableAlias: 'r',
    orderBy,
    fieldConfig: COW_ROW_FIELDS,
  });

  const effectiveParts: OrderByPart[] =
    userParts.length > 0
      ? userParts
      : [
          {
            expression: sql`r."createdAt"`,
            direction: 'DESC' as const,
            fieldName: 'createdAt',
            isJson: false,
          },
        ];

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
    getCowRowsSql(
      tableStateId,
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
    getCowRowsCountSql(tableStateId, whereConditions),
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
