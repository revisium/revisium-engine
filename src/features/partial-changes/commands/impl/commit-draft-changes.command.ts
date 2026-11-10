import type {
  AppliedOutcome,
  ApplyChangesInput,
  ApplyResult,
  UnappliedChanges,
} from 'src/features/partial-changes/commands/impl/apply-changes';

export interface CommitChangesInput extends ApplyChangesInput {
  readonly comment?: string | null;
}

export interface RenumberedMigration {
  readonly from: string;
  readonly to: string;
}

export interface CommittedDraft extends ApplyResult, AppliedOutcome {
  readonly status: 'applied';
  readonly previousHeadRevisionId: string;
  readonly headRevisionId: string;
  readonly draftRevisionId: string;
  readonly renumberedMigrations: readonly RenumberedMigration[];
}

export type CommitChangesResult = CommittedDraft | UnappliedChanges;

export class CommitDraftChangesCommand {
  constructor(public readonly data: CommitChangesInput) {}
}
