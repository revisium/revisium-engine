import type { DraftRevisionState } from 'src/features/draft-revision/commands/impl/draft-revision-write-state.command';

export interface ApplyCandidateFilesCommandData {
  head: { revisionId: string; state: DraftRevisionState };
  draft: { revisionId: string; state: DraftRevisionState };
  cleanupBlobIds: string[];
}

export class ApplyCandidateFilesCommand {
  constructor(public readonly data: ApplyCandidateFilesCommandData) {}
}
