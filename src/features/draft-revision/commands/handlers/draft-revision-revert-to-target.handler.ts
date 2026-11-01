import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import {
  DraftRevisionRevertToTargetCommand,
  oppositeOf,
  TableWritePlan,
  versionIdOn,
  versionRefsOf,
} from 'src/features/draft-revision/commands/impl';
import {
  AssembledTableVersion,
  AssembledVersionWriter,
  DraftFollowsHead,
  DraftRevisionInternalService,
  linkedVersion,
  NewRowFileReferences,
  WrittenTable,
  WrittenVersion,
} from 'src/features/draft-revision/services';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

@CommandHandler(DraftRevisionRevertToTargetCommand)
export class DraftRevisionRevertToTargetHandler implements ICommandHandler<
  DraftRevisionRevertToTargetCommand,
  string
> {
  constructor(
    private readonly transactionService: TransactionPrismaService,
    private readonly versionWriter: AssembledVersionWriter,
    private readonly internalService: DraftRevisionInternalService,
    private readonly draftFollowsHead: DraftFollowsHead,
    private readonly fileReferences: NewRowFileReferences,
  ) {}

  private get transaction() {
    return this.transactionService.getTransaction();
  }

  async execute({ data }: DraftRevisionRevertToTargetCommand): Promise<string> {
    const { headRevisionId, draftRevisionId } = data;
    const tables = await this.revertTables(data.tables);

    await this.relinkDraftTables(draftRevisionId, tables);
    await this.fileReferences.register(draftRevisionId, tables);
    await this.internalService.updateHasChanges(
      draftRevisionId,
      headRevisionId,
    );

    return draftRevisionId;
  }

  private async revertTables(
    plans: readonly TableWritePlan[],
  ): Promise<WrittenTable[]> {
    const tables: WrittenTable[] = [];

    for (const plan of plans) {
      const written = await this.writeTable(plan);

      tables.push({
        plan,
        written: await this.followHeadWhenContentEqual(plan, written),
      });
    }

    return tables;
  }

  private async writeTable(plan: TableWritePlan): Promise<WrittenVersion> {
    switch (plan.outcome) {
      case 'unchanged':
        return linkedVersion(plan.draftVersionId);
      case 'absent':
        return linkedVersion(undefined);
      case 'base':
        return linkedVersion(versionIdOn(plan, plan.structureSide));
      case 'other':
        return linkedVersion(versionIdOn(plan, oppositeOf(plan.structureSide)));
      case 'mixed':
        return this.writeMixedTable(plan);
    }
  }

  private async writeMixedTable(
    plan: TableWritePlan,
  ): Promise<AssembledTableVersion> {
    const sourceVersionId = versionIdOn(plan, plan.structureSide);

    if (await this.editsDraftVersionInPlace(plan)) {
      return this.versionWriter.editTableVersion(sourceVersionId, plan);
    }

    return this.versionWriter.createTableVersion(sourceVersionId, plan);
  }

  private async editsDraftVersionInPlace(
    plan: TableWritePlan,
  ): Promise<boolean> {
    if (plan.structureSide === 'head') {
      return false;
    }

    // The Draft structure owns the public id, so a mutable Draft version keeps it.
    const { readonly } = await this.transaction.table.findUniqueOrThrow({
      where: { versionId: versionIdOn(plan, 'draft') },
      select: { readonly: true },
    });

    return !readonly;
  }

  private async followHeadWhenContentEqual(
    plan: TableWritePlan,
    written: WrittenVersion,
  ): Promise<WrittenVersion> {
    const versionId = await this.draftFollowsHead.versionToLink(
      plan,
      written.versionId,
      plan.headVersionId,
    );

    if (versionId === written.versionId) {
      return written;
    }

    return linkedVersion(versionId);
  }

  private async relinkDraftTables(
    draftRevisionId: string,
    tables: readonly WrittenTable[],
  ): Promise<void> {
    const relinked = tables.filter(
      ({ plan, written }) => plan.draftVersionId !== written.versionId,
    );

    if (relinked.length === 0) {
      return;
    }

    await this.transaction.revision.update({
      where: { id: draftRevisionId },
      data: {
        tables: {
          disconnect: relinked.flatMap(({ plan }) =>
            versionRefsOf(plan.draftVersionId),
          ),
          connect: relinked.flatMap(({ written }) =>
            versionRefsOf(written.versionId),
          ),
        },
      },
    });
  }
}
