import type { Branch } from 'src/engine-prisma-types';

export class GetBranchByIdQuery {
  constructor(public branchId: string) {}
}

export type GetBranchByIdQueryData = GetBranchByIdQuery['branchId'];

export type GetBranchByIdQueryReturnType = Branch;
