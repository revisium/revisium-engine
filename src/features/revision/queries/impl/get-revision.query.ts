import type { Revision } from 'src/engine-prisma-types';

export class GetRevisionQuery {
  constructor(public data: { revisionId: string }) {}
}

export type GetRevisionQueryData = GetRevisionQuery['data'];

export type GetRevisionQueryReturnType = Revision;
