import type {
  DeferredPath,
  DeferredValues,
} from 'src/features/partial-changes/assembly/target-assembler';
import type { ChangeCatalogue } from 'src/features/partial-changes/catalogue/change-catalogue';
import { compareUnits } from 'src/features/partial-changes/catalogue/unit-order';
import type { CatalogueBlocker } from 'src/features/partial-changes/plan/plan-blocker';
import {
  type DescribedUnitRef,
  describedUnitRefOfKey,
  type RequiredReason,
  requiredReasonOf,
} from 'src/features/partial-changes/selection/unit-refs';

export type PlanBlocker = Omit<CatalogueBlocker, 'unitKey' | 'reason'> & {
  readonly unit?: DescribedUnitRef;
  readonly reason?: RequiredReason;
};

export type { DeferredPath };

export interface DeferredRow {
  readonly unit: DescribedUnitRef;
  readonly omitted: readonly DeferredPath[];
  readonly structure: DescribedUnitRef;
}

export function blockerRefOf(
  catalogue: ChangeCatalogue,
  { unitKey, ...blocker }: CatalogueBlocker,
): PlanBlocker {
  const ref = withRequiredReason(catalogue, blocker);

  if (unitKey === undefined) {
    return ref;
  }

  return { ...ref, unit: describedUnitRefOfKey(catalogue, unitKey) };
}

// In the unit order of their units (SPEC §5.2).
export function deferredRowsOf(
  catalogue: ChangeCatalogue,
  deferred: readonly DeferredValues[],
): DeferredRow[] {
  const { lookup } = catalogue;

  return [...deferred]
    .sort((left, right) =>
      compareUnits(lookup.unit(left.unitKey), lookup.unit(right.unitKey)),
    )
    .map((values) => deferredRowOf(catalogue, values));
}

function deferredRowOf(
  catalogue: ChangeCatalogue,
  { unitKey, omitted, structureKey }: DeferredValues,
): DeferredRow {
  return {
    unit: describedUnitRefOfKey(catalogue, unitKey),
    omitted,
    structure: describedUnitRefOfKey(catalogue, structureKey),
  };
}

function withRequiredReason(
  catalogue: ChangeCatalogue,
  { reason, ...blocker }: Omit<CatalogueBlocker, 'unitKey'>,
): PlanBlocker {
  if (reason === undefined) {
    return blocker;
  }

  return { ...blocker, reason: requiredReasonOf(catalogue, reason) };
}
