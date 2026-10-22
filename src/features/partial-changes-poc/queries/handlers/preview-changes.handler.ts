import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { TransactionIsolationLevel } from 'src/engine-prisma-types';
import { MigrationLockedException } from 'src/features/migration/exceptions/migration-locked.exception';
import type { MigrationLockedDetails } from 'src/features/migration/exceptions/migration-locked.exception';
import { MigrationLockService } from 'src/features/migration/services/migration-lock.service';
import { Blocker } from 'src/features/partial-changes-poc/partial-changes.types';
import { ChangePlanner } from 'src/features/partial-changes-poc/planning/change-planner.service';
import { toPreviewResult } from 'src/features/partial-changes-poc/planning/plan-outcome';
import {
  PreviewChangesQuery,
  PreviewChangesQueryReturnType,
} from 'src/features/partial-changes-poc/queries/impl/preview-changes.query';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

@QueryHandler(PreviewChangesQuery)
export class PreviewChangesHandler implements IQueryHandler<
  PreviewChangesQuery,
  PreviewChangesQueryReturnType
> {
  constructor(
    private readonly transactionService: TransactionPrismaService,
    private readonly migrationLockService: MigrationLockService,
    private readonly planner: ChangePlanner,
  ) {}

  execute({
    data,
  }: PreviewChangesQuery): Promise<PreviewChangesQueryReturnType> {
    return this.transactionService.run(() => this.preview(data), {
      isolationLevel: TransactionIsolationLevel.RepeatableRead,
    });
  }

  private async preview(
    data: PreviewChangesQuery['data'],
  ): Promise<PreviewChangesQueryReturnType> {
    const lock = await this.activeMigrationBlocker(data);
    const plan = await this.planner.plan(data);
    if (lock) {
      plan.blockers.unshift(lock);
    }
    return toPreviewResult(plan, Boolean(data.includeRequired));
  }

  private async activeMigrationBlocker(
    data: PreviewChangesQuery['data'],
  ): Promise<Blocker | undefined> {
    try {
      await this.migrationLockService.checkBranchLock(
        data.branch.projectId,
        data.branch.branchName,
      );
      return undefined;
    } catch (error) {
      if (!(error instanceof MigrationLockedException)) {
        throw error;
      }
      const { migration } = error.getResponse() as {
        migration: MigrationLockedDetails;
      };
      return {
        code: 'migrationInProgress',
        tableId: migration.tableId,
        message: `An async migration of ${migration.tableId} is ${migration.status}; commit and revert are locked until it completes`,
      };
    }
  }
}
