import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import {
  DraftRevisionCleanupDetachedStateCommand,
  DraftRevisionCleanupDetachedStateCommandResult,
} from 'src/features/draft-revision/commands/impl/draft-revision-cleanup-detached-state.command';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

@CommandHandler(DraftRevisionCleanupDetachedStateCommand)
export class DraftRevisionCleanupDetachedStateHandler implements ICommandHandler<DraftRevisionCleanupDetachedStateCommand> {
  constructor(private readonly transactionService: TransactionPrismaService) {}

  private get transaction() {
    return this.transactionService.getTransaction();
  }

  async execute({
    data,
  }: DraftRevisionCleanupDetachedStateCommand): Promise<DraftRevisionCleanupDetachedStateCommandResult> {
    return this.handle(data);
  }

  private async handle(
    data: DraftRevisionCleanupDetachedStateCommand['data'],
  ): Promise<DraftRevisionCleanupDetachedStateCommandResult> {
    const mutableTables = data.states.flatMap(({ tables }) =>
      tables.filter((table) => !table.readonly),
    );
    await this.deleteDetachedTables(
      mutableTables.map(({ versionId }) => versionId),
    );
    const detachedRows = await this.findDetachedRows(
      mutableTables.flatMap((table) =>
        table.rows
          .filter((row) => !row.readonly)
          .map(({ versionId }) => versionId),
      ),
    );
    const affectedBlobIds = this.collectBlobIds(detachedRows);
    await this.deleteDetachedRows(
      detachedRows.map(({ versionId }) => versionId),
    );
    return { affectedBlobIds };
  }

  private async deleteDetachedTables(versionIds: string[]): Promise<void> {
    const uniqueVersionIds = [...new Set(versionIds)];
    if (uniqueVersionIds.length === 0) {
      return;
    }
    await this.transaction.table.deleteMany({
      where: {
        versionId: { in: uniqueVersionIds },
        readonly: false,
        revisions: { none: {} },
      },
    });
  }

  private findDetachedRows(versionIds: string[]) {
    const uniqueVersionIds = [...new Set(versionIds)];
    if (uniqueVersionIds.length === 0) {
      return Promise.resolve(
        [] as { versionId: string; fileBlobs: { id: string }[] }[],
      );
    }
    return this.transaction.row.findMany({
      where: {
        versionId: { in: uniqueVersionIds },
        readonly: false,
        tables: { none: {} },
      },
      select: { versionId: true, fileBlobs: { select: { id: true } } },
    });
  }

  private collectBlobIds(rows: { fileBlobs: { id: string }[] }[]): string[] {
    return [
      ...new Set(
        rows.flatMap(({ fileBlobs }) => fileBlobs.map(({ id }) => id)),
      ),
    ];
  }

  private async deleteDetachedRows(versionIds: string[]): Promise<void> {
    const uniqueVersionIds = [...new Set(versionIds)];
    if (uniqueVersionIds.length === 0) {
      return;
    }
    await this.transaction.row.deleteMany({
      where: {
        versionId: { in: uniqueVersionIds },
        readonly: false,
        tables: { none: {} },
      },
    });
  }
}
