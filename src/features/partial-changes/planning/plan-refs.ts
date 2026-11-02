import type { DeferredValues } from 'src/features/partial-changes/assembly/target-assembler';
import type { CatalogueLookup } from 'src/features/partial-changes/catalogue/catalogue-lookup';
import type { PlanBlocker } from 'src/features/partial-changes/plan/plan-blocker';
import {
  type UnitRef,
  unitRefOf,
} from 'src/features/partial-changes/selection/unit-refs';

export type Blocker = Omit<PlanBlocker, 'unitKey'> & {
  readonly unit?: UnitRef;
};

export interface Deferred {
  readonly unit: UnitRef;
  readonly paths: readonly string[];
  readonly structure: UnitRef;
}

export function blockerRefOf(
  lookup: CatalogueLookup,
  { unitKey, ...blocker }: PlanBlocker,
): Blocker {
  if (unitKey === undefined) {
    return blocker;
  }

  return { ...blocker, unit: unitRefOf(lookup.unit(unitKey)) };
}

export function deferredRefOf(
  lookup: CatalogueLookup,
  { unitKey, paths, structureKey }: DeferredValues,
): Deferred {
  return {
    unit: unitRefOf(lookup.unit(unitKey)),
    paths,
    structure: unitRefOf(lookup.unit(structureKey)),
  };
}
