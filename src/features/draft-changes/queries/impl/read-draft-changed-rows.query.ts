import type { DraftChangeLeaf } from 'src/features/draft-changes/reading/leaf-types';
import type {
  DraftChangesConnection,
  DraftChangesPage,
} from 'src/features/draft-changes/reading/pagination-types';

export interface ReadDraftChangedRowsQueryData {
  projectId: string;
  branchName: string;
  tableId: string;
  page?: DraftChangesPage;
}

export interface DraftChangedRowItem {
  tableId: string;
  rowId: string;
  previousRowId: string | null;
  changes: string[];
  changedFieldCount: number;
  hasMoreChanges: boolean;
  refs: DraftChangeLeaf[];
}

export type ReadDraftChangedRowsResult =
  DraftChangesConnection<DraftChangedRowItem>;

export class ReadDraftChangedRowsQuery {
  constructor(public readonly data: ReadDraftChangedRowsQueryData) {}
}
