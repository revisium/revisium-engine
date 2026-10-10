import type { DraftChangeLeaf } from 'src/features/draft-changes/reading/leaf-types';
import type {
  DraftChangesConnection,
  DraftChangesPage,
} from 'src/features/draft-changes/reading/pagination-types';

export interface ReadDraftChangedTablesQueryData {
  projectId: string;
  branchName: string;
  page?: DraftChangesPage;
}

export interface DraftChangedTableItem {
  tableId: string;
  previousTableId: string | null;
  changes: string[];
  schemaFieldCount: number;
  changedRowCount: number;
  refs: DraftChangeLeaf[];
}

export type ReadDraftChangedTablesResult =
  DraftChangesConnection<DraftChangedTableItem>;

export class ReadDraftChangedTablesQuery {
  constructor(public readonly data: ReadDraftChangedTablesQueryData) {}
}
