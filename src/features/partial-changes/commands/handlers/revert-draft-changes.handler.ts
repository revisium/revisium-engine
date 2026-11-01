import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import type { TargetWritePlan } from 'src/features/draft-revision/commands/impl';
import { DraftRevisionTargetApiService } from 'src/features/draft-revision/draft-revision-target-api.service';
import { DraftWriteAdmissionService } from 'src/features/draft/draft-write-admission.service';
import {
  type RevertChangesInput,
  type RevertChangesResult,
  RevertDraftChangesCommand,
  type RevertedDraft,
} from 'src/features/partial-changes/commands/impl/revert-draft-changes.command';
import {
  type ChangePlan,
  ChangePlanner,
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
import { targetWritePlanOf } from 'src/features/partial-changes/writing/target-write-plan-mapping';
import { ShareCommands } from 'src/features/share/share.commands';
import type { DeadlineHandle } from 'src/infrastructure/database/operation-deadline';
import { OperationTransactionRunner } from 'src/infrastructure/database/operation-transaction-runner';

interface RevertRequest {
  readonly branch: ChangesBranch;
  readonly selection: Selection;
  readonly includeRequired: boolean;
  readonly expected?: string;
}

type RefusalStatus = Exclude<PlanStatus, 'ready'>;

@CommandHandler(RevertDraftChangesCommand)
export class RevertDraftChangesHandler implements ICommandHandler<
  RevertDraftChangesCommand,
  RevertChangesResult
> {
  constructor(
    private readonly transactionRunner: OperationTransactionRunner,
    private readonly draftWriteAdmission: DraftWriteAdmissionService,
    private readonly planner: ChangePlanner,
    private readonly draftRevisionTargetApi: DraftRevisionTargetApiService,
    private readonly shareCommands: ShareCommands,
  ) {}

  public async execute({
    data,
  }: RevertDraftChangesCommand): Promise<RevertChangesResult> {
    const request = revertRequestOf(data);
    const result = await this.transactionRunner.runWrite(
      request.branch,
      (deadline) => this.revert(request, deadline),
    );

    await this.notifyWhenReverted(result);

    return result;
  }

  private async revert(
    request: RevertRequest,
    deadline: DeadlineHandle,
  ): Promise<RevertChangesResult> {
    await this.admitDraftWrite(request.branch);

    const plan = await this.planRevert(request, deadline);
    const status = decidePlanStatus(plan, request);

    if (status !== 'ready') {
      return refusalOf(plan, status);
    }

    await deadline.checkpoint();
    await this.draftRevisionTargetApi.revertToTarget(writePlanOf(plan));

    return revertedDraftOf(plan);
  }

  private admitDraftWrite({
    projectId,
    branchName,
  }: ChangesBranch): Promise<void> {
    return this.draftWriteAdmission.admitBranchWrite(projectId, branchName);
  }

  private async planRevert(
    { selection, branch }: RevertRequest,
    deadline: DeadlineHandle,
  ): Promise<ChangePlan> {
    const compared = await this.planner.readComparedSnapshot({
      branch,
      selection,
    });

    return this.planner.plan(
      { operation: 'revert', selection, compared },
      deadline,
    );
  }

  private async notifyWhenReverted(result: RevertChangesResult): Promise<void> {
    if (result.status !== 'applied') {
      return;
    }

    await this.shareCommands.notifyEndpoints({
      revisionId: result.draftRevisionId,
    });
  }
}

function revertRequestOf({
  branch,
  selection,
  includeRequired = false,
  expected,
}: RevertChangesInput): RevertRequest {
  validateRequiredAdditionsAcceptance({ includeRequired, expected });

  return {
    branch,
    selection: validateSelection(selection),
    includeRequired,
    expected,
  };
}

function writePlanOf({ target }: ChangePlan): TargetWritePlan {
  if (!target) {
    throw new Error('An applicable revert plan has no assembled target');
  }

  return targetWritePlanOf(target);
}

function revertedDraftOf(plan: ChangePlan): RevertedDraft {
  const { selected, required, remaining } = plan.counts;

  return {
    status: 'applied',
    headRevisionId: plan.headRevisionId,
    draftRevisionId: plan.draftRevisionId,
    applied: { selected, required },
    remaining: { units: remaining, unreadTables: plan.unreadTables },
  };
}

function refusalOf(
  plan: ChangePlan,
  status: RefusalStatus,
): RevertChangesResult {
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
