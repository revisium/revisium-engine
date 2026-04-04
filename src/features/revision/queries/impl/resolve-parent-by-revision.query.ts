import type { Revision } from 'src/engine-prisma-types';

export class ResolveParentByRevisionQuery {
  constructor(public revisionId: string) {}
}

export type ResolveParentByRevisionQueryData =
  ResolveParentByRevisionQuery['revisionId'];

export type ResolveParentByRevisionQueryReturnType = Revision | null;
