import { BadRequestException } from '@nestjs/common';
import { sql, type Sql, type Row } from 'src/engine-prisma-types';
import {
  OrderByConditions,
  OrderByPart,
  WhereConditionsTyped,
} from '@revisium/prisma-pg-json';
import { IPaginatedType } from 'src/features/share/pagination.interface';
import { getJsonKeysetPagination } from 'src/features/share/utils/get-json-keyset-pagination';
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

  return getJsonKeysetPagination({
    pageData,
    sourceId: tableStateId,
    whereConditions,
    orderBy,
    fieldConfig: COW_ROW_FIELDS,
    defaultOrderByPart: {
      expression: sql`r."createdAt"`,
      direction: 'DESC' as const,
      fieldName: 'createdAt',
      isJson: false,
    } satisfies OrderByPart,
    queryRaw,
    transformRows,
    getRowsSql: getCowRowsSql,
    getRowsCountSql: getCowRowsCountSql,
  });
}
