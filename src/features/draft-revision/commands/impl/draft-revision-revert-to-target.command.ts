import type { TargetWritePlan } from 'src/features/draft-revision/commands/impl/target-write-plan';

export type DraftRevisionRevertToTargetCommandData = TargetWritePlan;

export class DraftRevisionRevertToTargetCommand {
  constructor(public readonly data: DraftRevisionRevertToTargetCommandData) {}
}
