import type { RefusedTable } from 'src/features/partial-changes/head-schema/head-schema-check';
import type { PlanEstimate } from 'src/features/partial-changes/limits/operation-estimator';
import type { ChangeOperation } from 'src/features/partial-changes/plan/change-operation';
import type { PlanCounts } from 'src/features/partial-changes/planning/change-planner';
import type {
  PlanRowCounts,
  TableCoverage,
} from 'src/features/partial-changes/planning/plan-coverage';
import type { PlanLimits } from 'src/features/partial-changes/limits/partial-changes-limits';
import type { PreviewStatus } from 'src/features/partial-changes/planning/plan-decision';
import type {
  PlanBlocker,
  DeferredRow,
} from 'src/features/partial-changes/planning/plan-refs';
import type { SelectionInput } from 'src/features/partial-changes/selection/selection';
import type { UnmatchedSelectors } from 'src/features/partial-changes/selection/selection-resolution';
import type { RequiredUnit } from 'src/features/partial-changes/selection/unit-refs';
import type { ChangesBranch } from 'src/features/partial-changes/snapshot/changes-snapshot';

export interface PreviewChangesInput {
  readonly branch: ChangesBranch;
  readonly operation: ChangeOperation;
  readonly selection: SelectionInput;
  readonly includeRequired?: boolean | null;
}

export interface PreviewBase {
  // When the preview started reading, by the application clock. A display hint for a stale result's places, not a
  // freshness check: rows created natively or by an operation carry the database clock (SPEC §9.2).
  readonly plannedAt: Date;
  readonly headRevisionId: string;
  readonly draftRevisionId: string;
  readonly refusedTables: readonly RefusedTable[];
  // At most PARTIAL_CHANGES_MAX_LISTED_DETAILS blockers; blockersTotal counts them all (SPEC §5.1).
  readonly blockers: readonly PlanBlocker[];
  readonly blockersTotal: number;
  readonly estimate: PlanEstimate;
  readonly limits: PlanLimits;
}

export interface PlannedPreview extends PreviewBase {
  readonly status: PreviewStatus;
  readonly planned: true;
  readonly fingerprint: string;
  readonly counts: PlanCounts;
  readonly rowCounts: PlanRowCounts;
  readonly coverage: readonly TableCoverage[];
  // At most PARTIAL_CHANGES_MAX_LISTED_DETAILS entries; requiredTotal counts them all, as counts.required does.
  readonly required: readonly RequiredUnit[];
  readonly requiredTotal: number;
  readonly deferred: readonly DeferredRow[];
  readonly unmatched: UnmatchedSelectors;
  // Only with status empty: the Draft's stored hasChanges. True for exactly { all: true } means that applying it links
  // the Head versions of the content-equal Draft table versions (SPEC §3.8).
  readonly draftHasChanges?: boolean;
}

// A preview a limit stopped returns no value of the plan (SPEC §5.3).
export interface StoppedPreview extends PreviewBase {
  readonly status: 'blocked';
  readonly planned: false;
  readonly fingerprint: null;
  readonly counts: null;
  readonly rowCounts: null;
  readonly coverage: readonly [];
  readonly required: readonly [];
  readonly requiredTotal: 0;
  readonly deferred: readonly [];
  readonly unmatched: null;
}

export type PreviewChangesResult = PlannedPreview | StoppedPreview;

export class PreviewDraftChangesQuery {
  constructor(public readonly data: PreviewChangesInput) {}
}
