import type { Revision } from 'src/engine-prisma-types';

export class ResolveChildByRevisionQuery {
  constructor(public revisionId: string) {}
}

export type ResolveChildByRevisionQueryData =
  ResolveChildByRevisionQuery['revisionId'];

export type ResolveChildByRevisionQueryReturnType = Revision | null;
