import { Injectable } from '@nestjs/common';
import { DraftWriteAdmissionService } from 'src/features/draft/draft-write-admission.service';
import type { ChangeOperation } from 'src/features/partial-changes/assembly/outcome-rules';
import type {
  AppliedCounts,
  ApplyChangesInput,
  UnappliedChanges,
} from 'src/features/partial-changes/commands/impl/apply-changes';
import {
  type ChangePlan,
  ChangePlanner,
  type PlannedTarget,
} from 'src/features/partial-changes/planning/change-planner';
import {
  decidePlanStatus,
  type PlanStatus,
} from 'src/features/partial-changes/planning/plan-decision';
import type { Selection } from 'src/features/partial-changes/selection/selection';
import {
  hasUnmatchedSelectors,
  type UnmatchedSelection,
} from 'src/features/partial-changes/selection/selection-resolution';
import {
  validateRequiredAdditionsAcceptance,
  validateSelection,
} from 'src/features/partial-changes/selection/selection-validator';
import type { ChangesBranch } from 'src/features/partial-changes/snapshot/changes-snapshot';
import type { DeadlineHandle } from 'src/infrastructure/database/operation-deadline';
import { OperationTransactionRunner } from 'src/infrastructure/database/operation-transaction-runner';

export interface ApplicablePlan extends ChangePlan {
  readonly target: PlannedTarget;
}

export type TargetWrite<Applied> = (plan: ApplicablePlan) => Promise<Applied>;

interface ApplyRequest {
  readonly operation: ChangeOperation;
  readonly branch: ChangesBranch;
  readonly selection: Selection;
  readonly includeRequired: boolean;
  readonly expected?: string;
}

type RefusalStatus = Exclude<PlanStatus, 'ready'>;

@Injectable()
export class ChangeApplier {
  constructor(
    private readonly transactionRunner: OperationTransactionRunner,
    private readonly draftWriteAdmission: DraftWriteAdmissionService,
    private readonly planner: ChangePlanner,
  ) {}

  public apply<Applied>(
    operation: ChangeOperation,
    input: ApplyChangesInput,
    writeTarget: TargetWrite<Applied>,
  ): Promise<Applied | UnappliedChanges> {
    const request = applyRequestOf(operation, input);

    return this.transactionRunner.runWrite(request.branch, (deadline) =>
      this.planAndWrite(request, writeTarget, deadline),
    );
  }

  private async planAndWrite<Applied>(
    request: ApplyRequest,
    writeTarget: TargetWrite<Applied>,
    deadline: DeadlineHandle,
  ): Promise<Applied | UnappliedChanges> {
    await this.admitDraftWrite(request.branch);

    const plan = await this.plan(request, deadline);
    const status = decidePlanStatus(plan, request);

    if (status !== 'ready') {
      return unappliedChangesOf(plan, status);
    }

    await deadline.checkpoint();

    return writeTarget(applicablePlanOf(plan));
  }

  private admitDraftWrite({
    projectId,
    branchName,
  }: ChangesBranch): Promise<void> {
    return this.draftWriteAdmission.admitBranchWrite(projectId, branchName);
  }

  private async plan(
    { operation, branch, selection }: ApplyRequest,
    deadline: DeadlineHandle,
  ): Promise<ChangePlan> {
    const compared = await this.planner.readComparedSnapshot({
      branch,
      selection,
    });

    return this.planner.plan({ operation, selection, compared }, deadline);
  }
}

export function appliedCountsOf({
  counts,
  unreadTables,
}: ChangePlan): AppliedCounts {
  const { selected, required, remaining } = counts;

  return {
    applied: { selected, required },
    remaining: { units: remaining, unreadTables },
  };
}

function applyRequestOf(
  operation: ChangeOperation,
  { branch, selection, includeRequired = false, expected }: ApplyChangesInput,
): ApplyRequest {
  validateRequiredAdditionsAcceptance({ includeRequired, expected });

  return {
    operation,
    branch,
    selection: validateSelection(selection),
    includeRequired,
    expected,
  };
}

function applicablePlanOf(plan: ChangePlan): ApplicablePlan {
  const { target } = plan;

  if (!target) {
    throw new Error('An applicable plan has no assembled target');
  }

  return { ...plan, target };
}

function unappliedChangesOf(
  plan: ChangePlan,
  status: RefusalStatus,
): UnappliedChanges {
  switch (status) {
    case 'required':
      return { status, required: plan.required };
    case 'blocked':
      return {
        status,
        blockers: plan.blockers,
        required: plan.required,
        ...unmatchedSelectorsOf(plan),
      };
    case 'stale':
      return { status };
    case 'empty':
      return {
        status,
        headRevisionId: plan.headRevisionId,
        draftRevisionId: plan.draftRevisionId,
        ...unmatchedSelectorsOf(plan),
      };
  }
}

function unmatchedSelectorsOf({ unmatched }: ChangePlan): {
  unmatched?: UnmatchedSelection;
} {
  if (!hasUnmatchedSelectors(unmatched)) {
    return {};
  }

  return { unmatched };
}
