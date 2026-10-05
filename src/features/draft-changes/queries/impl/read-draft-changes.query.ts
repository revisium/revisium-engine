export interface ReadDraftChangesQueryData {
  projectId: string;
  branchName: string;
}

export interface ReadDraftChangesResult {
  isEmpty: boolean;
  counts: { tables: number; rows: number; fields: number };
}

export class ReadDraftChangesQuery {
  constructor(public readonly data: ReadDraftChangesQueryData) {}
}
