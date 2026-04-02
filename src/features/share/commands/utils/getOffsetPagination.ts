import { BadRequestException } from '@nestjs/common';
import { IPaginatedType } from 'src/features/share/pagination.interface';

type PageDataType = { readonly first: number; after?: string };

export type OffsetPaginationFindManyArgs = {
  take: number;
  skip: number;
};

export type FindManyType<T> = (
  args: OffsetPaginationFindManyArgs,
) => Promise<T[]>;

type CountType = () => Promise<number>;

type GetPaginationArgsType<T> = {
  pageData: PageDataType;
  findMany: FindManyType<T>;
  count: CountType;
};

export async function getOffsetPagination<T>({
  pageData,
  findMany,
  count,
}: GetPaginationArgsType<T>): Promise<IPaginatedType<T>> {
  if (!Number.isInteger(pageData.first) || pageData.first < 0) {
    throw new BadRequestException(
      'Invalid "first" parameter: must be a non-negative integer',
    );
  }

  if (pageData.after !== undefined) {
    if (
      !/^\d+$/.test(pageData.after) ||
      !Number.isSafeInteger(Number(pageData.after))
    ) {
      throw new BadRequestException(
        'Invalid "after" cursor: must be a non-negative integer string',
      );
    }
  }

  const take = pageData.first;
  const skip = pageData.after ? Number(pageData.after) : 0;

  const items = await findMany({
    take,
    skip,
  });

  const endCursor: number | undefined = items.length
    ? skip + items.length
    : undefined;
  const startCursor: number | undefined = items.length ? skip + 1 : undefined;

  const hasNextPage = endCursor
    ? await findMany({
        take: 1,
        skip: endCursor,
      }).then((result) => Boolean(result.length))
    : false;
  const hasPreviousPage = Boolean(startCursor && startCursor > 1);

  const totalCount = await count();

  return {
    edges: items.map((item, index) => ({
      cursor: ((startCursor ?? 0) + index).toString(),
      node: item,
    })),
    pageInfo: {
      startCursor: startCursor?.toString(),
      endCursor: endCursor?.toString(),
      hasNextPage,
      hasPreviousPage,
    },
    totalCount,
  };
}
