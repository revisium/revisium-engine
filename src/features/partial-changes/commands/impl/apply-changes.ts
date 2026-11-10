import type { StaleChange } from 'src/features/partial-changes/plan/fingerprint';
import type { PlanCounts } from 'src/features/partial-changes/planning/change-planner';
import type { PlanBlocker } from 'src/features/partial-changes/planning/plan-refs';
import type { SelectionInput } from 'src/features/partial-changes/selection/selection';
import type { UnmatchedSelectors } from 'src/features/partial-changes/selection/selection-resolution';
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

// What an applied operation wrote, and whether its Draft still differs from Head (the writers recompute it from the
// table versions, SPEC §6.13 step 7 and §6.14 step 7).
export interface AppliedOutcome {
  readonly applied: PlanCounts;
  readonly draftHasChanges: boolean;
}

export interface ChangesRequireAdditions extends ApplyResult {
  readonly status: 'required';
  readonly required: readonly RequiredUnit[];
}

export interface PlannedChangesBlocked extends ApplyResult {
  readonly status: 'blocked';
  readonly planned: true;
  readonly blockers: readonly PlanBlocker[];
  readonly required: readonly RequiredUnit[];
  readonly unmatched: UnmatchedSelectors;
}

// A limit stopped the plan: no required additions and no unmatched selectors (SPEC §5.4).
export interface StoppedChangesBlocked extends ApplyResult {
  readonly status: 'blocked';
  readonly planned: false;
  readonly blockers: readonly PlanBlocker[];
  readonly required: readonly [];
}

export type ChangesBlocked = PlannedChangesBlocked | StoppedChangesBlocked;

// The current ids and unmatched selectors, so a caller drops the selectors that no longer match before it previews
// again; no new fingerprint (SPEC §9.2).
export interface ChangesStale extends ApplyResult {
  readonly status: 'stale';
  readonly changed: readonly StaleChange[];
  readonly headRevisionId: string;
  readonly draftRevisionId: string;
  readonly unmatched: UnmatchedSelectors;
}

export interface NothingToApply extends ApplyResult {
  readonly status: 'empty';
  readonly headRevisionId: string;
  readonly draftRevisionId: string;
  readonly unmatched?: UnmatchedSelectors;
}

export type UnappliedChanges =
  | ChangesRequireAdditions
  | ChangesBlocked
  | ChangesStale
  | NothingToApply;
