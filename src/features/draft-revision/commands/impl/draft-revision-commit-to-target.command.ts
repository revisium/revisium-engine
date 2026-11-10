import type { CommitTargetWritePlan } from 'src/features/draft-revision/commands/impl/target-write-plan';

export type DraftRevisionCommitToTargetCommandData = CommitTargetWritePlan;

export interface DraftRevisionCommitToTargetCommandReturnType {
  readonly previousHeadRevisionId: string;
  readonly headRevisionId: string;
  readonly draftRevisionId: string;
  // The next Draft's hasChanges, recomputed from its table versions.
  readonly draftHasChanges: boolean;
}

export class DraftRevisionCommitToTargetCommand {
  constructor(public readonly data: DraftRevisionCommitToTargetCommandData) {}
}
