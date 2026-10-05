import type { DraftChangeLeaf } from 'src/features/draft-changes/reading/leaf-types';
import type { DraftChangesPage } from 'src/features/draft-changes/reading/pagination-types';

export interface ReadDraftRowChangesQueryData {
  projectId: string;
  branchName: string;
  tableId: string;
  rowId: string;
  page?: DraftChangesPage;
}

export interface ReadDraftRowChangesResult {
  tableId: string;
  rowId: string;
  changes: DraftChangeLeaf[];
  totalCount: number;
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

export class ReadDraftRowChangesQuery {
  constructor(public readonly data: ReadDraftRowChangesQueryData) {}
}
