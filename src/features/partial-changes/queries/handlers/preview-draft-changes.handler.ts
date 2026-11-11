import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import type { MigrationLockedDetails } from 'src/features/migration/exceptions/migration-locked.exception';
import { MigrationLockService } from 'src/features/migration/services/migration-lock.service';
import { PartialChangesLimits } from 'src/features/partial-changes/limits/partial-changes-limits';
import {
  partialOperation,
  plannedFieldsOf,
} from 'src/features/partial-changes/logging/partial-operation-fields';
import type { ChangeOperation } from 'src/features/partial-changes/plan/change-operation';
import { encodeFingerprint } from 'src/features/partial-changes/plan/fingerprint';
import {
  type ChangePlan,
  ChangePlanner,
} from 'src/features/partial-changes/planning/change-planner';
import {
  listedBlockersOf,
  listedRequiredOf,
} from 'src/features/partial-changes/planning/listed-details';
import {
  decidePlanStatus,
  type PreviewStatus,
} from 'src/features/partial-changes/planning/plan-decision';
import type { PlanBlocker } from 'src/features/partial-changes/planning/plan-refs';
import {
  type PreviewChangesInput,
  type PreviewChangesResult,
  PreviewDraftChangesQuery,
} from 'src/features/partial-changes/queries/impl/preview-draft-changes.query';
import type { Selection } from 'src/features/partial-changes/selection/selection';
import {
  validateIncludeRequired,
  validateOperation,
  validateSelection,
} from 'src/features/partial-changes/selection/selection-validator';
import type {
  ChangesBranch,
  ChangesSnapshot,
} from 'src/features/partial-changes/snapshot/changes-snapshot';
import type { DeadlineHandle } from 'src/infrastructure/database/operation-deadline';
import {
  OperationLog,
  type OperationTrace,
} from 'src/infrastructure/database/operation-log';
import { OperationTransactionRunner } from 'src/infrastructure/database/operation-transaction-runner';

interface PreviewRequest {
  readonly branch: ChangesBranch;
  readonly operation: ChangeOperation;
  readonly selection: Selection;
  readonly includeRequired: boolean;
}

@QueryHandler(PreviewDraftChangesQuery)
export class PreviewDraftChangesHandler implements IQueryHandler<
  PreviewDraftChangesQuery,
  PreviewChangesResult
> {
  constructor(
    private readonly transactionRunner: OperationTransactionRunner,
    private readonly migrationLock: MigrationLockService,
    private readonly planner: ChangePlanner,
    private readonly operationLog: OperationLog,
    private readonly limits: PartialChangesLimits,
  ) {}

  public execute({
    data,
  }: PreviewDraftChangesQuery): Promise<PreviewChangesResult> {
    return this.operationLog.track(
      partialOperation('preview', data.branch),
      (trace) => {
        const request = previewRequestOf(data);

        return this.transactionRunner.runPlanning(
          (deadline) => this.preview(request, deadline, trace),
          trace,
        );
      },
    );
  }

  private async preview(
    request: PreviewRequest,
    deadline: DeadlineHandle,
    trace: OperationTrace,
  ): Promise<PreviewChangesResult> {
    const compared = await this.planner.readComparedSnapshot(request);
    const migrationBlockers = await this.readMigrationLock(compared.snapshot);
    const plan = await this.planner.plan({ ...request, compared }, deadline);
    const preview = {
      ...plan,
      blockers: [...migrationBlockers, ...plan.blockers],
    };
    trace.planned(() => plannedFieldsOf(preview));

    return previewResultOf(
      preview,
      decidePlanStatus(preview, request),
      this.limits.maxListedDetails,
    );
  }

  private async readMigrationLock({
    draftRevisionId,
  }: ChangesSnapshot): Promise<PlanBlocker[]> {
    const lock = await this.migrationLock.findRevisionLock(draftRevisionId);

    if (!lock) {
      return [];
    }

    return [migrationInProgress(lock)];
  }
}

function previewRequestOf({
  branch,
  operation,
  selection,
  includeRequired,
}: PreviewChangesInput): PreviewRequest {
  return {
    branch,
    operation: validateOperation(operation),
    selection: validateSelection(selection),
    includeRequired: validateIncludeRequired(includeRequired),
  };
}

function migrationInProgress({ tableId }: MigrationLockedDetails): PlanBlocker {
  return {
    code: 'migrationInProgress',
    tableId,
    message: `An async migration of ${tableId} is active on the branch; wait for it to end`,
  };
}

// The status and every other field come from the whole plan; only the listed details are cut (SPEC §5.1).
function previewResultOf(
  plan: ChangePlan,
  status: PreviewStatus,
  maxListedDetails: number,
): PreviewChangesResult {
  const base = {
    headRevisionId: plan.headRevisionId,
    draftRevisionId: plan.draftRevisionId,
    refusedTables: plan.refusedTables,
    ...listedBlockersOf(plan.blockers, maxListedDetails),
    estimate: plan.estimate,
  };

  if (!plan.planned) {
    return {
      ...base,
      status: 'blocked',
      planned: false,
      fingerprint: null,
      counts: null,
      coverage: [],
      required: [],
      requiredTotal: 0,
      deferred: [],
      sample: [],
      unmatched: null,
    };
  }

  return {
    ...base,
    status,
    planned: true,
    fingerprint: encodeFingerprint(plan.fingerprint),
    counts: plan.counts,
    coverage: plan.coverage,
    ...listedRequiredOf(plan.required, maxListedDetails),
    deferred: plan.deferred,
    sample: plan.sample,
    unmatched: plan.unmatched,
  };
}
