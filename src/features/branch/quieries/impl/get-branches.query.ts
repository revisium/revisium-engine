import type { Branch } from 'src/engine-prisma-types';
import { IPaginatedType } from 'src/features/share/pagination.interface';

export class GetBranchesQuery {
  constructor(
    public data: {
      readonly projectId: string;
      readonly first: number;
      readonly after?: string;
    },
  ) {}
}

export type GetBranchesQueryData = GetBranchesQuery['data'];

export type GetBranchesQueryReturnType = IPaginatedType<Branch>;
