import { Injectable } from '@nestjs/common';
import { nanoid } from 'nanoid';
import type { TableMigration } from 'src/engine-prisma-types';
import {
  RELEASED,
  type MigrationLease,
} from 'src/features/migration/services/migration-ownership';
import {
  ACTIVE_MIGRATION_STATUSES,
  MigrationPhase,
  MigrationStatus,
} from 'src/features/migration/types/migration.types';
import type { TransactionPrismaClient } from 'src/features/share/types';
import { PrismaService } from 'src/infrastructure/database/prisma.service';

export interface MigrationCheckpoint {
  copiedRows: number;
  lastCopiedRowId: string | null;
}

const CANCELLABLE_STATUSES: MigrationStatus[] = [
  MigrationStatus.PENDING,
  MigrationStatus.COPYING,
  MigrationStatus.FAILED,
];

type CopySource = Pick<
  TableMigration,
  'tableId' | 'sourceTableVersionId' | 'shadowTableVersionId' | 'startedAt'
>;

type CancelledMigration = Pick<TableMigration, 'id' | 'shadowTableVersionId'>;

@Injectable()
export class MigrationTransitions {
  constructor(private readonly prisma: PrismaService) {}

  findByTable(
    { revisionId, tableId }: { revisionId: string; tableId: string },
    client: TransactionPrismaClient,
  ): Promise<TableMigration | null> {
    return client.tableMigration.findUnique({
      where: { revisionId_tableId: { revisionId, tableId } },
    });
  }

  async beginCopy(
    lease: MigrationLease,
    migration: CopySource,
  ): Promise<boolean> {
    const shadowTableVersionId = migration.shadowTableVersionId ?? nanoid();
    const now = new Date();

    return this.prisma.$transaction(async (transaction) => {
      const started = await transaction.tableMigration.updateMany({
        where: {
          id: lease.migrationId,
          status: MigrationStatus.PENDING,
          lockedBy: lease.token,
        },
        data: {
          status: MigrationStatus.COPYING,
          phase: MigrationPhase.COPYING,
          startedAt: migration.startedAt ?? now,
          lastProgressAt: now,
          shadowTableVersionId,
        },
      });

      if (started.count !== 1) {
        return false;
      }

      if (!migration.shadowTableVersionId) {
        await this.createShadowTable(
          transaction,
          migration,
          shadowTableVersionId,
        );
      }

      return true;
    });
  }

  async advanceCheckpoint(
    lease: MigrationLease,
    from: MigrationCheckpoint,
    to: MigrationCheckpoint,
    transaction: TransactionPrismaClient,
  ): Promise<boolean> {
    const advanced = await transaction.tableMigration.updateMany({
      where: {
        id: lease.migrationId,
        status: MigrationStatus.COPYING,
        lockedBy: lease.token,
        copiedRows: from.copiedRows,
        lastCopiedRowId: from.lastCopiedRowId,
      },
      data: {
        copiedRows: to.copiedRows,
        lastCopiedRowId: to.lastCopiedRowId,
        currentBatch: { increment: 1 },
        lastProgressAt: new Date(),
      },
    });

    return advanced.count === 1;
  }

  async beginSwap(lease: MigrationLease): Promise<boolean> {
    const begun = await this.prisma.tableMigration.updateMany({
      where: {
        id: lease.migrationId,
        status: MigrationStatus.COPYING,
        lockedBy: lease.token,
        copiedRows: { equals: this.prisma.tableMigration.fields.totalRows },
      },
      data: {
        status: MigrationStatus.SWAPPING,
        phase: MigrationPhase.SWAPPING,
        lastProgressAt: new Date(),
      },
    });

    return begun.count === 1;
  }

  async lockSwap(
    lease: MigrationLease,
    transaction: TransactionPrismaClient,
  ): Promise<boolean> {
    const locked = await transaction.tableMigration.updateMany({
      where: this.swapOwnedBy(lease),
      data: { heartbeatAt: new Date() },
    });

    return locked.count === 1;
  }

  async completeSwap(
    lease: MigrationLease,
    transaction: TransactionPrismaClient,
  ): Promise<boolean> {
    const deleted = await transaction.tableMigration.deleteMany({
      where: this.swapOwnedBy(lease),
    });

    return deleted.count === 1;
  }

  async cancel(
    migration: CancelledMigration,
    transaction: TransactionPrismaClient,
  ): Promise<boolean> {
    const cancelled = await transaction.tableMigration.deleteMany({
      where: { id: migration.id, status: { in: CANCELLABLE_STATUSES } },
    });

    if (cancelled.count !== 1) {
      return false;
    }

    if (migration.shadowTableVersionId) {
      await this.deleteUnlinkedTable(
        transaction,
        migration.shadowTableVersionId,
      );
    }

    return true;
  }

  async retry(lease: MigrationLease): Promise<boolean> {
    const retried = await this.prisma.tableMigration.updateMany({
      where: {
        ...this.activeOwnedBy(lease),
        retryCount: { lt: this.prisma.tableMigration.fields.maxRetries },
      },
      data: { retryCount: { increment: 1 }, ...RELEASED },
    });

    return retried.count === 1;
  }

  async fail(lease: MigrationLease, errorMessage: string): Promise<boolean> {
    const failed = await this.prisma.tableMigration.updateMany({
      where: this.activeOwnedBy(lease),
      data: {
        status: MigrationStatus.FAILED,
        errorMessage,
        completedAt: new Date(),
        ...RELEASED,
      },
    });

    return failed.count === 1;
  }

  private async createShadowTable(
    transaction: TransactionPrismaClient,
    migration: CopySource,
    versionId: string,
  ): Promise<void> {
    const source = await transaction.table.findUniqueOrThrow({
      where: { versionId: migration.sourceTableVersionId },
    });

    await transaction.table.create({
      data: {
        versionId,
        createdId: source.createdId,
        id: migration.tableId,
        readonly: false,
        system: source.system,
        createdAt: source.createdAt,
      },
    });
  }

  private async deleteUnlinkedTable(
    transaction: TransactionPrismaClient,
    versionId: string,
  ): Promise<void> {
    const unlinked = { versionId, revisions: { none: {} } };

    await transaction.row.deleteMany({
      where: { tables: { some: unlinked } },
    });
    await transaction.table.deleteMany({ where: unlinked });
  }

  private activeOwnedBy(lease: MigrationLease) {
    return {
      id: lease.migrationId,
      status: { in: ACTIVE_MIGRATION_STATUSES },
      lockedBy: lease.token,
    };
  }

  private swapOwnedBy(lease: MigrationLease) {
    return {
      id: lease.migrationId,
      status: MigrationStatus.SWAPPING,
      lockedBy: lease.token,
    };
  }
}
