import { Inject, Injectable, Optional } from '@nestjs/common';
import { nanoid } from 'nanoid';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import type { Prisma } from 'src/__generated__/client';
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
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';
import { MigrationRecoveryScope } from 'src/features/migration/services/migration-recovery-scope';

export interface MigrationLease {
  migrationId: string;
  token: string;
}

export interface OwnershipEpoch extends MigrationLease {
  lockedAt: Date;
}

export interface MigrationCheckpoint {
  copiedRows: number;
  lastCopiedRowId: string | null;
}

const STALLED = 'STALLED: no progress within stallTimeoutMs';
const SWAP_STALLED =
  'SWAP_STALLED: the swap did not complete within maxRetries claims and takeovers';

const RELEASED = { lockedBy: null, lockedAt: null };

type CopySource = Pick<
  TableMigration,
  'tableId' | 'sourceTableVersionId' | 'shadowTableVersionId' | 'startedAt'
>;

@Injectable()
export class MigrationTransitionService {
  private readonly workerId = `${hostname()}-${process.pid}`;
  private readonly lockTimeoutMs: number;
  private readonly stallTimeoutMs: number;
  private readonly swapBoundMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly recoveryScope: MigrationRecoveryScope,
    transactionService: TransactionPrismaService,
    @Optional() @Inject(MIGRATION_OPTIONS) options?: MigrationOptions,
  ) {
    this.lockTimeoutMs =
      options?.lockTimeoutMs ?? MIGRATION_DEFAULTS.lockTimeoutMs;
    this.stallTimeoutMs =
      options?.stallTimeoutMs ?? MIGRATION_DEFAULTS.stallTimeoutMs;
    this.swapBoundMs = Math.max(
      this.stallTimeoutMs,
      transactionService.serializableTimeoutMs *
        transactionService.serializableMaxAttempts,
    );
  }

  async findOldestClaimable(): Promise<string | null> {
    const migration = await this.prisma.tableMigration.findFirst({
      where: {
        ...this.inRecoveryScope(),
        status: { in: ACTIVE_MIGRATION_STATUSES },
        ...this.withoutLiveLease(),
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });

    return migration?.id ?? null;
  }

  async claim(migrationId: string): Promise<MigrationLease | null> {
    const migration = await this.prisma.tableMigration.findUnique({
      where: { id: migrationId },
      select: { status: true },
    });

    if (!migration || !isActive(migration.status)) {
      return null;
    }

    const lease = this.newLease(migrationId);

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

  async findStalledSwaps(): Promise<OwnershipEpoch[]> {
    const owners = await this.prisma.tableMigration.findMany({
      where: {
        ...this.inRecoveryScope(),
        status: MigrationStatus.SWAPPING,
        lockedBy: { not: null },
        ...this.withoutProgressWithin(this.swapBoundMs),
      },
      select: { id: true, lockedBy: true, lockedAt: true },
    });

    return owners.flatMap(({ id, lockedBy, lockedAt }) =>
      lockedBy && lockedAt
        ? [{ migrationId: id, token: lockedBy, lockedAt }]
        : [],
    );
  }

  takeOver(stalledOwner: OwnershipEpoch): Promise<MigrationLease | null> {
    return this.replaceSwapOwner(
      {
        id: stalledOwner.migrationId,
        status: MigrationStatus.SWAPPING,
        lockedBy: stalledOwner.token,
        lockedAt: stalledOwner.lockedAt,
      },
      this.newLease(stalledOwner.migrationId),
    );
  }

  async cancelStalled(): Promise<number> {
    const cancelled = await this.prisma.tableMigration.updateMany({
      where: {
        ...this.inRecoveryScope(),
        status: { in: [MigrationStatus.PENDING, MigrationStatus.COPYING] },
        ...this.withoutProgressWithin(this.stallTimeoutMs),
      },
      data: {
        status: MigrationStatus.CANCELLED,
        errorMessage: STALLED,
        completedAt: new Date(),
        ...RELEASED,
      },
    });

    return cancelled.count;
  }

  async findStillOwned(leases: MigrationLease[]): Promise<MigrationLease[]> {
    if (leases.length === 0) {
      return [];
    }

    const owned = await this.prisma.tableMigration.findMany({
      where: {
        status: { in: ACTIVE_MIGRATION_STATUSES },
        OR: leases.map((lease) => ({
          id: lease.migrationId,
          lockedBy: lease.token,
        })),
      },
      select: { lockedBy: true },
    });
    const ownedTokens = new Set(owned.map((record) => record.lockedBy));

    return leases.filter((lease) => ownedTokens.has(lease.token));
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

  async completeSwap(
    lease: MigrationLease,
    transaction: TransactionPrismaClient,
  ): Promise<boolean> {
    const deleted = await transaction.tableMigration.deleteMany({
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

  private claimSwap(lease: MigrationLease): Promise<MigrationLease | null> {
    return this.replaceSwapOwner(
      {
        id: lease.migrationId,
        status: MigrationStatus.SWAPPING,
        ...this.withoutLiveLease(),
      },
      lease,
    );
  }

  private async replaceSwapOwner(
    owner: Prisma.TableMigrationWhereInput,
    lease: MigrationLease,
  ): Promise<MigrationLease | null> {
    const replaced = await this.prisma.tableMigration.updateMany({
      where: {
        ...owner,
        retryCount: { lt: this.prisma.tableMigration.fields.maxRetries },
      },
      data: { ...this.ownedBy(lease), retryCount: { increment: 1 } },
    });

    if (replaced.count === 1) {
      return lease;
    }

    await this.failStalledSwap(owner);
    return null;
  }

  private async failStalledSwap(
    owner: Prisma.TableMigrationWhereInput,
  ): Promise<void> {
    await this.prisma.tableMigration.updateMany({
      where: {
        ...owner,
        retryCount: { gte: this.prisma.tableMigration.fields.maxRetries },
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

  private inRecoveryScope(): Prisma.TableMigrationWhereInput {
    const migrationIds = this.recoveryScope.restrictedTo();

    return migrationIds ? { id: { in: [...migrationIds] } } : {};
  }

  private withoutProgressWithin(timeoutMs: number) {
    const before = { lt: new Date(Date.now() - timeoutMs) };

    return {
      OR: [
        { lastProgressAt: before, lockedAt: before },
        { lastProgressAt: before, lockedAt: null },
        { lastProgressAt: null, lockedAt: before },
        { lastProgressAt: null, lockedAt: null, createdAt: before },
      ],
    };
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

  private newLease(migrationId: string): MigrationLease {
    return { migrationId, token: `${this.workerId}-${randomUUID()}` };
  }

  private ownedBy(lease: MigrationLease) {
    const now = new Date();

    return { lockedBy: lease.token, lockedAt: now, heartbeatAt: now };
  }
}

function isActive(status: string): boolean {
  return ACTIVE_MIGRATION_STATUSES.some((active) => active === status);
}
