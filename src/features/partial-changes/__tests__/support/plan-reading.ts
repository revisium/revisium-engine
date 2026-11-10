import { deepEqual } from '@revisium/schema-toolkit/lib';
import type { PartialChangesTestKit } from 'src/__tests__/kit/create-partial-changes-test-kit';
import type { JsonValue } from 'src/engine-prisma-types';
import type { MergedRow } from 'src/features/partial-changes/assembly/row-merger';
import type { TableViews } from 'src/features/partial-changes/assembly/system-table-targets';
import type { TablePlan } from 'src/features/partial-changes/assembly/target-assembler';
import type { PlanEstimate } from 'src/features/partial-changes/limits/operation-estimator';
import type { ChangeOperation } from 'src/features/partial-changes/plan/change-operation';
import { encodeFingerprint } from 'src/features/partial-changes/plan/fingerprint';
import {
  type ChangePlan,
  ChangePlanner,
  type PlannedTarget,
} from 'src/features/partial-changes/planning/change-planner';
import {
  decidePlanStatus,
  type PreviewStatus,
} from 'src/features/partial-changes/planning/plan-decision';
import type {
  DeferredRow,
  PlanBlocker,
} from 'src/features/partial-changes/planning/plan-refs';
import type { Selection } from 'src/features/partial-changes/selection/selection';
import type { UnmatchedSelectors } from 'src/features/partial-changes/selection/selection-resolution';
import type { RequiredUnit } from 'src/features/partial-changes/selection/unit-refs';
import type {
  ChangesBranch,
  ChangesSnapshot,
} from 'src/features/partial-changes/snapshot/changes-snapshot';
import { compareCodePoints } from 'src/features/share/utils/compare-code-points';
import { type AddressedUnit, addressedUnitOf } from './catalogue-reading';
import { WITHOUT_DEADLINE } from './dependency-closing';
import { readInPlanningTransaction } from './snapshot-reading';
import {
  type SystemTablePlanView,
  systemTablePlanViewOf,
  type TablePlanView,
  tablePlanViewOf,
} from './target-assembling';

const FILE_ID = 'fileId';
const GENERATED = 'generated';

export interface PlannedTableView extends TablePlanView {
  readonly identity: string;
  readonly headId?: string;
  readonly draftId?: string;
}

export interface PlannedTargetView {
  readonly tables: readonly PlannedTableView[];
  readonly systemTables: readonly SystemTablePlanView[];
  readonly views: readonly TableViews[];
}

export interface PlanView {
  readonly status: PreviewStatus;
  readonly fingerprint: string;
  readonly applied: readonly AddressedUnit[];
  readonly selected: number;
  readonly required: readonly RequiredUnit[];
  readonly blockers: readonly PlanBlocker[];
  readonly deferred: readonly DeferredRow[];
  readonly unmatched: UnmatchedSelectors;
  readonly estimate: Omit<PlanEstimate, 'changedRows'>;
  readonly target?: PlannedTargetView;
}

export function readPlan(
  kit: PartialChangesTestKit,
  branch: ChangesBranch,
  operation: ChangeOperation,
  selection: Selection,
): Promise<PlanView> {
  const planner = kit.module.get(ChangePlanner);

  return readInPlanningTransaction(kit, async () => {
    const compared = await planner.readComparedSnapshot({ branch, selection });
    const plan = await planner.plan(
      { operation, selection, compared },
      WITHOUT_DEADLINE,
    );

    return planViewOf(plan);
  });
}

function planViewOf(plan: ChangePlan): PlanView {
  if (!plan.planned) {
    throw new Error('A limit stopped the plan');
  }

  const { mergedRows, perRowWorkRows, mixedTables } = plan.estimate;

  return {
    status: decidePlanStatus(plan, { includeRequired: false }),
    fingerprint: encodeFingerprint(plan.fingerprint),
    applied: plan.appliedUnits.map(addressedUnitOf),
    selected: plan.counts.selected,
    required: plan.required,
    blockers: plan.blockers,
    deferred: plan.deferred,
    unmatched: plan.unmatched,
    estimate: { mergedRows, perRowWorkRows, mixedTables },
    ...plannedTargetOf(plan.target),
  };
}

function plannedTargetOf(planned: PlannedTarget): Pick<PlanView, 'target'> {
  const { source, assembled } = planned;
  const { snapshot } = source;

  return {
    target: {
      tables: assembled.tables
        .map((plan) => plannedTableOf(snapshot, plan))
        .sort((left, right) =>
          compareCodePoints(left.identity, right.identity),
        ),
      systemTables: assembled.systemTables.map((plan) =>
        systemTablePlanViewOf(snapshot, plan),
      ),
      views: assembled.views,
    },
  };
}

function plannedTableOf(
  snapshot: ChangesSnapshot,
  plan: TablePlan,
): PlannedTableView {
  const pair = snapshot.tables.find(
    ({ identity }) => identity === plan.identity,
  );
  const view = tablePlanViewOf(snapshot, plan);

  return {
    ...view,
    identity: plan.identity,
    headId: pair?.head?.id,
    draftId: pair?.draft?.id,
    newRows: view.newRows.map(withGeneratedFileIdsMasked),
  };
}

// A row moved into a structure with a file field that it lacks gets a new file id from every plan, as a native
// migration gives one, so plans compare the rest of such a row.
function withGeneratedFileIdsMasked(row: MergedRow): MergedRow {
  const data = withFileIdsMasked(row.data);

  if (deepEqual(data, row.data)) {
    return row;
  }

  return { ...row, data, hash: GENERATED };
}

function withFileIdsMasked(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(withFileIdsMasked);
  }

  if (value === null || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      key === FILE_ID ? GENERATED : withFileIdsMasked(child ?? null),
    ]),
  );
}
