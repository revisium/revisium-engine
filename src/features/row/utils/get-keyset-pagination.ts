import { sql, type Sql, type Row } from 'src/engine-prisma-types';
import {
  OrderByConditions,
  OrderByPart,
  WhereConditionsTyped,
} from '@revisium/prisma-pg-json';
import { IPaginatedType } from 'src/features/share/pagination.interface';
import { getJsonKeysetPagination } from 'src/features/share/utils/get-json-keyset-pagination';
import {
  getRowsSql,
  getRowsCountSql,
  DEFAULT_ROW_FIELDS,
} from './get-rows-sql';

interface GetKeysetPaginationArgs<T> {
  pageData: { first: number; after?: string };
  tableVersionId: string;
  whereConditions?: WhereConditionsTyped<typeof DEFAULT_ROW_FIELDS>;
  orderBy?: OrderByConditions[];
  queryRaw: <R>(sql: Sql) => Promise<R>;
  transformRows: (rows: Row[]) => Promise<T[]>;
}

export async function getKeysetPagination<T>({
  pageData,
  tableVersionId,
  whereConditions,
  orderBy,
  queryRaw,
  transformRows,
}: GetKeysetPaginationArgs<T>): Promise<IPaginatedType<T>> {
  return getJsonKeysetPagination({
    pageData,
    sourceId: tableVersionId,
    whereConditions,
    orderBy,
    fieldConfig: DEFAULT_ROW_FIELDS,
    defaultOrderByPart: {
      expression: sql`r."createdAt"`,
      direction: 'DESC' as const,
      fieldName: 'createdAt',
      isJson: false,
    } satisfies OrderByPart,
    queryRaw,
    transformRows,
    getRowsSql,
    getRowsCountSql,
  });
}
