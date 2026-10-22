import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import {
  CommitChangesCommand,
  CommitChangesCommandReturnType,
} from 'src/features/partial-changes-poc/commands/impl/commit-changes.command';
import { ChangePlanner } from 'src/features/partial-changes-poc/planning/change-planner.service';
import {
  appliedCounts,
  refusalOf,
  renumberedIds,
} from 'src/features/partial-changes-poc/planning/plan-outcome';
import { CommitWriter } from 'src/features/partial-changes-poc/write/commit-writer.service';
import { MigrationLockService } from 'src/features/migration/services/migration-lock.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

@CommandHandler(CommitChangesCommand)
export class CommitChangesHandler implements ICommandHandler<
  CommitChangesCommand,
  CommitChangesCommandReturnType
> {
  constructor(
    private readonly transactionService: TransactionPrismaService,
    private readonly migrationLockService: MigrationLockService,
    private readonly planner: ChangePlanner,
    private readonly commitWriter: CommitWriter,
  ) {}

  execute({
    data,
  }: CommitChangesCommand): Promise<CommitChangesCommandReturnType> {
    return this.transactionService.runSerializable(() => this.commit(data));
  }

  private async commit(
    data: CommitChangesCommand['data'],
  ): Promise<CommitChangesCommandReturnType> {
    await this.migrationLockService.checkBranchLock(
      data.branch.projectId,
      data.branch.branchName,
    );

    const plan = await this.planner.plan({ ...data, operation: 'commit' });
    const refusal = refusalOf(plan, data);
    if (refusal) {
      return refusal;
    }

    const written = await this.commitWriter.write(plan, data.comment);
    return {
      status: 'applied',
      ...written,
      ...appliedCounts(plan),
      renumbered: renumberedIds(plan),
    };
  }
}
