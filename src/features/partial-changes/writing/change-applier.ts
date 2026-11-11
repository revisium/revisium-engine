import { Injectable } from '@nestjs/common';
import { DraftWriteAdmissionService } from 'src/features/draft/draft-write-admission.service';
import type {
  ApplyChangesInput,
  StoppedChangesBlocked,
  UnappliedChanges,
} from 'src/features/partial-changes/commands/impl/apply-changes';
import { plannedFieldsOf } from 'src/features/partial-changes/logging/partial-operation-fields';
import type { OperationTrace } from 'src/infrastructure/database/operation-log';
import type { ChangeOperation } from 'src/features/partial-changes/plan/change-operation';
import type { ExpectedFingerprint } from 'src/features/partial-changes/plan/fingerprint';
import {
  type ChangePlan,
  ChangePlanner,
  type CompletePlan,
  type StoppedPlan,
} from 'src/features/partial-changes/planning/change-planner';
import {
  changesSincePreview,
  decidePlanStatus,
  type PlanStatus,
} from 'src/features/partial-changes/planning/plan-decision';
import type { Selection } from 'src/features/partial-changes/selection/selection';
import {
  hasUnmatchedSelectors,
  type UnmatchedSelectors,
} from 'src/features/partial-changes/selection/selection-resolution';
import {
  validateRequiredAdditionsAcceptance,
  validateSelection,
} from 'src/features/partial-changes/selection/selection-validator';
import type { ChangesBranch } from 'src/features/partial-changes/snapshot/changes-snapshot';
import type { DeadlineHandle } from 'src/infrastructure/database/operation-deadline';
import { OperationTransactionRunner } from 'src/infrastructure/database/operation-transaction-runner';

export type TargetWrite<Applied> = (plan: CompletePlan) => Promise<Applied>;

interface ApplyRequest {
  readonly operation: ChangeOperation;
  readonly branch: ChangesBranch;
  readonly selection: Selection;
  readonly includeRequired: boolean;
  readonly expected?: ExpectedFingerprint;
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
    trace: OperationTrace,
  ): Promise<Applied | UnappliedChanges> {
    const request = applyRequestOf(operation, input);

    return this.transactionRunner.runWrite(
      request.branch,
      (deadline) => this.planAndWrite(request, writeTarget, deadline, trace),
      trace,
    );
  }

  private async planAndWrite<Applied>(
    request: ApplyRequest,
    writeTarget: TargetWrite<Applied>,
    deadline: DeadlineHandle,
    trace: OperationTrace,
  ): Promise<Applied | UnappliedChanges> {
    await this.admitDraftWrite(request.branch);

    const plan = await this.plan(request, deadline);
    trace.planned(plannedFieldsOf(plan));

    if (!plan.planned) {
      return stoppedByLimit(plan);
    }

    const status = decidePlanStatus(plan, request);

    if (status !== 'ready') {
      return unappliedChangesOf(plan, status, request);
    }

    await deadline.checkpoint();

    return writeTarget(plan);
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

function applyRequestOf(
  operation: ChangeOperation,
  { branch, selection, includeRequired, expected }: ApplyChangesInput,
): ApplyRequest {
  const acceptance = validateRequiredAdditionsAcceptance({
    includeRequired,
    expected,
  });

  return {
    operation,
    branch,
    selection: validateSelection(selection),
    ...acceptance,
  };
}

function stoppedByLimit({ blockers }: StoppedPlan): StoppedChangesBlocked {
  return { status: 'blocked', planned: false, blockers, required: [] };
}

function unappliedChangesOf(
  plan: CompletePlan,
  status: RefusalStatus,
  request: ApplyRequest,
): UnappliedChanges {
  switch (status) {
    case 'required':
      return { status, required: plan.required };
    case 'blocked':
      return {
        status,
        planned: true,
        blockers: plan.blockers,
        required: plan.required,
        unmatched: plan.unmatched,
      };
    case 'stale':
      return {
        status,
        changed: changesSincePreview(plan, request),
        headRevisionId: plan.headRevisionId,
        draftRevisionId: plan.draftRevisionId,
        unmatched: plan.unmatched,
      };
    case 'empty':
      return {
        status,
        headRevisionId: plan.headRevisionId,
        draftRevisionId: plan.draftRevisionId,
        ...unmatchedSelectorsOf(plan),
      };
  }
}

function unmatchedSelectorsOf({ unmatched }: CompletePlan): {
  unmatched?: UnmatchedSelectors;
} {
  if (!hasUnmatchedSelectors(unmatched)) {
    return {};
  }

  return { unmatched };
}
