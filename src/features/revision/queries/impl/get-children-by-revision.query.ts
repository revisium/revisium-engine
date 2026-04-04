import type { Revision } from 'src/engine-prisma-types';

export class GetChildrenByRevisionQuery {
  constructor(public revisionId: string) {}
}

export type GetChildrenByRevisionQueryData =
  GetChildrenByRevisionQuery['revisionId'];

export type GetChildrenByRevisionQueryReturnType = Revision[];
