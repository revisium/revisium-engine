import type {
  AppliedCounts,
  ApplyChangesInput,
  UnappliedChanges,
} from 'src/features/partial-changes/commands/impl/apply-changes';

export type RevertChangesInput = ApplyChangesInput;

export interface RevertedDraft extends AppliedCounts {
  readonly status: 'applied';
  readonly headRevisionId: string;
  readonly draftRevisionId: string;
}

export type RevertChangesResult = RevertedDraft | UnappliedChanges;

export class RevertDraftChangesCommand {
  constructor(public readonly data: RevertChangesInput) {}
}
