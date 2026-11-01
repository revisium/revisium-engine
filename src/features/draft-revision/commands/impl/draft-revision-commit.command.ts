export interface DraftRevisionCommitCommandData {
  branchId: string;
  comment?: string;
}

/**
 * Historical names, kept because the public createRevision result repeats them.
 * The target commit returns the same ids under the SPEC §5.4 names:
 * headRevisionId = previousDraftRevisionId, draftRevisionId = nextDraftRevisionId.
 */
export interface DraftRevisionCommitCommandReturnType {
  previousHeadRevisionId: string;
  previousDraftRevisionId: string;
  nextDraftRevisionId: string;
}

export class DraftRevisionCommitCommand {
  constructor(public readonly data: DraftRevisionCommitCommandData) {}
}
