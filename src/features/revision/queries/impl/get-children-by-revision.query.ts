import { Revision } from 'src/__generated__/client';

export class GetChildrenByRevisionQuery {
  constructor(public revisionId: string) {}
}

export type GetChildrenByRevisionQueryData =
  GetChildrenByRevisionQuery['revisionId'];

export type GetChildrenByRevisionQueryReturnType = Revision[];
