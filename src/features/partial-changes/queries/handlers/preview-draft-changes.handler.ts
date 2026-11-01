import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import type { MigrationLockedDetails } from 'src/features/migration/exceptions/migration-locked.exception';
import { MigrationLockService } from 'src/features/migration/services/migration-lock.service';
import type { ChangeOperation } from 'src/features/partial-changes/assembly/outcome-rules';
import {
  type ChangePlan,
  ChangePlanner,
} from 'src/features/partial-changes/planning/change-planner';
import {
  decidePlanStatus,
  type PreviewStatus,
} from 'src/features/partial-changes/planning/plan-decision';
import type { Blocker } from 'src/features/partial-changes/planning/plan-refs';
import {
  type PreviewChangesInput,
  type PreviewChangesResult,
  PreviewDraftChangesQuery,
} from 'src/features/partial-changes/queries/impl/preview-draft-changes.query';
import type { Selection } from 'src/features/partial-changes/selection/selection';
import {
  validateOperation,
  validateSelection,
} from 'src/features/partial-changes/selection/selection-validator';
import { unitRefOf } from 'src/features/partial-changes/selection/unit-refs';
import type {
  ChangesBranch,
  ChangesSnapshot,
} from 'src/features/partial-changes/snapshot/changes-snapshot';
import type { DeadlineHandle } from 'src/infrastructure/database/operation-deadline';
import { OperationTransactionRunner } from 'src/infrastructure/database/operation-transaction-runner';

interface PreviewRequest {
  readonly branch: ChangesBranch;
  readonly operation: ChangeOperation;
  readonly selection: Selection;
  readonly includeRequired: boolean;
}

const SAMPLE_SIZE = 20;

@QueryHandler(PreviewDraftChangesQuery)
export class PreviewDraftChangesHandler implements IQueryHandler<
  PreviewDraftChangesQuery,
  PreviewChangesResult
> {
  constructor(
    private readonly transactionRunner: OperationTransactionRunner,
    private readonly migrationLock: MigrationLockService,
    private readonly planner: ChangePlanner,
  ) {}

  public execute({
    data,
  }: PreviewDraftChangesQuery): Promise<PreviewChangesResult> {
    const request = previewRequestOf(data);

    return this.transactionRunner.runPlanning((deadline) =>
      this.preview(request, deadline),
    );
  }

  private async preview(
    request: PreviewRequest,
    deadline: DeadlineHandle,
  ): Promise<PreviewChangesResult> {
    const compared = await this.planner.readComparedSnapshot(request);
    const migrationBlockers = await this.readMigrationLock(compared.snapshot);
    const plan = await this.planner.plan({ ...request, compared }, deadline);
    const preview = {
      ...plan,
      blockers: [...migrationBlockers, ...plan.blockers],
    };

    return previewResultOf(preview, decidePlanStatus(preview, request));
  }

  private async readMigrationLock({
    draftRevisionId,
  }: ChangesSnapshot): Promise<Blocker[]> {
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
  includeRequired = false,
}: PreviewChangesInput): PreviewRequest {
  return {
    branch,
    operation: validateOperation(operation),
    selection: validateSelection(selection),
    includeRequired,
  };
}

function migrationInProgress({ tableId }: MigrationLockedDetails): Blocker {
  return {
    code: 'migrationInProgress',
    tableId,
    message: `An async migration of ${tableId} is active on the branch; wait for it to end`,
  };
}

function previewResultOf(
  plan: ChangePlan,
  status: PreviewStatus,
): PreviewChangesResult {
  return {
    status,
    headRevisionId: plan.headRevisionId,
    draftRevisionId: plan.draftRevisionId,
    fingerprint: plan.fingerprint,
    counts: plan.counts,
    unreadTables: plan.unreadTables,
    refusedTables: plan.refusedTables,
    required: plan.required,
    blockers: plan.blockers,
    deferred: plan.deferred,
    sample: plan.appliedUnits.slice(0, SAMPLE_SIZE).map(unitRefOf),
    unmatched: plan.unmatched,
    estimate: plan.estimate,
  };
}
