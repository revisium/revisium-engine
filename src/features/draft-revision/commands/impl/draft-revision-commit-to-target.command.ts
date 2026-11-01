import type { CommitTargetWritePlan } from 'src/features/draft-revision/commands/impl/target-write-plan';

export type DraftRevisionCommitToTargetCommandData = CommitTargetWritePlan;

export interface DraftRevisionCommitToTargetCommandReturnType {
  readonly previousHeadRevisionId: string;
  readonly headRevisionId: string;
  readonly draftRevisionId: string;
}

export class DraftRevisionCommitToTargetCommand {
  constructor(public readonly data: DraftRevisionCommitToTargetCommandData) {}
}
