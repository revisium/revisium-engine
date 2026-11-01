import { Inject, Injectable, Optional } from '@nestjs/common';
import type { Prisma } from 'src/__generated__/client';
import {
  MIGRATION_DEFAULTS,
  MIGRATION_OPTIONS,
} from 'src/features/migration/migration.consts';
import {
  inRecoveryScope,
  newLease,
  RELEASED,
  replaceSwapOwner,
  type MigrationLease,
} from 'src/features/migration/services/migration-ownership';
import { MigrationRecoveryScope } from 'src/features/migration/services/migration-recovery-scope';
import type { MigrationOptions } from 'src/features/migration/types/migration-options.types';
import { MigrationStatus } from 'src/features/migration/types/migration.types';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

export interface OwnershipEpoch extends MigrationLease {
  lockedAt: Date;
}

const STALLED = 'STALLED: no progress within stallTimeoutMs';

@Injectable()
export class MigrationStallRecovery {
  private readonly stallTimeoutMs: number;
  private readonly swapBoundMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly recoveryScope: MigrationRecoveryScope,
    transactionService: TransactionPrismaService,
    @Optional() @Inject(MIGRATION_OPTIONS) options?: MigrationOptions,
  ) {
    this.stallTimeoutMs =
      options?.stallTimeoutMs ?? MIGRATION_DEFAULTS.stallTimeoutMs;
    this.swapBoundMs = Math.max(
      this.stallTimeoutMs,
      transactionService.serializableTimeoutMs *
        transactionService.serializableMaxAttempts,
    );
  }

  findStalledSwaps(): Promise<OwnershipEpoch[]> {
    return this.findStalledSwapsWhere(inRecoveryScope(this.recoveryScope));
  }

  async findStalledSwap(
    migrationId: string,
  ): Promise<OwnershipEpoch | undefined> {
    const [stalledOwner] = await this.findStalledSwapsWhere({
      id: migrationId,
    });

    return stalledOwner;
  }

  takeOver(stalledOwner: OwnershipEpoch): Promise<MigrationLease | null> {
    return replaceSwapOwner(
      this.prisma,
      {
        id: stalledOwner.migrationId,
        status: MigrationStatus.SWAPPING,
        lockedBy: stalledOwner.token,
        lockedAt: stalledOwner.lockedAt,
      },
      newLease(stalledOwner.migrationId),
    );
  }

  cancelStalled(): Promise<number> {
    return this.cancelStalledWhere(inRecoveryScope(this.recoveryScope));
  }

  async cancelIfStalled(migrationId: string): Promise<boolean> {
    return (await this.cancelStalledWhere({ id: migrationId })) === 1;
  }

  private async findStalledSwapsWhere(
    scope: Prisma.TableMigrationWhereInput,
  ): Promise<OwnershipEpoch[]> {
    const owners = await this.prisma.tableMigration.findMany({
      where: {
        ...scope,
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

  private async cancelStalledWhere(
    scope: Prisma.TableMigrationWhereInput,
  ): Promise<number> {
    const cancelled = await this.prisma.tableMigration.updateMany({
      where: {
        ...scope,
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
}
