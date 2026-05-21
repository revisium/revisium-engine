import { BadRequestException } from '@nestjs/common';
import { encodeCursor } from '@revisium/prisma-pg-json';
import { Row, Sql } from 'src/engine-prisma-types';
import { getKeysetPagination } from '../get-keyset-pagination';

const makeRow = (id: string, createdAt: string): Row => ({
  id,
  versionId: `${id}-version`,
  createdId: `${id}-created`,
  readonly: false,
  createdAt: new Date(createdAt),
  updatedAt: new Date(createdAt),
  publishedAt: new Date(createdAt),
  data: { name: id },
  meta: {},
  hash: '',
  schemaHash: '',
});

const createQueryRaw = (rows: Row[]) => {
  const mock = jest
    .fn<Promise<unknown>, [Sql]>()
    .mockResolvedValueOnce(rows)
    .mockResolvedValueOnce([{ count: BigInt(rows.length) }]);

  return {
    mock,
    queryRaw: mock as unknown as <R>(sql: Sql) => Promise<R>,
  };
};

describe('getKeysetPagination', () => {
  it('returns a page and cursor without after cursor', async () => {
    const rows = [
      makeRow('row-1', '2024-01-02T00:00:00.000Z'),
      makeRow('row-2', '2024-01-01T00:00:00.000Z'),
    ];
    const { queryRaw } = createQueryRaw(rows);

    const result = await getKeysetPagination({
      pageData: { first: 1 },
      tableVersionId: 'table-version',
      queryRaw,
      transformRows: async (inputRows) => inputRows,
    });

    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]?.cursor).toEqual(expect.any(String));
    expect(result.pageInfo.hasPreviousPage).toBe(false);
    expect(result.pageInfo.hasNextPage).toBe(true);
  });

  it('accepts a valid after cursor', async () => {
    const firstRows = [
      makeRow('row-1', '2024-01-02T00:00:00.000Z'),
      makeRow('row-2', '2024-01-01T00:00:00.000Z'),
    ];
    const firstPage = await getKeysetPagination({
      pageData: { first: 1 },
      tableVersionId: 'table-version',
      queryRaw: createQueryRaw(firstRows).queryRaw,
      transformRows: async (inputRows) => inputRows,
    });

    const { mock, queryRaw } = createQueryRaw([
      makeRow('row-2', '2024-01-01T00:00:00.000Z'),
    ]);

    const result = await getKeysetPagination({
      pageData: { first: 1, after: firstPage.pageInfo.endCursor },
      tableVersionId: 'table-version',
      queryRaw,
      transformRows: async (inputRows) => inputRows,
    });

    expect(result.pageInfo.hasPreviousPage).toBe(true);
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it('rejects malformed after cursor instead of returning the first page', async () => {
    const { mock, queryRaw } = createQueryRaw([
      makeRow('row-1', '2024-01-01T00:00:00.000Z'),
    ]);

    await expect(
      getKeysetPagination({
        pageData: { first: 1, after: 'not-a-real-cursor' },
        tableVersionId: 'table-version',
        queryRaw,
        transformRows: async (inputRows) => inputRows,
      }),
    ).rejects.toThrow(BadRequestException);

    expect(mock).not.toHaveBeenCalled();
  });

  it('rejects stale cursor that does not match current sort', async () => {
    const staleCursor = encodeCursor(
      ['2024-01-01T00:00:00.000Z'],
      'row-1-version',
      'different-sort',
    );
    const { mock, queryRaw } = createQueryRaw([
      makeRow('row-1', '2024-01-01T00:00:00.000Z'),
    ]);

    await expect(
      getKeysetPagination({
        pageData: { first: 1, after: staleCursor },
        tableVersionId: 'table-version',
        queryRaw,
        transformRows: async (inputRows) => inputRows,
      }),
    ).rejects.toThrow(BadRequestException);

    expect(mock).not.toHaveBeenCalled();
  });
});
