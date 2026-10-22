import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import {
  RevertPartialChangesCommand,
  RevertPartialChangesCommandReturnType,
} from 'src/features/partial-changes-poc/commands/impl/revert-changes.command';
import { ChangePlanner } from 'src/features/partial-changes-poc/planning/change-planner.service';
import {
  appliedCounts,
  refusalOf,
} from 'src/features/partial-changes-poc/planning/plan-outcome';
import { RevertWriter } from 'src/features/partial-changes-poc/write/revert-writer.service';
import { MigrationLockService } from 'src/features/migration/services/migration-lock.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

@CommandHandler(RevertPartialChangesCommand)
export class RevertPartialChangesHandler implements ICommandHandler<
  RevertPartialChangesCommand,
  RevertPartialChangesCommandReturnType
> {
  constructor(
    private readonly transactionService: TransactionPrismaService,
    private readonly migrationLockService: MigrationLockService,
    private readonly planner: ChangePlanner,
    private readonly revertWriter: RevertWriter,
  ) {}

  execute({
    data,
  }: RevertPartialChangesCommand): Promise<RevertPartialChangesCommandReturnType> {
    return this.transactionService.runSerializable(() => this.revert(data));
  }

  private async revert(
    data: RevertPartialChangesCommand['data'],
  ): Promise<RevertPartialChangesCommandReturnType> {
    await this.migrationLockService.checkBranchLock(
      data.branch.projectId,
      data.branch.branchName,
    );

    const plan = await this.planner.plan({ ...data, operation: 'revert' });
    const refusal = refusalOf(plan, data);
    if (refusal) {
      return refusal;
    }

    const written = await this.revertWriter.write(plan);
    return {
      status: 'applied',
      headRevisionId: plan.snapshot.headRevisionId,
      ...written,
      ...appliedCounts(plan),
    };
  }
}
