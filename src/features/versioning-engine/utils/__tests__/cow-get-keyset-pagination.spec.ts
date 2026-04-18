import { MAX_TAKE } from '@revisium/prisma-pg-json';
import { getCowKeysetPagination } from '../cow-get-keyset-pagination';
import { getJsonKeysetPagination } from 'src/features/share/utils/get-json-keyset-pagination';

jest.mock('src/features/share/utils/get-json-keyset-pagination', () => ({
  getJsonKeysetPagination: jest.fn(),
}));

describe('getCowKeysetPagination', () => {
  beforeEach(() => {
    jest.mocked(getJsonKeysetPagination).mockReset();
    jest.mocked(getJsonKeysetPagination).mockResolvedValue({
      edges: [],
      pageInfo: {
        hasNextPage: false,
        hasPreviousPage: false,
      },
      totalCount: 0,
    });
  });

  it('caps first to MAX_TAKE before querying', async () => {
    await getCowKeysetPagination({
      pageData: { first: MAX_TAKE + 25 },
      tableStateId: 'table-state-id',
      queryRaw: jest.fn(),
      transformRows: jest.fn().mockResolvedValue([]),
    });

    expect(getJsonKeysetPagination).toHaveBeenCalledWith(
      expect.objectContaining({
        pageData: expect.objectContaining({ first: MAX_TAKE }),
      }),
    );
  });
});
