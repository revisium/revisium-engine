import type { RefusedTable } from 'src/features/partial-changes/head-schema/head-schema-check';
import type { PlanEstimate } from 'src/features/partial-changes/limits/operation-estimator';
import type { ChangeOperation } from 'src/features/partial-changes/plan/change-operation';
import type { PlanCounts } from 'src/features/partial-changes/planning/change-planner';
import type { TableCoverage } from 'src/features/partial-changes/planning/plan-coverage';
import type { PreviewStatus } from 'src/features/partial-changes/planning/plan-decision';
import type {
  PlanBlocker,
  DeferredRow,
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

export interface PreviewBase {
  readonly headRevisionId: string;
  readonly draftRevisionId: string;
  readonly refusedTables: readonly RefusedTable[];
  // At most PARTIAL_CHANGES_MAX_LISTED_DETAILS blockers; blockersTotal counts them all (SPEC §5.1).
  readonly blockers: readonly PlanBlocker[];
  readonly blockersTotal: number;
  readonly estimate: PlanEstimate;
}

export interface PlannedPreview extends PreviewBase {
  readonly status: PreviewStatus;
  readonly planned: true;
  readonly fingerprint: string;
  readonly counts: PlanCounts;
  readonly coverage: readonly TableCoverage[];
  // At most PARTIAL_CHANGES_MAX_LISTED_DETAILS entries; requiredTotal counts them all, as counts.required does.
  readonly required: readonly RequiredUnit[];
  readonly requiredTotal: number;
  readonly deferred: readonly DeferredRow[];
  readonly sample: readonly DescribedUnitRef[];
  readonly unmatched: UnmatchedSelectors;
}

// A preview a limit stopped returns no value of the plan (SPEC §5.3).
export interface StoppedPreview extends PreviewBase {
  readonly status: 'blocked';
  readonly planned: false;
  readonly fingerprint: null;
  readonly counts: null;
  readonly coverage: readonly [];
  readonly required: readonly [];
  readonly requiredTotal: 0;
  readonly deferred: readonly [];
  readonly sample: readonly [];
  readonly unmatched: null;
}

export type PreviewChangesResult = PlannedPreview | StoppedPreview;

export class PreviewDraftChangesQuery {
  constructor(public readonly data: PreviewChangesInput) {}
}
