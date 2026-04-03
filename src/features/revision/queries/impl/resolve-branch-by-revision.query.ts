import { Branch } from 'src/__generated__/client';

export class ResolveBranchByRevisionQuery {
  constructor(public revisionId: string) {}
}

export type ResolveBranchByRevisionQueryData =
  ResolveBranchByRevisionQuery['revisionId'];

export type ResolveBranchByRevisionQueryReturnType = Branch;
