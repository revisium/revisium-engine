import type { TargetWritePlan } from 'src/features/draft-revision/commands/impl/target-write-plan';

export type DraftRevisionRevertToTargetCommandData = TargetWritePlan;

export interface DraftRevisionRevertToTargetCommandReturnType {
  readonly draftRevisionId: string;
  // The Draft's hasChanges, recomputed from its table versions.
  readonly draftHasChanges: boolean;
  // The tables whose Draft link the write changed.
  readonly relinkedTables: number;
}

export class DraftRevisionRevertToTargetCommand {
  constructor(public readonly data: DraftRevisionRevertToTargetCommandData) {}
}
