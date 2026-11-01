import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import type { InputJsonValue, TableMigration } from 'src/engine-prisma-types';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';
import { MigrationBatchService } from 'src/features/migration/services/migration-batch.service';
import { MigrationSwapService } from 'src/features/migration/services/migration-swap.service';
import {
  MigrationTransitionService,
  type MigrationLease,
  type OwnershipEpoch,
} from 'src/features/migration/services/migration-transition.service';
import {
  MigrationStatus,
  type MigrationStepResult,
} from 'src/features/migration/types/migration.types';
import {
  decodeMigrationPayload,
  encodeMigrationPayload,
} from 'src/features/migration/migration-payload';
import { PermanentMigrationFailure } from 'src/features/migration/exceptions/permanent-migration-failure';
import { LeaseHeartbeat } from 'src/features/migration/services/lease-heartbeat';
import { HeldMigrationLeases } from 'src/features/migration/services/held-migration-leases';
import {
  MIGRATION_DEFAULTS,
  MIGRATION_OPTIONS,
} from 'src/features/migration/migration.consts';
import { JsonPatch, JsonSchema } from '@revisium/schema-toolkit/types';
import type { TransactionPrismaClient } from 'src/features/share/types';
import type { MigrationOptions } from 'src/features/migration/types/migration-options.types';

type ClaimedRunResult = MigrationStepResult | 'retry';

@Injectable()
export class MigrationService {
  private readonly logger = new Logger(MigrationService.name);

  private readonly options: Required<Omit<MigrationOptions, 'workerMode'>> & {
    workerMode: 'inline' | 'polling' | 'disabled';
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly transactionService: TransactionPrismaService,
    private readonly batchService: MigrationBatchService,
    private readonly swapService: MigrationSwapService,
    private readonly transitions: MigrationTransitionService,
    private readonly heldLeases: HeldMigrationLeases,
    @Optional() @Inject(MIGRATION_OPTIONS) migrationOptions?: MigrationOptions,
  ) {
    this.options = {
      threshold: migrationOptions?.threshold ?? MIGRATION_DEFAULTS.threshold,
      batchSize: migrationOptions?.batchSize ?? MIGRATION_DEFAULTS.batchSize,
      workerMode: migrationOptions?.workerMode ?? MIGRATION_DEFAULTS.workerMode,
      pollIntervalMs:
        migrationOptions?.pollIntervalMs ?? MIGRATION_DEFAULTS.pollIntervalMs,
      heartbeatIntervalMs:
        migrationOptions?.heartbeatIntervalMs ??
        MIGRATION_DEFAULTS.heartbeatIntervalMs,
      lockTimeoutMs:
        migrationOptions?.lockTimeoutMs ?? MIGRATION_DEFAULTS.lockTimeoutMs,
      stallTimeoutMs:
        migrationOptions?.stallTimeoutMs ?? MIGRATION_DEFAULTS.stallTimeoutMs,
      maxRetries: migrationOptions?.maxRetries ?? MIGRATION_DEFAULTS.maxRetries,
    };
  }

  get threshold() {
    return this.options.threshold;
  }

  get workerMode() {
    return this.options.workerMode;
  }

  async shouldUseAsyncMigration(tableVersionId: string): Promise<boolean> {
    const rowCount = await this.countRows(tableVersionId);
    return rowCount >= this.options.threshold;
  }

  async shouldUseAsyncMigrationByTableId(
    revisionId: string,
    tableId: string,
  ): Promise<boolean> {
    const table = await this.prisma.table.findFirst({
      where: {
        id: tableId,
        revisions: { some: { id: revisionId } },
      },
    });
    if (!table) {
      return false;
    }
    return this.shouldUseAsyncMigration(table.versionId);
  }

  async getTableVersionId(
    revisionId: string,
    tableId: string,
  ): Promise<string | null> {
    const table = await this.prisma.table.findFirst({
      where: {
        id: tableId,
        revisions: { some: { id: revisionId } },
      },
    });
    return table?.versionId ?? null;
  }

  async countRows(
    tableVersionId: string,
    client?: Pick<TransactionPrismaClient, 'row'>,
  ): Promise<number> {
    return (client ?? this.prisma).row.count({
      where: {
        tables: { some: { versionId: tableVersionId } },
      },
    });
  }

  async createMigrationRecord(data: {
    revisionId: string;
    tableId: string;
    sourceTableVersionId: string;
    patches: JsonPatch[];
    ledgerMigrationId?: string;
    previousSchema: InputJsonValue;
    previousSchemaHash: string;
    targetSchemaHash: string;
    totalRows: number;
  }): Promise<string> {
    const totalBatches = Math.ceil(data.totalRows / this.options.batchSize);

    const client = this.transactionService.getTransactionOrPrisma();
    await client.tableMigration.deleteMany({
      where: {
        revisionId: data.revisionId,
        tableId: data.tableId,
        status: {
          in: [MigrationStatus.FAILED, MigrationStatus.CANCELLED],
        },
      },
    });

    const migration = await client.tableMigration.create({
      data: {
        revisionId: data.revisionId,
        tableId: data.tableId,
        sourceTableVersionId: data.sourceTableVersionId,
        patches: encodeMigrationPayload(data.patches, data.ledgerMigrationId),
        previousSchema: data.previousSchema,
        previousSchemaHash: data.previousSchemaHash,
        targetSchemaHash: data.targetSchemaHash,
        totalRows: data.totalRows,
        batchSize: this.options.batchSize,
        totalBatches,
        maxRetries: this.options.maxRetries,
      },
    });

    return migration.id;
  }

  async processMigration(migrationId: string): Promise<MigrationStepResult> {
    return this.runUntilSettled(await this.claim(migrationId));
  }

  async processUntilReleased(
    migrationId: string,
  ): Promise<MigrationStepResult> {
    const lease = await this.claim(migrationId);

    if (!lease) {
      return 'stopped';
    }

    const result = await this.runClaimedMigration(lease);

    return result === 'retry' ? 'stopped' : result;
  }

  async takeOverStalledSwap(
    stalledOwner: OwnershipEpoch,
  ): Promise<MigrationStepResult> {
    return this.runUntilSettled(
      await this.heldLeases.acquire(() =>
        this.transitions.takeOver(stalledOwner),
      ),
    );
  }

  private claim(migrationId: string): Promise<MigrationLease | null> {
    return this.heldLeases.acquire(() => this.transitions.claim(migrationId));
  }

  private async runUntilSettled(
    firstLease: MigrationLease | null,
  ): Promise<MigrationStepResult> {
    let lease = firstLease;

    while (lease) {
      const result = await this.runClaimedMigration(lease);

      if (result !== 'retry') {
        return result;
      }

      lease = await this.claim(lease.migrationId);
    }

    return 'stopped';
  }

  private async runClaimedMigration(
    lease: MigrationLease,
  ): Promise<ClaimedRunResult> {
    const heartbeat = new LeaseHeartbeat(
      () => this.transitions.renew(lease),
      this.options.heartbeatIntervalMs,
      (error) => this.logHeartbeatFailure(lease, error),
    );

    try {
      return await this.runSteps(lease);
    } finally {
      heartbeat.stop();
      this.heldLeases.release(lease);
      await this.transitions.release(lease);
    }
  }

  private async runSteps(lease: MigrationLease): Promise<ClaimedRunResult> {
    for (;;) {
      const result = await this.runNextStep(lease);

      if (result !== 'continue') {
        return result;
      }
    }
  }

  private async runNextStep(lease: MigrationLease): Promise<ClaimedRunResult> {
    try {
      const migration = await this.transitions.findOwned(lease);

      if (!migration) {
        return 'stopped';
      }

      return await this.runStep(lease, migration);
    } catch (error) {
      return this.handleStepFailure(lease, error);
    }
  }

  private runStep(
    lease: MigrationLease,
    migration: TableMigration,
  ): Promise<MigrationStepResult> {
    switch (migration.status) {
      case MigrationStatus.PENDING:
        return this.startCopy(lease, migration);
      case MigrationStatus.COPYING:
        return migration.copiedRows < migration.totalRows
          ? this.copyNextBatch(lease, migration)
          : this.startSwap(lease);
      case MigrationStatus.SWAPPING:
        return this.swapService.swap(lease, migration);
      default:
        return Promise.resolve('stopped');
    }
  }

  private async handleStepFailure(
    lease: MigrationLease,
    error: unknown,
  ): Promise<ClaimedRunResult> {
    const message = error instanceof Error ? error.message : String(error);

    if (error instanceof PermanentMigrationFailure) {
      return this.failMigration(lease, message);
    }

    if (await this.transitions.retry(lease)) {
      this.logger.warn(
        `Migration ${lease.migrationId} failed, retrying: ${message}`,
      );
      return 'retry';
    }

    return this.failMigration(lease, message);
  }

  private async failMigration(
    lease: MigrationLease,
    message: string,
  ): Promise<MigrationStepResult> {
    if (!(await this.transitions.fail(lease, message))) {
      return 'stopped';
    }

    this.logger.error(`Migration ${lease.migrationId} failed: ${message}`);
    return 'failed';
  }

  private logHeartbeatFailure(lease: MigrationLease, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.error(`Heartbeat failed for ${lease.migrationId}: ${message}`);
  }

  private async startCopy(
    lease: MigrationLease,
    migration: TableMigration,
  ): Promise<MigrationStepResult> {
    const started = await this.transitions.beginCopy(lease, migration);

    return started ? 'continue' : 'stopped';
  }

  private async copyNextBatch(
    lease: MigrationLease,
    migration: TableMigration,
  ): Promise<MigrationStepResult> {
    const { patches } = decodeMigrationPayload(migration.patches);
    const shadowTableVersionId = this.requireShadowTable(migration);
    const rows = await this.batchService.loadBatchRows(
      migration.sourceTableVersionId,
      migration.lastCopiedRowId,
      migration.batchSize,
    );
    const lastRow = rows.at(-1);

    if (!lastRow) {
      throw new Error(
        `Row count mismatch: expected ${migration.totalRows}, got ${migration.copiedRows}`,
      );
    }

    const migrated = await this.batchService.migrateAndProcessBatch(
      rows,
      patches,
      migration.previousSchema as unknown as JsonSchema,
      migration.revisionId,
      migration.tableId,
    );
    await this.batchService.validateMigratedRows(migration, migrated);
    const written = await this.batchService.writeBatch(lease, {
      revisionId: migration.revisionId,
      tableId: migration.tableId,
      shadowTableVersionId,
      targetSchema: migrated.targetSchema,
      targetSchemaHash: migration.targetSchemaHash,
      from: {
        copiedRows: migration.copiedRows,
        lastCopiedRowId: migration.lastCopiedRowId,
      },
      to: {
        copiedRows: migration.copiedRows + rows.length,
        lastCopiedRowId: lastRow.id,
      },
      rows: migrated.rows,
    });

    return written ? 'continue' : 'stopped';
  }

  private async startSwap(lease: MigrationLease): Promise<MigrationStepResult> {
    const begun = await this.transitions.beginSwap(lease);

    return begun ? 'continue' : 'stopped';
  }

  private requireShadowTable(migration: TableMigration): string {
    if (!migration.shadowTableVersionId) {
      throw new Error(`Shadow table not set for migration ${migration.id}`);
    }

    return migration.shadowTableVersionId;
  }
}
