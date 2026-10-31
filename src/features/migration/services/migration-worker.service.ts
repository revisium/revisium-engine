import {
  Injectable,
  Inject,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { MigrationService } from 'src/features/migration/services/migration.service';
import { MigrationTransitionService } from 'src/features/migration/services/migration-transition.service';
import { MigrationStatus } from 'src/features/migration/types/migration.types';
import {
  MIGRATION_DEFAULTS,
  MIGRATION_OPTIONS,
} from 'src/features/migration/migration.consts';
import type { MigrationOptions } from 'src/features/migration/types/migration-options.types';

@Injectable()
export class MigrationWorkerService implements OnModuleInit, OnModuleDestroy {
  private static inlineRecoveryPromise?: Promise<void>;

  private readonly logger = new Logger(MigrationWorkerService.name);
  private readonly workerMode: 'inline' | 'polling' | 'disabled';
  private readonly pollIntervalMs: number;
  private readonly lockTimeoutMs: number;
  private readonly stallTimeoutMs: number;

  private pollingTimer?: ReturnType<typeof setInterval>;
  private activeMigrationId?: string;
  private activeProcessingPromise?: Promise<void>;
  private isShuttingDown = false;
  private pollingInProgress = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly migrationService: MigrationService,
    private readonly transitions: MigrationTransitionService,
    @Optional() @Inject(MIGRATION_OPTIONS) migrationOptions?: MigrationOptions,
  ) {
    this.workerMode =
      migrationOptions?.workerMode ?? MIGRATION_DEFAULTS.workerMode;
    this.pollIntervalMs =
      migrationOptions?.pollIntervalMs ?? MIGRATION_DEFAULTS.pollIntervalMs;
    this.lockTimeoutMs =
      migrationOptions?.lockTimeoutMs ?? MIGRATION_DEFAULTS.lockTimeoutMs;
    this.stallTimeoutMs =
      migrationOptions?.stallTimeoutMs ?? MIGRATION_DEFAULTS.stallTimeoutMs;
  }

  async onModuleInit() {
    if (this.workerMode === 'inline') {
      await this.resumeInlineMigrationsOnce();
      return;
    }

    if (this.workerMode === 'polling') {
      this.startPolling();
    }
  }

  async onModuleDestroy() {
    this.isShuttingDown = true;
    this.stopPolling();

    try {
      if (this.activeProcessingPromise) {
        await this.activeProcessingPromise;
      }
    } finally {
      MigrationWorkerService.inlineRecoveryPromise = undefined;
    }
  }

  async triggerInline(migrationId: string): Promise<void> {
    if (this.workerMode === 'disabled') {
      this.logger.log(
        `Worker disabled, migration ${migrationId} must be processed externally`,
      );
      return;
    }

    if (this.workerMode === 'inline') {
      this.runInlineMigration(migrationId);
    }
  }

  private async resumeInlineMigrations() {
    const migrationIds = await this.transitions.findClaimable();

    for (const migrationId of migrationIds) {
      await this.runMigration(migrationId);
    }
  }

  private async resumeInlineMigrationsOnce() {
    if (!MigrationWorkerService.inlineRecoveryPromise) {
      const recoveryPromise = this.resumeInlineMigrations();
      MigrationWorkerService.inlineRecoveryPromise = recoveryPromise.catch(
        (error) => {
          MigrationWorkerService.inlineRecoveryPromise = undefined;
          throw error;
        },
      );
    }

    await MigrationWorkerService.inlineRecoveryPromise;
  }

  private runInlineMigration(migrationId: string) {
    this.runMigration(migrationId).catch((err) => {
      this.logger.error(
        `Inline migration ${migrationId} failed: ${err.message}`,
      );
    });
  }

  private startPolling() {
    this.logger.log(
      `Starting migration worker in polling mode (interval: ${this.pollIntervalMs}ms)`,
    );
    this.pollingTimer = setInterval(() => {
      this.pollForWork().catch((err) => {
        this.logger.error(`Polling error: ${err.message}`);
      });
    }, this.pollIntervalMs);
  }

  private stopPolling() {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = undefined;
    }
  }

  private async pollForWork() {
    if (
      this.isShuttingDown ||
      this.activeMigrationId ||
      this.pollingInProgress
    ) {
      return;
    }

    this.pollingInProgress = true;

    try {
      await this.autoAbortStalledMigrations();

      const [migrationId] = await this.transitions.findClaimable(1);
      if (!migrationId) {
        return;
      }

      await this.runMigration(migrationId);
    } finally {
      this.pollingInProgress = false;
    }
  }

  private async runMigration(migrationId: string) {
    const processingPromise = this.processLoggingFailure(migrationId);
    this.activeProcessingPromise = processingPromise;

    try {
      await processingPromise;
    } finally {
      if (this.activeProcessingPromise === processingPromise) {
        this.activeProcessingPromise = undefined;
      }
    }
  }

  private async processLoggingFailure(migrationId: string) {
    this.activeMigrationId = migrationId;

    try {
      await this.migrationService.processMigration(migrationId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Migration ${migrationId} failed: ${msg}`);
    } finally {
      this.activeMigrationId = undefined;
    }
  }

  private async autoAbortStalledMigrations() {
    const stallThreshold = new Date(Date.now() - this.stallTimeoutMs);
    const staleHeartbeatThreshold = new Date(Date.now() - this.lockTimeoutMs);

    const result = await this.prisma.tableMigration.updateMany({
      where: {
        status: { in: [MigrationStatus.PENDING, MigrationStatus.COPYING] },
        lastProgressAt: { lt: stallThreshold },
        OR: [
          { lockedBy: null },
          { heartbeatAt: { lt: staleHeartbeatThreshold } },
        ],
      },
      data: {
        status: MigrationStatus.CANCELLED,
        errorMessage: 'Auto-aborted: no progress within stall timeout',
        completedAt: new Date(),
        lockedBy: null,
        lockedAt: null,
      },
    });

    if (result.count > 0) {
      this.logger.warn(`Auto-aborted ${result.count} stalled migration(s)`);
    }
  }
}
