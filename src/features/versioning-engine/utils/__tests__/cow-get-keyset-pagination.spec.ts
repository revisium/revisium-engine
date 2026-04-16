import { BadRequestException } from '@nestjs/common';
import { getCowKeysetPagination } from '../cow-get-keyset-pagination';

describe('getCowKeysetPagination', () => {
  it.each([0, -1])('throws when first is %s', async (first) => {
    await expect(
      getCowKeysetPagination({
        pageData: { first },
        tableStateId: 'table-state-id',
        queryRaw: jest.fn(),
        transformRows: jest.fn(),
      }),
    ).rejects.toThrow(
      new BadRequestException(
        'Invalid "first" parameter: must be a positive integer',
      ),
    );
  });
});
