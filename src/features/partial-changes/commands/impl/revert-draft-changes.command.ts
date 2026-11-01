import type { Blocker } from 'src/features/partial-changes/planning/plan-refs';
import type { Selection } from 'src/features/partial-changes/selection/selection';
import type { UnmatchedSelection } from 'src/features/partial-changes/selection/selection-resolution';
import type { RequiredUnit } from 'src/features/partial-changes/selection/unit-refs';
import type { ChangesBranch } from 'src/features/partial-changes/snapshot/changes-snapshot';

export interface RevertChangesInput {
  readonly branch: ChangesBranch;
  readonly selection: Selection;
  readonly includeRequired?: boolean;
  readonly expected?: string;
}

export interface RevertedDraft {
  readonly status: 'applied';
  readonly headRevisionId: string;
  readonly draftRevisionId: string;
  readonly applied: { readonly selected: number; readonly required: number };
  readonly remaining: { readonly units: number; readonly unreadTables: number };
}

export interface RevertRequiresAdditions {
  readonly status: 'required';
  readonly required: readonly RequiredUnit[];
}

export interface RevertBlocked {
  readonly status: 'blocked';
  readonly blockers: readonly Blocker[];
  readonly required: readonly RequiredUnit[];
  readonly unmatched?: UnmatchedSelection;
}

export interface RevertStale {
  readonly status: 'stale';
}

export interface NothingToRevert {
  readonly status: 'empty';
  readonly headRevisionId: string;
  readonly draftRevisionId: string;
  readonly unmatched?: UnmatchedSelection;
}

export type RevertChangesResult =
  | RevertedDraft
  | RevertRequiresAdditions
  | RevertBlocked
  | RevertStale
  | NothingToRevert;

export class RevertDraftChangesCommand {
  constructor(public readonly data: RevertChangesInput) {}
}
