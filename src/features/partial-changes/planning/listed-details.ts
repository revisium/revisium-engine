import type { PlanBlocker } from 'src/features/partial-changes/planning/plan-refs';
import type { RequiredUnit } from 'src/features/partial-changes/selection/unit-refs';

// A result lists at most PARTIAL_CHANGES_MAX_LISTED_DETAILS entries of required and of blockers and counts them all
// (SPEC §5.1). Only the result is cut: the plan behind it keeps every entry, and its decisions and writes read those.
export interface ListedRequired {
  readonly required: readonly RequiredUnit[];
  readonly requiredTotal: number;
}

export interface ListedBlockers {
  readonly blockers: readonly PlanBlocker[];
  readonly blockersTotal: number;
}

export function listedRequiredOf(
  required: readonly RequiredUnit[],
  maxListed: number,
): ListedRequired {
  return {
    required: required.slice(0, maxListed),
    requiredTotal: required.length,
  };
}

export function listedBlockersOf(
  blockers: readonly PlanBlocker[],
  maxListed: number,
): ListedBlockers {
  return {
    blockers: firstOfEachCodeFirst(blockers).slice(0, maxListed),
    blockersTotal: blockers.length,
  };
}

// The first blocker of each code in their order, then the rest in their order: a cut list shows every kind of
// blocker the limit leaves room for.
function firstOfEachCodeFirst(blockers: readonly PlanBlocker[]): PlanBlocker[] {
  const codes = new Set<string>();
  const firsts: PlanBlocker[] = [];
  const repeats: PlanBlocker[] = [];

  for (const blocker of blockers) {
    if (codes.has(blocker.code)) {
      repeats.push(blocker);
    } else {
      codes.add(blocker.code);
      firsts.push(blocker);
    }
  }

  return [...firsts, ...repeats];
}
