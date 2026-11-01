import { Inject, Injectable, Optional } from '@nestjs/common';
import type { TableMigration } from 'src/engine-prisma-types';
import {
  MIGRATION_DEFAULTS,
  MIGRATION_OPTIONS,
} from 'src/features/migration/migration.consts';
import {
  inRecoveryScope,
  newLease,
  ownedBy,
  RELEASED,
  replaceSwapOwner,
  type MigrationLease,
} from 'src/features/migration/services/migration-ownership';
import {
  MIGRATION_RECOVERY_TEST_SCOPE,
  type MigrationRecoveryTestScope,
} from 'src/features/migration/services/migration-recovery-test-scope';
import type { MigrationOptions } from 'src/features/migration/types/migration-options.types';
import {
  ACTIVE_MIGRATION_STATUSES,
  isActiveMigrationStatus,
  MigrationStatus,
} from 'src/features/migration/types/migration.types';
import { PrismaService } from 'src/infrastructure/database/prisma.service';

@Injectable()
export class MigrationLeases {
  private readonly lockTimeoutMs: number;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(MIGRATION_OPTIONS) options?: MigrationOptions,
    @Optional()
    @Inject(MIGRATION_RECOVERY_TEST_SCOPE)
    private readonly testScope?: MigrationRecoveryTestScope,
  ) {
    this.lockTimeoutMs =
      options?.lockTimeoutMs ?? MIGRATION_DEFAULTS.lockTimeoutMs;
  }

  async findOldestClaimable(): Promise<string | null> {
    const migration = await this.prisma.tableMigration.findFirst({
      where: {
        ...inRecoveryScope(this.testScope),
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

    if (!migration || !isActiveMigrationStatus(migration.status)) {
      return null;
    }

    const lease = newLease(migrationId);

    if (migration.status === MigrationStatus.SWAPPING) {
      return this.claimSwap(lease);
    }

    const claimed = await this.prisma.tableMigration.updateMany({
      where: {
        id: migrationId,
        status: migration.status,
        ...this.withoutLiveLease(),
      },
      data: ownedBy(lease),
    });

    return claimed.count === 1 ? lease : null;
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

  private claimSwap(lease: MigrationLease): Promise<MigrationLease | null> {
    return replaceSwapOwner(
      this.prisma,
      {
        id: lease.migrationId,
        status: MigrationStatus.SWAPPING,
        ...this.withoutLiveLease(),
      },
      lease,
    );
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
}
