import {
  type ExpectedFingerprint,
  type StaleChange,
  staleChangesOf,
} from 'src/features/partial-changes/plan/fingerprint';
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
  readonly expected?: ExpectedFingerprint;
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

// What changed since the preview that expected is the fingerprint of (SPEC §9.2); nothing without expected.
export function changesSincePreview(
  { fingerprint }: Pick<CompletePlan, 'fingerprint'>,
  { expected }: ApplyTerms,
): StaleChange[] {
  if (expected === undefined) {
    return [];
  }

  return staleChangesOf(expected, fingerprint);
}

function isEmpty({ appliedUnits, blockers }: DecidedCompletePlan): boolean {
  return appliedUnits.length === 0 && blockers.length === 0;
}

function isStale(plan: DecidedCompletePlan, terms: ApplyTerms): boolean {
  return changesSincePreview(plan, terms).length > 0;
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
