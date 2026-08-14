import type { Branch, Revision, Row, Table } from 'src/engine-prisma-types';
import type { IPaginatedType } from 'src/features/share/pagination.interface';

export type RowStateIntroductionType = 'created' | 'modified' | 'renamed';

export type PreviousRowStateNode = {
  readonly row: Row;
  readonly table: Table;
  readonly revision: Revision;
  readonly branch: Branch;
  readonly introducedBy: readonly RowStateIntroductionType[];
};

export class GetPreviousRowStatesQuery {
  constructor(
    public readonly data: {
      readonly revisionId: string;
      readonly tableId: string;
      readonly rowId: string;
      readonly first: number;
      readonly after?: string;
    },
  ) {}
}

export type GetPreviousRowStatesQueryData = GetPreviousRowStatesQuery['data'];

export type GetPreviousRowStatesQueryReturnType =
  IPaginatedType<PreviousRowStateNode> | null;
