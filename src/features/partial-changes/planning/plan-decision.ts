import type { ChangePlan } from 'src/features/partial-changes/planning/change-planner';
import type { UnmatchedSelection } from 'src/features/partial-changes/selection/selection-resolution';

export type PlanStatus = 'ready' | 'required' | 'blocked' | 'stale' | 'empty';

export type PreviewStatus = Exclude<PlanStatus, 'stale'>;

export type DecidedPlan = Pick<
  ChangePlan,
  | 'refusedByLimit'
  | 'fingerprint'
  | 'appliedUnits'
  | 'required'
  | 'blockers'
  | 'unmatched'
>;

export interface PreviewTerms {
  readonly includeRequired: boolean;
  readonly expected?: never;
}

export interface ApplyTerms {
  readonly includeRequired: boolean;
  readonly expected?: string;
}

export function decidePlanStatus(
  plan: DecidedPlan,
  terms: PreviewTerms,
): PreviewStatus;
export function decidePlanStatus(
  plan: DecidedPlan,
  terms: ApplyTerms,
): PlanStatus;
export function decidePlanStatus(
  plan: DecidedPlan,
  terms: ApplyTerms,
): PlanStatus {
  if (plan.refusedByLimit) {
    return 'blocked';
  }

  if (isEmpty(plan)) {
    return 'empty';
  }

  if (isStale(plan, terms)) {
    return 'stale';
  }

  if (isBlocked(plan)) {
    return 'blocked';
  }

  if (awaitsRequiredAdditions(plan, terms)) {
    return 'required';
  }

  return 'ready';
}

function isEmpty({ appliedUnits, blockers }: DecidedPlan): boolean {
  return appliedUnits.length === 0 && blockers.length === 0;
}

function isStale(
  { fingerprint }: DecidedPlan,
  { expected }: ApplyTerms,
): boolean {
  return expected !== undefined && expected !== fingerprint;
}

function isBlocked({ blockers, unmatched }: DecidedPlan): boolean {
  return blockers.length > 0 || hasSelectors(unmatched);
}

function awaitsRequiredAdditions(
  { required }: DecidedPlan,
  { includeRequired }: ApplyTerms,
): boolean {
  return required.length > 0 && !includeRequired;
}

function hasSelectors(unmatched: UnmatchedSelection): boolean {
  return Object.keys(unmatched).length > 0;
}
