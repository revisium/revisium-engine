import type { DeferredValues } from 'src/features/partial-changes/assembly/target-assembler';
import type { CatalogueUnit } from 'src/features/partial-changes/catalogue/catalogue-unit';
import type { ChangeCatalogue } from 'src/features/partial-changes/catalogue/change-catalogue';
import type { CatalogueBlocker } from 'src/features/partial-changes/plan/plan-blocker';
import {
  type DescribedUnitRef,
  describedUnitRefOf,
  describedUnitRefOfKey,
  type RequiredReason,
  requiredReasonOf,
} from 'src/features/partial-changes/selection/unit-refs';

export type PlanBlocker = Omit<CatalogueBlocker, 'unitKey' | 'reason'> & {
  readonly unit?: DescribedUnitRef;
  readonly reason?: RequiredReason;
};

export interface Deferred {
  readonly unit: DescribedUnitRef;
  readonly paths: readonly string[];
  readonly structure: DescribedUnitRef;
}

const SAMPLE_SIZE = 20;

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

export function deferredRefOf(
  catalogue: ChangeCatalogue,
  { unitKey, paths, structureKey }: DeferredValues,
): Deferred {
  return {
    unit: describedUnitRefOfKey(catalogue, unitKey),
    paths,
    structure: describedUnitRefOfKey(catalogue, structureKey),
  };
}

export function sampleOf(
  { tables }: ChangeCatalogue,
  appliedUnits: readonly CatalogueUnit[],
): DescribedUnitRef[] {
  return appliedUnits
    .slice(0, SAMPLE_SIZE)
    .map((unit) => describedUnitRefOf(unit, tables));
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
