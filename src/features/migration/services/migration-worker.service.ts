import {
  Injectable,
  Inject,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import { MigrationService } from 'src/features/migration/services/migration.service';
import { MigrationTransitionService } from 'src/features/migration/services/migration-transition.service';
import { LegacyMigrationDisposalService } from 'src/features/migration/services/legacy-migration-disposal.service';
import type { MigrationStepResult } from 'src/features/migration/types/migration.types';
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
  private readonly drivers = new Set<Promise<void>>();

  private sweepTimer?: ReturnType<typeof setInterval>;
  private runningSweep?: Promise<void>;
  private isShuttingDown = false;

  constructor(
    private readonly migrationService: MigrationService,
    private readonly transitions: MigrationTransitionService,
    private readonly legacyMigrations: LegacyMigrationDisposalService,
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
    await this.runningSweep;
    await Promise.allSettled(this.drivers);
  }

  async triggerInline(migrationId: string): Promise<void> {
    if (this.workerMode === 'disabled') {
      this.logger.log(
        `Worker disabled, migration ${migrationId} must be processed externally`,
      );
      return;
    }

    if (this.workerMode === 'inline') {
      this.drive(migrationId, () =>
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
    const cancelled = await this.transitions.cancelStalled();

    if (cancelled > 0) {
      this.logger.warn(`Cancelled ${cancelled} stalled migration(s)`);
    }
  }

  private async takeOverStalledSwaps() {
    for (const stalledOwner of await this.transitions.findStalledSwaps()) {
      this.drive(stalledOwner.migrationId, () =>
        this.migrationService.takeOverStalledSwap(stalledOwner),
      );
    }
  }

  private async claimAbandonedMigration() {
    if (this.drivers.size > 0) {
      return;
    }

    const migrationId = await this.transitions.findOldestClaimable();

    if (migrationId) {
      this.drive(migrationId, () =>
        this.migrationService.processMigration(migrationId),
      );
    }
  }

  private drive(migrationId: string, run: () => Promise<MigrationStepResult>) {
    if (this.isShuttingDown) {
      return;
    }

    const driver = this.runLoggingFailure(migrationId, run).finally(() => {
      this.drivers.delete(driver);
    });
    this.drivers.add(driver);
  }

  private async runLoggingFailure(
    migrationId: string,
    run: () => Promise<MigrationStepResult>,
  ) {
    try {
      await run();
    } catch (error) {
      this.logger.error(`Migration ${migrationId} failed: ${messageOf(error)}`);
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
