import {
  Injectable,
  Inject,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { MigrationService } from 'src/features/migration/services/migration.service';
import { MigrationProgressService } from 'src/features/migration/services/migration-progress.service';
import {
  MigrationStatus,
  ACTIVE_MIGRATION_STATUSES,
} from 'src/features/migration/types/migration.types';
import {
  MIGRATION_DEFAULTS,
  MIGRATION_OPTIONS,
  WORKER_ID_SUFFIX_LENGTH,
} from 'src/features/migration/migration.consts';
import type { MigrationOptions } from 'src/app.module';

@Injectable()
export class MigrationWorkerService implements OnModuleInit, OnModuleDestroy {
  private static inlineRecoveryPromise?: Promise<void>;

  private readonly logger = new Logger(MigrationWorkerService.name);
  private readonly workerId: string;
  private readonly workerMode: 'inline' | 'polling' | 'disabled';
  private readonly pollIntervalMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly lockTimeoutMs: number;
  private readonly stallTimeoutMs: number;

  private pollingTimer?: ReturnType<typeof setInterval>;
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private activeMigrationId?: string;
  private isShuttingDown = false;
  private pollingInProgress = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly migrationService: MigrationService,
    private readonly progressService: MigrationProgressService,
    @Optional() @Inject(MIGRATION_OPTIONS) migrationOptions?: MigrationOptions,
  ) {
    this.workerId = `${hostname()}-${process.pid}-${randomUUID().slice(0, WORKER_ID_SUFFIX_LENGTH)}`;
    this.workerMode =
      migrationOptions?.workerMode ?? MIGRATION_DEFAULTS.workerMode;
    this.pollIntervalMs =
      migrationOptions?.pollIntervalMs ?? MIGRATION_DEFAULTS.pollIntervalMs;
    this.heartbeatIntervalMs =
      migrationOptions?.heartbeatIntervalMs ??
      MIGRATION_DEFAULTS.heartbeatIntervalMs;
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
      await this.releaseStaleLocks();
      this.startPolling();
    }
  }

  async onModuleDestroy() {
    this.isShuttingDown = true;
    this.stopPolling();
    this.stopHeartbeat();

    if (this.activeMigrationId) {
      await this.releaseLock(this.activeMigrationId);
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
    for (;;) {
      const migration = await this.acquirePendingMigration();
      if (!migration) {
        return;
      }

      await this.processAcquiredMigration(migration.id);
    }
  }

  private async resumeInlineMigrationsOnce() {
    MigrationWorkerService.inlineRecoveryPromise ??=
      this.resumeInlineMigrations();

    await MigrationWorkerService.inlineRecoveryPromise;
  }

  private async canResumeInlineMigration(migration: {
    id: string;
    sourceTableVersionId: string;
  }) {
    const sourceTable = await this.prisma.table.findUnique({
      where: { versionId: migration.sourceTableVersionId },
      select: { versionId: true },
    });

    if (sourceTable) {
      return true;
    }

    const errorMessage =
      'Recovery aborted: source table not found for active migration';
    this.logger.warn(`${errorMessage} ${migration.id}`);
    await this.progressService.setFailed(migration.id, errorMessage);

    return false;
  }

  private runInlineMigration(migrationId: string) {
    this.migrationService.processMigration(migrationId).catch((err) => {
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

      const migration = await this.acquirePendingMigration();
      if (!migration) {
        return;
      }

      await this.processAcquiredMigration(migration.id);
    } finally {
      this.pollingInProgress = false;
    }
  }

  private async acquirePendingMigration() {
    const staleThreshold = new Date(Date.now() - this.lockTimeoutMs);

    const result = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
      `UPDATE "TableMigration"
       SET "lockedBy" = $1, "lockedAt" = NOW(), "heartbeatAt" = NOW()
       WHERE id = (
         SELECT id FROM "TableMigration"
         WHERE status IN ('PENDING', 'COPYING', 'SWAPPING')
         AND ("lockedBy" IS NULL OR "heartbeatAt" IS NULL OR "heartbeatAt" < $2)
         ORDER BY "createdAt" ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING id`,
      this.workerId,
      staleThreshold,
    );

    return result[0] ?? null;
  }

  private startHeartbeat(migrationId: string) {
    this.heartbeatTimer = setInterval(() => {
      this.prisma.tableMigration
        .update({
          where: { id: migrationId },
          data: { heartbeatAt: new Date() },
        })
        .catch((err: Error) => {
          this.logger.error(
            `Heartbeat failed for ${migrationId}: ${err.message}`,
          );
        });
    }, this.heartbeatIntervalMs);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  private async releaseLock(migrationId: string) {
    await this.prisma.tableMigration
      .update({
        where: { id: migrationId },
        data: { lockedBy: null, lockedAt: null },
      })
      .catch(() => {});
  }

  private async processAcquiredMigration(migrationId: string) {
    const migration = await this.prisma.tableMigration.findUnique({
      where: { id: migrationId },
      select: { id: true, sourceTableVersionId: true },
    });

    if (!migration) {
      await this.releaseLock(migrationId);
      return;
    }

    if (!(await this.canResumeInlineMigration(migration))) {
      await this.releaseLock(migrationId);
      return;
    }

    this.activeMigrationId = migration.id;
    this.startHeartbeat(migration.id);

    try {
      await this.migrationService.processMigration(migration.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Migration ${migration.id} failed: ${msg}`);
    } finally {
      this.stopHeartbeat();
      await this.releaseLock(migration.id);
      this.activeMigrationId = undefined;
    }
  }

  private async releaseStaleLocks() {
    const staleThreshold = new Date(Date.now() - this.lockTimeoutMs);

    const result = await this.prisma.tableMigration.updateMany({
      where: {
        lockedBy: { not: null },
        heartbeatAt: { lt: staleThreshold },
        status: { in: [...ACTIVE_MIGRATION_STATUSES] },
      },
      data: {
        lockedBy: null,
        lockedAt: null,
      },
    });

    if (result.count > 0) {
      this.logger.log(`Released ${result.count} stale migration locks on init`);
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
