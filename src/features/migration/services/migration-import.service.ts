import { Inject, Injectable, Optional } from '@nestjs/common';
import { setTimeout as sleep } from 'node:timers/promises';
import type { TableMigration } from 'src/engine-prisma-types';
import { carriesLedgerMigrationId } from 'src/features/migration/migration-payload';
import {
  MIGRATION_DEFAULTS,
  MIGRATION_OPTIONS,
} from 'src/features/migration/migration.consts';
import { MigrationDrivers } from 'src/features/migration/services/migration-drivers';
import { MigrationTransitionService } from 'src/features/migration/services/migration-transition.service';
import { MigrationService } from 'src/features/migration/services/migration.service';
import type { MigrationOptions } from 'src/features/migration/types/migration-options.types';
import {
  ACTIVE_MIGRATION_STATUSES,
  isActiveMigrationStatus,
} from 'src/features/migration/types/migration.types';
import { PrismaService } from 'src/infrastructure/database/prisma.service';

export type EndedMigration = Pick<TableMigration, 'status' | 'errorMessage'>;

@Injectable()
export class MigrationImportService {
  private readonly pollIntervalMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly migrationService: MigrationService,
    private readonly transitions: MigrationTransitionService,
    private readonly drivers: MigrationDrivers,
    @Optional() @Inject(MIGRATION_OPTIONS) options?: MigrationOptions,
  ) {
    this.pollIntervalMs =
      options?.pollIntervalMs ?? MIGRATION_DEFAULTS.pollIntervalMs;
  }

  async findActiveImport(
    revisionId: string,
    ledgerMigrationId: string,
  ): Promise<string | undefined> {
    const active = await this.prisma.tableMigration.findFirst({
      where: { revisionId, status: { in: ACTIVE_MIGRATION_STATUSES } },
      select: { id: true, patches: true },
    });

    if (active && carriesLedgerMigrationId(active.patches, ledgerMigrationId)) {
      return active.id;
    }

    return undefined;
  }

  async driveUntilEnded(migrationId: string): Promise<EndedMigration | null> {
    for (;;) {
      const migration = await this.readMigration(migrationId);

      if (!migration || !isActiveMigrationStatus(migration.status)) {
        return migration;
      }

      await this.advance(migrationId);
      await sleep(this.pollIntervalMs);
    }
  }

  private readMigration(migrationId: string): Promise<EndedMigration | null> {
    return this.prisma.tableMigration.findUnique({
      where: { id: migrationId },
      select: { status: true, errorMessage: true },
    });
  }

  private async advance(migrationId: string): Promise<void> {
    if (await this.transitions.cancelIfStalled(migrationId)) {
      return;
    }

    this.claimUnlessDrivenLocally(migrationId);
    await this.takeOverIfStalled(migrationId);
  }

  private claimUnlessDrivenLocally(migrationId: string): void {
    if (this.drivers.isDriving(migrationId)) {
      return;
    }

    this.drivers.drive(migrationId, () =>
      this.migrationService.processUntilReleased(migrationId),
    );
  }

  private async takeOverIfStalled(migrationId: string): Promise<void> {
    const stalledOwner = await this.transitions.findStalledSwap(migrationId);

    if (stalledOwner) {
      this.drivers.drive(migrationId, () =>
        this.migrationService.takeOverStalledSwap(stalledOwner),
      );
    }
  }
}
