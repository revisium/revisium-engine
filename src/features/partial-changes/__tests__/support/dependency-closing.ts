import type { PartialChangesTestKit } from 'src/__tests__/kit/create-partial-changes-test-kit';
import type { AssembledTarget } from 'src/features/partial-changes/assembly/target-assembler';
import type { ChangeCatalogue } from 'src/features/partial-changes/catalogue/change-catalogue';
import type {
  ClosureSource,
  DependencyClosureResult,
} from 'src/features/partial-changes/closure/dependency-closure';
import type { Estimate } from 'src/features/partial-changes/limits/operation-estimator';
import type {
  AppliedUnits,
  ChangeOperation,
} from 'src/features/partial-changes/plan/change-operation';
import type { PlanBlocker } from 'src/features/partial-changes/plan/plan-blocker';
import {
  isWholeDraftSelection,
  type ItemKind,
  type Selection,
  type SelectionItems,
} from 'src/features/partial-changes/selection/selection';
import {
  type RequiredUnit,
  type UnitRef,
  unitRefOf,
} from 'src/features/partial-changes/selection/unit-refs';
import type { ChangesBranch } from 'src/features/partial-changes/snapshot/changes-snapshot';
import type { ComparedSnapshot } from 'src/features/partial-changes/snapshot/compared-snapshot-reader.service';
import type { DeadlineHandle } from 'src/infrastructure/database/operation-deadline';
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

export interface ClosedPlan {
  readonly source: ComparedSnapshot & ClosureSource;
  readonly choice: AppliedUnits;
  readonly target: AssembledTarget;
}

export const WITHOUT_DEADLINE: DeadlineHandle = {
  checkpoint: () => Promise.resolve(),
};

export function readClosedDependencies(
  kit: PartialChangesTestKit,
  branch: ChangesBranch,
  operation: ChangeOperation,
  selection: Selection,
): Promise<ClosureView> {
  return readInPlanningTransaction(kit, async () => {
    const source = await readSelectionSource(kit, branch, selection);
    const closure = await kit.dependencyClosure.close(
      source,
      { operation, selection },
      WITHOUT_DEADLINE,
    );

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

export async function closedPlanOf(
  kit: PartialChangesTestKit,
  branch: ChangesBranch,
  operation: ChangeOperation,
  selection: Selection,
): Promise<ClosedPlan> {
  const source = await readSelectionSource(kit, branch, selection);
  const closure = await kit.dependencyClosure.close(
    source,
    { operation, selection },
    WITHOUT_DEADLINE,
  );

  if (closure.kind !== 'closed') {
    throw new Error('The closure was refused as too large');
  }

  return {
    source,
    choice: {
      operation,
      applied: closure.applied,
      wholeDraft: isWholeDraftSelection(selection),
    },
    target: closure.target,
  };
}

export function withSelectorsOf(
  selection: Selection,
  required: readonly RequiredUnit[],
): Selection {
  return required.reduce<Selection>(
    (merged, { unit }) => withItems(merged, unit.selector),
    selection,
  );
}

export function unionOfSelections(
  selections: readonly SelectionItems[],
): Selection {
  return selections.reduce<Selection>(withItems, {});
}

function withItems(selection: Selection, items: SelectionItems): Selection {
  const merged: Record<string, unknown[]> = {};

  for (const [kind, selectors] of Object.entries(items)) {
    merged[kind] = [
      ...(selection[kind as ItemKind] ?? []),
      ...(selectors as unknown[]),
    ];
  }

  return { ...selection, ...merged };
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
