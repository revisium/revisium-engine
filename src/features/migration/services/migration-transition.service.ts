import { Inject, Injectable, Optional } from '@nestjs/common';
import { nanoid } from 'nanoid';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import type { TableMigration } from 'src/engine-prisma-types';
import {
  MIGRATION_DEFAULTS,
  MIGRATION_OPTIONS,
} from 'src/features/migration/migration.consts';
import type { MigrationOptions } from 'src/features/migration/types/migration-options.types';
import {
  ACTIVE_MIGRATION_STATUSES,
  MigrationPhase,
  MigrationStatus,
} from 'src/features/migration/types/migration.types';
import type { TransactionPrismaClient } from 'src/features/share/types';
import { PrismaService } from 'src/infrastructure/database/prisma.service';

export interface MigrationLease {
  migrationId: string;
  token: string;
}

export interface MigrationCheckpoint {
  copiedRows: number;
  lastCopiedRowId: string | null;
}

const SWAP_STALLED =
  'SWAP_STALLED: the swap did not complete within maxRetries claims';

const RELEASED = { lockedBy: null, lockedAt: null };

type CopySource = Pick<
  TableMigration,
  'tableId' | 'sourceTableVersionId' | 'shadowTableVersionId' | 'startedAt'
>;

@Injectable()
export class MigrationTransitionService {
  private readonly workerId = `${hostname()}-${process.pid}`;
  private readonly lockTimeoutMs: number;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(MIGRATION_OPTIONS) options?: MigrationOptions,
  ) {
    this.lockTimeoutMs =
      options?.lockTimeoutMs ?? MIGRATION_DEFAULTS.lockTimeoutMs;
  }

  async findClaimable(limit?: number): Promise<string[]> {
    const migrations = await this.prisma.tableMigration.findMany({
      where: {
        status: { in: ACTIVE_MIGRATION_STATUSES },
        ...this.withoutLiveLease(),
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: { id: true },
    });

    return migrations.map((migration) => migration.id);
  }

  async claim(migrationId: string): Promise<MigrationLease | null> {
    const migration = await this.prisma.tableMigration.findUnique({
      where: { id: migrationId },
      select: { status: true },
    });

    if (!migration || !isActive(migration.status)) {
      return null;
    }

    const lease = { migrationId, token: `${this.workerId}-${randomUUID()}` };

    if (migration.status === MigrationStatus.SWAPPING) {
      return this.claimSwap(lease);
    }

    const claimed = await this.prisma.tableMigration.updateMany({
      where: {
        id: migrationId,
        status: migration.status,
        ...this.withoutLiveLease(),
      },
      data: this.ownedBy(lease),
    });

    return claimed.count === 1 ? lease : null;
  }

  findOwned(lease: MigrationLease): Promise<TableMigration | null> {
    return this.prisma.tableMigration.findFirst({
      where: { id: lease.migrationId, lockedBy: lease.token },
    });
  }

  async renew(lease: MigrationLease): Promise<boolean> {
    const renewed = await this.prisma.tableMigration.updateMany({
      where: { id: lease.migrationId, lockedBy: lease.token },
      data: { heartbeatAt: new Date() },
    });

    return renewed.count === 1;
  }

  async release(lease: MigrationLease): Promise<void> {
    await this.prisma.tableMigration.updateMany({
      where: { id: lease.migrationId, lockedBy: lease.token },
      data: RELEASED,
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

  async completeSwap(lease: MigrationLease): Promise<boolean> {
    const deleted = await this.prisma.tableMigration.deleteMany({
      where: this.swapOwnedBy(lease),
    });

    return deleted.count === 1;
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

  private async claimSwap(
    lease: MigrationLease,
  ): Promise<MigrationLease | null> {
    const claimed = await this.prisma.tableMigration.updateMany({
      where: {
        id: lease.migrationId,
        status: MigrationStatus.SWAPPING,
        retryCount: { lt: this.prisma.tableMigration.fields.maxRetries },
        ...this.withoutLiveLease(),
      },
      data: { ...this.ownedBy(lease), retryCount: { increment: 1 } },
    });

    if (claimed.count === 1) {
      return lease;
    }

    await this.failStalledSwap(lease.migrationId);
    return null;
  }

  private async failStalledSwap(migrationId: string): Promise<void> {
    await this.prisma.tableMigration.updateMany({
      where: {
        id: migrationId,
        status: MigrationStatus.SWAPPING,
        retryCount: { gte: this.prisma.tableMigration.fields.maxRetries },
        ...this.withoutLiveLease(),
      },
      data: {
        status: MigrationStatus.FAILED,
        errorMessage: SWAP_STALLED,
        completedAt: new Date(),
        ...RELEASED,
      },
    });
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

  private withoutLiveLease() {
    return {
      OR: [
        { lockedBy: null },
        { heartbeatAt: null },
        { heartbeatAt: { lt: new Date(Date.now() - this.lockTimeoutMs) } },
      ],
    };
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

  private ownedBy(lease: MigrationLease) {
    const now = new Date();

    return { lockedBy: lease.token, lockedAt: now, heartbeatAt: now };
  }
}

function isActive(status: string): boolean {
  return ACTIVE_MIGRATION_STATUSES.some((active) => active === status);
}
