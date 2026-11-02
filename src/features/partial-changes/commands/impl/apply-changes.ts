import type { Blocker } from 'src/features/partial-changes/planning/plan-refs';
import type { SelectionInput } from 'src/features/partial-changes/selection/selection';
import type { UnmatchedSelection } from 'src/features/partial-changes/selection/selection-resolution';
import type { RequiredUnit } from 'src/features/partial-changes/selection/unit-refs';
import type { ChangesBranch } from 'src/features/partial-changes/snapshot/changes-snapshot';

export interface ApplyChangesInput {
  readonly branch: ChangesBranch;
  readonly selection: SelectionInput;
  readonly includeRequired?: boolean | null;
  readonly expected?: string | null;
}

export const APPLY_STATUSES = [
  'applied',
  'required',
  'blocked',
  'stale',
  'empty',
] as const;

export type ApplyStatus = (typeof APPLY_STATUSES)[number];

export interface ApplyResult {
  readonly status: ApplyStatus;
}

export interface AppliedCounts {
  readonly applied: { readonly selected: number; readonly required: number };
  readonly remaining: { readonly units: number; readonly unreadTables: number };
}

export interface ChangesRequireAdditions extends ApplyResult {
  readonly status: 'required';
  readonly required: readonly RequiredUnit[];
}

export interface ChangesBlocked extends ApplyResult {
  readonly status: 'blocked';
  readonly blockers: readonly Blocker[];
  readonly required: readonly RequiredUnit[];
  readonly unmatched?: UnmatchedSelection;
}

export interface ChangesStale extends ApplyResult {
  readonly status: 'stale';
}

export interface NothingToApply extends ApplyResult {
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
