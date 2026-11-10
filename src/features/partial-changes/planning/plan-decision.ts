import type {
  CompletePlan,
  StoppedPlan,
} from 'src/features/partial-changes/planning/change-planner';
import { hasUnmatchedSelectors } from 'src/features/partial-changes/selection/selection-resolution';

export const PREVIEW_STATUSES = [
  'ready',
  'required',
  'blocked',
  'empty',
] as const;

export type PreviewStatus = (typeof PREVIEW_STATUSES)[number];

export type PlanStatus = PreviewStatus | 'stale';

type DecidedCompletePlan = Pick<
  CompletePlan,
  | 'planned'
  | 'fingerprint'
  | 'appliedUnits'
  | 'required'
  | 'blockers'
  | 'unmatched'
>;

export type DecidedPlan = DecidedCompletePlan | Pick<StoppedPlan, 'planned'>;

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
  if (!plan.planned) {
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

function isEmpty({ appliedUnits, blockers }: DecidedCompletePlan): boolean {
  return appliedUnits.length === 0 && blockers.length === 0;
}

function isStale(
  { fingerprint }: DecidedCompletePlan,
  { expected }: ApplyTerms,
): boolean {
  return expected !== undefined && expected !== fingerprint;
}

function isBlocked({ blockers, unmatched }: DecidedCompletePlan): boolean {
  return blockers.length > 0 || hasUnmatchedSelectors(unmatched);
}

function awaitsRequiredAdditions(
  { required }: DecidedCompletePlan,
  { includeRequired }: ApplyTerms,
): boolean {
  return required.length > 0 && !includeRequired;
}
