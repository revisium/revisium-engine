import type {
  AppliedCounts,
  ApplyChangesInput,
  UnappliedChanges,
} from 'src/features/partial-changes/commands/impl/apply-changes';

export interface CommitChangesInput extends ApplyChangesInput {
  readonly comment?: string;
}

export interface RenumberedMigration {
  readonly from: string;
  readonly to: string;
}

export interface CommittedDraft extends AppliedCounts {
  readonly status: 'applied';
  readonly previousHeadRevisionId: string;
  readonly headRevisionId: string;
  readonly draftRevisionId: string;
  readonly renumbered: readonly RenumberedMigration[];
}

export type CommitChangesResult = CommittedDraft | UnappliedChanges;

export class CommitDraftChangesCommand {
  constructor(public readonly data: CommitChangesInput) {}
}
