import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { DraftRevisionTargetApiService } from 'src/features/draft-revision/draft-revision-target-api.service';
import type { LedgerPlan } from 'src/features/partial-changes/assembly/ledger-plan';
import {
  type CommitChangesResult,
  CommitDraftChangesCommand,
  type CommittedDraft,
  type RenumberedMigration,
} from 'src/features/partial-changes/commands/impl/commit-draft-changes.command';
import {
  type ApplicablePlan,
  appliedCountsOf,
  ChangeApplier,
} from 'src/features/partial-changes/writing/change-applier';
import { commitTargetWritePlanOf } from 'src/features/partial-changes/writing/target-write-plan-mapping';
import { ShareCommands } from 'src/features/share/share.commands';

@CommandHandler(CommitDraftChangesCommand)
export class CommitDraftChangesHandler implements ICommandHandler<
  CommitDraftChangesCommand,
  CommitChangesResult
> {
  constructor(
    private readonly changeApplier: ChangeApplier,
    private readonly draftRevisionTargetApi: DraftRevisionTargetApiService,
    private readonly shareCommands: ShareCommands,
  ) {}

  public async execute({
    data,
  }: CommitDraftChangesCommand): Promise<CommitChangesResult> {
    const result = await this.changeApplier.apply('commit', data, (plan) =>
      this.commitDraft(plan, data.comment),
    );

    await this.notifyWhenCommitted(result);

    return result;
  }

  private async commitDraft(
    plan: ApplicablePlan,
    comment: string | undefined,
  ): Promise<CommittedDraft> {
    const { previousHeadRevisionId, headRevisionId, draftRevisionId } =
      await this.draftRevisionTargetApi.commitToTarget(
        commitTargetWritePlanOf(plan.target, comment),
      );

    return {
      status: 'applied',
      previousHeadRevisionId,
      headRevisionId,
      draftRevisionId,
      ...appliedCountsOf(plan),
      renumbered: renumberedMigrationsOf(plan.target.assembled.ledger),
    };
  }

  private async notifyWhenCommitted(
    result: CommitChangesResult,
  ): Promise<void> {
    if (result.status !== 'applied') {
      return;
    }

    await this.shareCommands.notifyEndpoints({
      revisionId: result.headRevisionId,
    });
    await this.shareCommands.notifyEndpoints({
      revisionId: result.draftRevisionId,
    });
  }
}

function renumberedMigrationsOf({
  renumbered,
}: LedgerPlan): RenumberedMigration[] {
  return renumbered.map(({ source, row }) => ({
    from: source.migration.id,
    to: row.id,
  }));
}
