import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { DraftRevisionTargetApiService } from 'src/features/draft-revision/draft-revision-target-api.service';
import {
  type RevertChangesResult,
  RevertDraftChangesCommand,
  type RevertedDraft,
} from 'src/features/partial-changes/commands/impl/revert-draft-changes.command';
import {
  type ApplicablePlan,
  appliedCountsOf,
  ChangeApplier,
} from 'src/features/partial-changes/writing/change-applier';
import { targetWritePlanOf } from 'src/features/partial-changes/writing/target-write-plan-mapping';
import { ShareCommands } from 'src/features/share/share.commands';

@CommandHandler(RevertDraftChangesCommand)
export class RevertDraftChangesHandler implements ICommandHandler<
  RevertDraftChangesCommand,
  RevertChangesResult
> {
  constructor(
    private readonly changeApplier: ChangeApplier,
    private readonly draftRevisionTargetApi: DraftRevisionTargetApiService,
    private readonly shareCommands: ShareCommands,
  ) {}

  public async execute({
    data,
  }: RevertDraftChangesCommand): Promise<RevertChangesResult> {
    const result = await this.changeApplier.apply('revert', data, (plan) =>
      this.revertDraft(plan),
    );

    await this.notifyWhenReverted(result);

    return result;
  }

  private async revertDraft(plan: ApplicablePlan): Promise<RevertedDraft> {
    await this.draftRevisionTargetApi.revertToTarget(
      targetWritePlanOf(plan.target),
    );

    return {
      status: 'applied',
      headRevisionId: plan.headRevisionId,
      draftRevisionId: plan.draftRevisionId,
      ...appliedCountsOf(plan),
    };
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
