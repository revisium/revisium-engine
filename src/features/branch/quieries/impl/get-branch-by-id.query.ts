import { Branch } from 'src/__generated__/client';

export class GetBranchByIdQuery {
  constructor(public branchId: string) {}
}

export type GetBranchByIdQueryData = GetBranchByIdQuery['branchId'];

export type GetBranchByIdQueryReturnType = Branch;
