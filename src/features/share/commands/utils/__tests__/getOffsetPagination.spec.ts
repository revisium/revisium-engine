import { BadRequestException } from '@nestjs/common';
import {
  getOffsetPagination,
  FindManyType,
  OffsetPaginationFindManyArgs,
} from '../getOffsetPagination';

type TestNode = { id: string };

describe('getOffsetPagination', () => {
  const mockNodes: TestNode[] = [
    { id: '1' },
    { id: '2' },
    { id: '3' },
    { id: '4' },
    { id: '5' },
  ];

  let mockFindMany: jest.MockedFunction<FindManyType<TestNode>>;
  let mockCount: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockCount = jest.fn().mockResolvedValue(mockNodes.length);

    mockFindMany = jest
      .fn()
      .mockImplementation(
        async ({ take, skip }: OffsetPaginationFindManyArgs) => {
          return mockNodes.slice(skip, skip + take);
        },
      );
  });

  describe('validation', () => {
    it('should throw BadRequestException when first is negative', async () => {
      await expect(
        getOffsetPagination({
          pageData: { first: -1 },
          findMany: mockFindMany,
          count: mockCount,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when first is not an integer', async () => {
      await expect(
        getOffsetPagination({
          pageData: { first: 1.5 },
          findMany: mockFindMany,
          count: mockCount,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when first is NaN', async () => {
      await expect(
        getOffsetPagination({
          pageData: { first: NaN },
          findMany: mockFindMany,
          count: mockCount,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when after is not a valid integer string', async () => {
      await expect(
        getOffsetPagination({
          pageData: { first: 10, after: 'abc' },
          findMany: mockFindMany,
          count: mockCount,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when after is a negative number string', async () => {
      await expect(
        getOffsetPagination({
          pageData: { first: 10, after: '-1' },
          findMany: mockFindMany,
          count: mockCount,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when after is a decimal string', async () => {
      await expect(
        getOffsetPagination({
          pageData: { first: 10, after: '1.5' },
          findMany: mockFindMany,
          count: mockCount,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should accept first=0 as a valid value', async () => {
      const result = await getOffsetPagination({
        pageData: { first: 0 },
        findMany: mockFindMany,
        count: mockCount,
      });

      expect(result.edges).toHaveLength(0);
    });

    it('should accept after="0" as a valid cursor', async () => {
      const result = await getOffsetPagination({
        pageData: { first: 2, after: '0' },
        findMany: mockFindMany,
        count: mockCount,
      });

      expect(result.edges).toHaveLength(2);
    });
  });

  describe('basic pagination', () => {
    it('should return first page without after cursor', async () => {
      const result = await getOffsetPagination({
        pageData: { first: 2 },
        findMany: mockFindMany,
        count: mockCount,
      });

      expect(result.edges).toHaveLength(2);
      expect(result.totalCount).toBe(5);
      expect(result.pageInfo.hasNextPage).toBe(true);
      expect(result.pageInfo.hasPreviousPage).toBe(false);
    });

    it('should return correct cursors', async () => {
      const result = await getOffsetPagination({
        pageData: { first: 2 },
        findMany: mockFindMany,
        count: mockCount,
      });

      expect(result.pageInfo.startCursor).toBe('1');
      expect(result.pageInfo.endCursor).toBe('2');
    });
  });
});
