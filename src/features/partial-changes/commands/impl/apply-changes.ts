import type { Blocker } from 'src/features/partial-changes/planning/plan-refs';
import type { Selection } from 'src/features/partial-changes/selection/selection';
import type { UnmatchedSelection } from 'src/features/partial-changes/selection/selection-resolution';
import type { RequiredUnit } from 'src/features/partial-changes/selection/unit-refs';
import type { ChangesBranch } from 'src/features/partial-changes/snapshot/changes-snapshot';

export interface ApplyChangesInput {
  readonly branch: ChangesBranch;
  readonly selection: Selection;
  readonly includeRequired?: boolean;
  readonly expected?: string;
}

export interface AppliedCounts {
  readonly applied: { readonly selected: number; readonly required: number };
  readonly remaining: { readonly units: number; readonly unreadTables: number };
}

export interface ChangesRequireAdditions {
  readonly status: 'required';
  readonly required: readonly RequiredUnit[];
}

export interface ChangesBlocked {
  readonly status: 'blocked';
  readonly blockers: readonly Blocker[];
  readonly required: readonly RequiredUnit[];
  readonly unmatched?: UnmatchedSelection;
}

export interface ChangesStale {
  readonly status: 'stale';
}

export interface NothingToApply {
  readonly status: 'empty';
  readonly headRevisionId: string;
  readonly draftRevisionId: string;
  readonly unmatched?: UnmatchedSelection;
}

export type UnappliedChanges =
  | ChangesRequireAdditions
  | ChangesBlocked
  | ChangesStale
  | NothingToApply;
