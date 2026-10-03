import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import {
  DraftRevisionCleanupDetachedStateCommand,
  DraftRevisionCleanupDetachedStateCommandResult,
} from 'src/features/draft-revision/commands/impl/draft-revision-cleanup-detached-state.command';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';
import { collectCleanupCandidates } from 'src/features/draft-revision/state/cleanup-candidates';

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
    const candidates = collectCleanupCandidates(data.states);
    await this.deleteDetachedTables(candidates.tableVersionIds);
    const detachedRows = await this.findDetachedRows(candidates.rowVersionIds);
    const affectedBlobIds = this.collectBlobIds(detachedRows);
    await this.deleteDetachedRows(detachedRows);
    return { affectedBlobIds };
  }

  private async deleteDetachedTables(versionIds: string[]): Promise<void> {
    if (versionIds.length === 0) {
      return;
    }
    await this.transaction.table.deleteMany({
      where: {
        versionId: { in: versionIds },
        readonly: false,
        revisions: { none: {} },
      },
    });
  }

  private findDetachedRows(versionIds: string[]) {
    if (versionIds.length === 0) {
      return Promise.resolve(
        [] as { versionId: string; fileBlobs: { id: string }[] }[],
      );
    }
    return this.transaction.row.findMany({
      where: {
        versionId: { in: versionIds },
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

  private async deleteDetachedRows(
    rows: { versionId: string }[],
  ): Promise<void> {
    if (rows.length === 0) {
      return;
    }
    await this.transaction.row.deleteMany({
      where: {
        versionId: { in: rows.map(({ versionId }) => versionId) },
        readonly: false,
        tables: { none: {} },
      },
    });
  }
}
