import { type OrderByPart } from '@revisium/prisma-pg-json';
import { sql } from 'src/engine-prisma-types';
import { getJsonKeysetPagination } from '../get-json-keyset-pagination';

const DEFAULT_ORDER_BY_PART: OrderByPart = {
  expression: sql`r."createdAt"`,
  direction: 'DESC',
  fieldName: 'createdAt',
  isJson: false,
};

describe('getJsonKeysetPagination', () => {
  it('throws when versionId is missing from the row projection', async () => {
    const getRowsSql = jest.fn().mockReturnValue(sql`SELECT 1`);
    const getRowsCountSql = jest.fn().mockReturnValue(sql`SELECT 0`);
    const queryRaw = jest
      .fn()
      .mockResolvedValueOnce([{ createdAt: new Date().toISOString() }])
      .mockResolvedValueOnce([{ count: BigInt(1) }]);

    await expect(
      getJsonKeysetPagination({
        pageData: { first: 1 },
        sourceId: 'source-id',
        fieldConfig: { createdAt: 'date' },
        defaultOrderByPart: DEFAULT_ORDER_BY_PART,
        queryRaw,
        transformRows: jest.fn().mockResolvedValue([{}]),
        getRowsSql,
        getRowsCountSql,
      }),
    ).rejects.toThrow(
      new Error('Pagination requires "versionId" in row projection'),
    );
  });
});
