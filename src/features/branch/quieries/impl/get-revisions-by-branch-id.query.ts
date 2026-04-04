import type { SortOrder, Revision } from 'src/engine-prisma-types';
import { IPaginatedType } from 'src/features/share/pagination.interface';

export class GetRevisionsByBranchIdQuery {
  constructor(
    public data: {
      readonly branchId: string;
      readonly first: number;
      readonly after?: string;
      readonly before?: string;
      readonly inclusive?: boolean;
      readonly sort?: SortOrder;
      readonly comment?: string;
    },
  ) {}
}

export type GetRevisionsByBranchIdQueryData =
  GetRevisionsByBranchIdQuery['data'];

export type GetRevisionsByBranchIdQueryReturnType = IPaginatedType<Revision>;
