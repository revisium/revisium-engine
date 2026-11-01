import { BadRequestException, Injectable } from '@nestjs/common';
import {
  MigrationLockedException,
  MigrationLockedDetails,
} from 'src/features/migration/exceptions/migration-locked.exception';
import { PERCENTAGE_MULTIPLIER } from 'src/features/migration/migration.consts';
import { MigrationTransitions } from 'src/features/migration/services/migration-transitions';
import {
  ACTIVE_MIGRATION_STATUSES,
  MigrationStatus,
} from 'src/features/migration/types/migration.types';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

@Injectable()
export class MigrationLockService {
  constructor(
    private readonly transactionService: TransactionPrismaService,
    private readonly transitions: MigrationTransitions,
  ) {}

  async cancelBranchMigrations(
    projectId: string,
    branchName: string,
  ): Promise<void> {
    const client = this.transactionService.getTransactionOrPrisma();

    const branch = await client.branch.findUnique({
      where: { name_projectId: { name: branchName, projectId } },
      include: { revisions: { where: { isDraft: true }, take: 1 } },
    });

    const draftRevision = branch?.revisions[0];
    if (!draftRevision) {
      return;
    }

    const swapping = await client.tableMigration.findFirst({
      where: {
        revisionId: draftRevision.id,
        status: MigrationStatus.SWAPPING,
      },
    });

    if (swapping) {
      throw new BadRequestException(
        `Cannot revert while migration on table "${swapping.tableId}" is swapping. Wait for swap to complete.`,
      );
    }

    const migrations = await client.tableMigration.findMany({
      where: {
        revisionId: draftRevision.id,
        status: {
          in: [MigrationStatus.PENDING, MigrationStatus.COPYING],
        },
      },
    });

    for (const migration of migrations) {
      await this.transitions.cancel(migration, client);
    }
  }

  async checkRevisionLock(revisionId: string): Promise<void> {
    const lock = await this.findRevisionLock(revisionId);

    if (lock) {
      throw new MigrationLockedException(lock);
    }
  }

  async findRevisionLock(
    revisionId: string,
  ): Promise<MigrationLockedDetails | undefined> {
    const client = this.transactionService.getTransactionOrPrisma();
    const migration = await client.tableMigration.findFirst({
      where: {
        revisionId,
        status: { in: [...ACTIVE_MIGRATION_STATUSES] },
      },
    });

    if (!migration) {
      return undefined;
    }

    return {
      migrationId: migration.id,
      tableId: migration.tableId,
      status: migration.status as MigrationStatus,
      progress: {
        percentage:
          migration.totalRows > 0
            ? (migration.copiedRows / migration.totalRows) *
              PERCENTAGE_MULTIPLIER
            : 0,
        copiedRows: migration.copiedRows,
        totalRows: migration.totalRows,
      },
    };
  }
}
