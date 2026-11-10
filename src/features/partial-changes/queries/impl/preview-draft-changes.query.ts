import type { RefusedTable } from 'src/features/partial-changes/head-schema/head-schema-check';
import type { PlanEstimate } from 'src/features/partial-changes/limits/operation-estimator';
import type { ChangeOperation } from 'src/features/partial-changes/plan/change-operation';
import type { PlanCounts } from 'src/features/partial-changes/planning/change-planner';
import type { PreviewStatus } from 'src/features/partial-changes/planning/plan-decision';
import type {
  PlanBlocker,
  Deferred,
} from 'src/features/partial-changes/planning/plan-refs';
import type { SelectionInput } from 'src/features/partial-changes/selection/selection';
import type { UnmatchedSelectors } from 'src/features/partial-changes/selection/selection-resolution';
import type {
  DescribedUnitRef,
  RequiredUnit,
} from 'src/features/partial-changes/selection/unit-refs';
import type { ChangesBranch } from 'src/features/partial-changes/snapshot/changes-snapshot';

export interface PreviewChangesInput {
  readonly branch: ChangesBranch;
  readonly operation: ChangeOperation;
  readonly selection: SelectionInput;
  readonly includeRequired?: boolean | null;
}

export interface PreviewChangesResult {
  readonly status: PreviewStatus;
  readonly headRevisionId: string;
  readonly draftRevisionId: string;
  readonly fingerprint: string;
  readonly counts: PlanCounts;
  readonly unreadTables: number;
  readonly refusedTables: readonly RefusedTable[];
  readonly required: readonly RequiredUnit[];
  readonly blockers: readonly PlanBlocker[];
  readonly deferred: readonly Deferred[];
  readonly sample: readonly DescribedUnitRef[];
  readonly unmatched: UnmatchedSelectors;
  readonly estimate: PlanEstimate;
}

export class PreviewDraftChangesQuery {
  constructor(public readonly data: PreviewChangesInput) {}
}
