import type { DraftChangeLeaf } from 'src/features/draft-changes/reading/leaf-types';

export interface ReadDraftTableChangesQueryData {
  projectId: string;
  branchName: string;
  tableId: string;
}

export interface ReadDraftTableChangesResult {
  tableId: string;
  schemaChanges: DraftChangeLeaf[];
  viewsChanges?: DraftChangeLeaf[];
  rowCount: number;
}

export class ReadDraftTableChangesQuery {
  constructor(public readonly data: ReadDraftTableChangesQueryData) {}
}
