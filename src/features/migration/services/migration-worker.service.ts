import {
  Injectable,
  Inject,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import { MigrationService } from 'src/features/migration/services/migration.service';
import { MigrationStallRecovery } from 'src/features/migration/services/migration-stall-recovery';
import { MigrationLeases } from 'src/features/migration/services/migration-leases';
import { LegacyMigrationDisposalService } from 'src/features/migration/services/legacy-migration-disposal.service';
import { HeldMigrationLeases } from 'src/features/migration/services/held-migration-leases';
import { MigrationDrivers } from 'src/features/migration/services/migration-drivers';
import {
  MIGRATION_DEFAULTS,
  MIGRATION_OPTIONS,
} from 'src/features/migration/migration.consts';
import type { MigrationOptions } from 'src/features/migration/types/migration-options.types';

@Injectable()
export class MigrationWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MigrationWorkerService.name);
  private readonly workerMode: 'inline' | 'polling' | 'disabled';
  private readonly pollIntervalMs: number;

  private sweepTimer?: ReturnType<typeof setInterval>;
  private runningSweep?: Promise<void>;
  private isShuttingDown = false;

  constructor(
    private readonly migrationService: MigrationService,
    private readonly stallRecovery: MigrationStallRecovery,
    private readonly leases: MigrationLeases,
    private readonly legacyMigrations: LegacyMigrationDisposalService,
    private readonly heldLeases: HeldMigrationLeases,
    private readonly drivers: MigrationDrivers,
    @Optional() @Inject(MIGRATION_OPTIONS) migrationOptions?: MigrationOptions,
  ) {
    this.workerMode =
      migrationOptions?.workerMode ?? MIGRATION_DEFAULTS.workerMode;
    this.pollIntervalMs =
      migrationOptions?.pollIntervalMs ?? MIGRATION_DEFAULTS.pollIntervalMs;
  }

  async onModuleInit() {
    await this.legacyMigrations.dispose();

    if (this.workerMode !== 'disabled') {
      this.startSweeping();
    }
  }

  async onModuleDestroy() {
    this.isShuttingDown = true;
    this.stopSweeping();
    await Promise.all([this.runningSweep, this.drivers.stop()]);
  }

  async triggerInline(migrationId: string): Promise<void> {
    if (this.workerMode === 'disabled') {
      this.logger.log(
        `Worker disabled, migration ${migrationId} must be processed externally`,
      );
      return;
    }

    if (this.workerMode === 'inline') {
      this.drivers.driveUnlessDriven(migrationId, () =>
        this.migrationService.processMigration(migrationId),
      );
    }
  }

  private startSweeping() {
    this.logger.log(
      `Sweeping migrations every ${this.pollIntervalMs}ms in ${this.workerMode} mode`,
    );
    this.sweepTimer = setInterval(() => {
      this.sweepUnlessRunning();
    }, this.pollIntervalMs);
  }

  private stopSweeping() {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = undefined;
    }
  }

  private sweepUnlessRunning() {
    if (this.isShuttingDown || this.runningSweep) {
      return;
    }

    this.runningSweep = this.sweepLoggingFailure().finally(() => {
      this.runningSweep = undefined;
    });
  }

  private async sweepLoggingFailure() {
    try {
      await this.sweep();
    } catch (error) {
      this.logger.error(`Migration sweep failed: ${messageOf(error)}`);
    }
  }

  private async sweep() {
    await this.cancelStalledMigrations();
    await this.takeOverStalledSwaps();
    await this.claimAbandonedMigration();
  }

  private async cancelStalledMigrations() {
    const cancelled = await this.stallRecovery.cancelStalled();

    if (cancelled > 0) {
      this.logger.warn(`Cancelled ${cancelled} stalled migration(s)`);
    }
  }

  private async takeOverStalledSwaps() {
    for (const stalledOwner of await this.stallRecovery.findStalledSwaps()) {
      this.drivers.driveTakeover(stalledOwner.migrationId, () =>
        this.migrationService.takeOverStalledSwap(stalledOwner),
      );
    }
  }

  private async claimAbandonedMigration() {
    if (await this.ownsAnyMigration()) {
      return;
    }

    const migrationId = await this.leases.findOldestClaimable();

    if (migrationId && this.heldLeases.isEmpty) {
      this.drivers.driveUnlessDriven(migrationId, () =>
        this.migrationService.processMigration(migrationId),
      );
    }
  }

  private async ownsAnyMigration(): Promise<boolean> {
    const held = this.heldLeases.list();
    const owned = await this.leases.findStillOwned(held);

    for (const lost of held.filter((lease) => !owned.includes(lease))) {
      this.heldLeases.release(lost);
    }

    return !this.heldLeases.isEmpty;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
