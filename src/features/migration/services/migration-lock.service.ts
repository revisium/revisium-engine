import { BadRequestException, Injectable } from '@nestjs/common';
import {
  MigrationLockedException,
  MigrationLockedDetails,
} from 'src/features/migration/exceptions/migration-locked.exception';
import { PERCENTAGE_MULTIPLIER } from 'src/features/migration/migration.consts';
import {
  ACTIVE_MIGRATION_STATUSES,
  MigrationStatus,
} from 'src/features/migration/types/migration.types';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

@Injectable()
export class MigrationLockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactionService: TransactionPrismaService,
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
      if (migration.shadowTableVersionId) {
        await client.table
          .delete({
            where: { versionId: migration.shadowTableVersionId },
          })
          .catch((err: Error & { code?: string }) => {
            if (err.code !== 'P2025') {
              throw err;
            }
          });
      }
      await client.tableMigration.delete({
        where: { id: migration.id },
      });
    }
  }

  async checkBranchLock(projectId: string, branchName: string): Promise<void> {
    const branch = await this.prisma.branch.findUnique({
      where: { name_projectId: { name: branchName, projectId } },
      include: { revisions: { where: { isDraft: true }, take: 1 } },
    });

    const draftRevision = branch?.revisions[0];
    if (draftRevision) {
      await this.checkRevisionLock(draftRevision.id);
    }
  }

  async checkRevisionLock(revisionId: string): Promise<void> {
    const migration = await this.prisma.tableMigration.findFirst({
      where: {
        revisionId,
        status: { in: [...ACTIVE_MIGRATION_STATUSES] },
      },
    });

    if (migration) {
      const details: MigrationLockedDetails = {
        migrationId: migration.id,
        tableId: migration.tableId,
        status: migration.status,
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
      throw new MigrationLockedException(details);
    }
  }
}
