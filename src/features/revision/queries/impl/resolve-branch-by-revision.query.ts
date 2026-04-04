import type { Branch } from 'src/engine-prisma-types';

export class ResolveBranchByRevisionQuery {
  constructor(public revisionId: string) {}
}

export type ResolveBranchByRevisionQueryData =
  ResolveBranchByRevisionQuery['revisionId'];

export type ResolveBranchByRevisionQueryReturnType = Branch;
