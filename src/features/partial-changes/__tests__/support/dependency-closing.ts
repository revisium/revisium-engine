import type { PartialChangesTestKit } from 'src/__tests__/kit/create-partial-changes-test-kit';
import type { ChangeOperation } from 'src/features/partial-changes/assembly/outcome-rules';
import type { ChangeCatalogue } from 'src/features/partial-changes/catalogue/change-catalogue';
import type { DependencyClosureResult } from 'src/features/partial-changes/closure/dependency-closure';
import type { Estimate } from 'src/features/partial-changes/limits/operation-estimator';
import type { Selection } from 'src/features/partial-changes/selection/selection';
import type { PlanBlocker } from 'src/features/partial-changes/selection/selection-resolution';
import {
  type RequiredUnit,
  type UnitRef,
  unitRefOf,
} from 'src/features/partial-changes/selection/unit-refs';
import type { ChangesBranch } from 'src/features/partial-changes/snapshot/changes-snapshot';
import { readSelectionSource, unitKeyed } from './selection-resolving';
import { readInPlanningTransaction } from './snapshot-reading';

export type ClosureBlockerView = Omit<PlanBlocker, 'unitKey'> & {
  readonly unit?: UnitRef;
};

export interface ClosureView {
  readonly kind: DependencyClosureResult['kind'];
  readonly required: readonly RequiredUnit[];
  readonly blockers: readonly ClosureBlockerView[];
  readonly estimate: Estimate;
}

export function readClosedDependencies(
  kit: PartialChangesTestKit,
  branch: ChangesBranch,
  operation: ChangeOperation,
  selection: Selection,
): Promise<ClosureView> {
  return readInPlanningTransaction(kit, async () => {
    const source = await readSelectionSource(kit, branch, selection);
    const closure = await kit.dependencyClosure.close(source, {
      operation,
      selection,
    });

    return {
      kind: closure.kind,
      required: closure.required,
      blockers: closure.blockers.map((blocker) =>
        closureBlockerView(source.catalogue, blocker),
      ),
      estimate: closure.estimate,
    };
  });
}

function closureBlockerView(
  catalogue: ChangeCatalogue,
  { unitKey, ...blocker }: PlanBlocker,
): ClosureBlockerView {
  if (unitKey === undefined) {
    return blocker;
  }

  return { ...blocker, unit: unitRefOf(unitKeyed(catalogue, unitKey)) };
}
