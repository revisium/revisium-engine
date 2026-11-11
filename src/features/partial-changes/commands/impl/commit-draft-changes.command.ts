import type {
  AppliedOutcome,
  ApplyChangesInput,
  ApplyResult,
  UnappliedChanges,
} from 'src/features/partial-changes/commands/impl/apply-changes';
import type { MigrationRenumbering } from 'src/features/share/ledger/native-migration-id';

// The repair of the schema ledger reports its renumbering with the same type.
export type { MigrationRenumbering };

export interface CommitChangesInput extends ApplyChangesInput {
  readonly comment?: string | null;
}

export interface CommittedDraft extends ApplyResult, AppliedOutcome {
  readonly status: 'applied';
  readonly previousHeadRevisionId: string;
  readonly headRevisionId: string;
  readonly draftRevisionId: string;
  readonly renumberedMigrations: readonly MigrationRenumbering[];
}

export type CommitChangesResult = CommittedDraft | UnappliedChanges;

export class CommitDraftChangesCommand {
  constructor(public readonly data: CommitChangesInput) {}
}
