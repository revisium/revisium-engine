import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import {
  CommitTableWritePlan,
  CommitTargetWritePlan,
  DraftRevisionCommitToTargetCommand,
  DraftRevisionCommitToTargetCommandReturnType,
  oppositeOf,
  RenumberedRows,
  versionIdOn,
} from 'src/features/draft-revision/commands/impl';
import {
  AssembledVersionWriter,
  CommitTransition,
  DraftFollowsHead,
  DraftRevisionInternalService,
  linkedVersion,
  NewRowFileReferences,
  TableLinkReplacement,
  WrittenTable,
  WrittenVersion,
} from 'src/features/draft-revision/services';

interface CommittedTable {
  readonly plan: CommitTableWritePlan;
  readonly head: WrittenVersion;
  readonly nextDraftVersionId?: string;
}

@CommandHandler(DraftRevisionCommitToTargetCommand)
export class DraftRevisionCommitToTargetHandler implements ICommandHandler<
  DraftRevisionCommitToTargetCommand,
  DraftRevisionCommitToTargetCommandReturnType
> {
  constructor(
    private readonly versionWriter: AssembledVersionWriter,
    private readonly transition: CommitTransition,
    private readonly internalService: DraftRevisionInternalService,
    private readonly draftFollowsHead: DraftFollowsHead,
    private readonly fileReferences: NewRowFileReferences,
  ) {}

  async execute({
    data,
  }: DraftRevisionCommitToTargetCommand): Promise<DraftRevisionCommitToTargetCommandReturnType> {
    const { headRevisionId, draftRevisionId } = data;
    const tables = await this.commitTables(data.tables);
    const nextDraftRevisionId = await this.advanceRevisions(data, tables);

    await this.fileReferences.register(
      draftRevisionId,
      writtenHeadTablesOf(tables),
    );
    await this.internalService.updateHasChanges(
      nextDraftRevisionId,
      draftRevisionId,
    );

    return {
      previousHeadRevisionId: headRevisionId,
      headRevisionId: draftRevisionId,
      draftRevisionId: nextDraftRevisionId,
    };
  }

  private async commitTables(
    plans: readonly CommitTableWritePlan[],
  ): Promise<CommittedTable[]> {
    const tables: CommittedTable[] = [];

    for (const plan of plans) {
      const head = await this.writeHeadTable(plan);

      tables.push({
        plan,
        head,
        nextDraftVersionId: await this.writeNextDraftTable(
          plan,
          head.versionId,
        ),
      });
    }

    return tables;
  }

  private async writeHeadTable(
    plan: CommitTableWritePlan,
  ): Promise<WrittenVersion> {
    switch (plan.outcome) {
      case 'absent':
        return linkedVersion(undefined);
      case 'unchanged':
      case 'base':
        return this.linkIntoHead(plan, versionIdOn(plan, plan.structureSide));
      case 'other':
        return this.linkIntoHead(
          plan,
          versionIdOn(plan, oppositeOf(plan.structureSide)),
        );
      case 'mixed':
        return this.writeMixedHeadTable(plan);
    }
  }

  private async linkIntoHead(
    plan: CommitTableWritePlan,
    versionId: string,
  ): Promise<WrittenVersion> {
    if (versionId !== plan.headVersionId) {
      await this.versionWriter.lockLinkedIntoHead(
        versionId,
        plan.headVersionId,
      );
    }

    return linkedVersion(versionId);
  }

  private async writeMixedHeadTable(
    plan: CommitTableWritePlan,
  ): Promise<WrittenVersion> {
    const written = await this.versionWriter.createReadonlyTableVersion(
      versionIdOn(plan, plan.structureSide),
      plan,
    );

    await this.versionWriter.lockLinkedIntoHead(
      written.versionId,
      plan.headVersionId,
    );

    return written;
  }

  private async writeNextDraftTable(
    plan: CommitTableWritePlan,
    headVersionId: string | undefined,
  ): Promise<string | undefined> {
    if (plan.renumberedRows) {
      return this.writeRenumberedVersion(plan, plan.renumberedRows);
    }

    return this.draftFollowsHead.versionToLink(
      plan,
      plan.draftVersionId,
      headVersionId,
    );
  }

  private async writeRenumberedVersion(
    plan: CommitTableWritePlan,
    { replacedRowVersionIds, newRows }: RenumberedRows,
  ): Promise<string> {
    const { versionId } = await this.versionWriter.createTableVersion(
      versionIdOn(plan, 'draft'),
      {
        removedRowVersionIds: replacedRowVersionIds,
        addedRowVersionIds: [],
        newRows,
      },
    );

    return versionId;
  }

  private async advanceRevisions(
    plan: CommitTargetWritePlan,
    tables: readonly CommittedTable[],
  ): Promise<string> {
    const headTables = await this.transition.relinkedTablesOf(
      plan.headRevisionId,
      tables.map(headLinkOf),
    );
    const nextDraftTables = await this.transition.relinkedTablesOf(
      plan.draftRevisionId,
      tables.map(nextDraftLinkOf),
    );

    await this.transition.retireHead(plan.headRevisionId);
    await this.transition.promoteDraftToHead(
      plan.draftRevisionId,
      plan.comment,
      headTables,
    );

    return this.transition.openNextDraft({
      branchId: plan.branchId,
      parentRevisionId: plan.draftRevisionId,
      tables: nextDraftTables,
    });
  }
}

function headLinkOf({ plan, head }: CommittedTable): TableLinkReplacement {
  return { replacedVersionId: plan.headVersionId, versionId: head.versionId };
}

function nextDraftLinkOf({
  plan,
  nextDraftVersionId,
}: CommittedTable): TableLinkReplacement {
  return {
    replacedVersionId: plan.draftVersionId,
    versionId: nextDraftVersionId,
  };
}

function writtenHeadTablesOf(
  tables: readonly CommittedTable[],
): WrittenTable[] {
  return tables.map(({ plan, head }) => ({ plan, written: head }));
}
