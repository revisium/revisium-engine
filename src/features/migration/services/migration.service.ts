import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import type { InputJsonValue, TableMigration } from 'src/engine-prisma-types';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';
import { JsonSchemaStoreService } from 'src/features/share/json-schema-store.service';
import { MigrationBatchService } from 'src/features/migration/services/migration-batch.service';
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
import { SchemaTable } from '@revisium/schema-toolkit/lib';
import { JsonPatch, JsonSchema } from '@revisium/schema-toolkit/types';
import type { TransactionPrismaClient } from 'src/features/share/types';
import type { MigrationOptions } from 'src/features/migration/types/migration-options.types';
import objectHash from 'object-hash';
import { JsonSchemaValidatorService } from 'src/features/share/json-schema-validator.service';
import { ViewsMigrationService } from 'src/features/share/views-migration.service';
import { tableViewsSchema } from 'src/features/share/schema/table-views-schema';
import { SystemTables } from 'src/features/share/system-tables.consts';
import type { TableViewsData } from 'src/features/views/types';

type ClaimedRunResult = MigrationStepResult | 'retry';

@Injectable()
export class MigrationService {
  private readonly logger = new Logger(MigrationService.name);
  private readonly viewsSchemaHash: string;

  private readonly options: Required<Omit<MigrationOptions, 'workerMode'>> & {
    workerMode: 'inline' | 'polling' | 'disabled';
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly transactionService: TransactionPrismaService,
    private readonly jsonSchemaStore: JsonSchemaStoreService,
    private readonly jsonSchemaValidator: JsonSchemaValidatorService,
    private readonly viewsMigrationService: ViewsMigrationService,
    private readonly batchService: MigrationBatchService,
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
    this.viewsSchemaHash =
      this.jsonSchemaValidator.getSchemaHash(tableViewsSchema);
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
        patches: encodeMigrationPayload(data.patches),
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
    return this.runUntilSettled(await this.transitions.claim(migrationId));
  }

  async takeOverStalledSwap(
    stalledOwner: OwnershipEpoch,
  ): Promise<MigrationStepResult> {
    return this.runUntilSettled(await this.transitions.takeOver(stalledOwner));
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

      lease = await this.transitions.claim(lease.migrationId);
    }

    return 'stopped';
  }

  private async runClaimedMigration(
    lease: MigrationLease,
  ): Promise<ClaimedRunResult> {
    this.heldLeases.hold(lease);
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
          : this.startSwap(lease, migration);
      case MigrationStatus.SWAPPING:
        return this.swap(lease, migration);
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

    const migratedRows = await this.batchService.migrateAndProcessBatch(
      rows,
      patches,
      migration.previousSchema as unknown as JsonSchema,
      migration.revisionId,
      migration.tableId,
    );
    const written = await this.batchService.writeBatch(lease, {
      shadowTableVersionId,
      targetSchemaHash: migration.targetSchemaHash,
      from: {
        copiedRows: migration.copiedRows,
        lastCopiedRowId: migration.lastCopiedRowId,
      },
      to: {
        copiedRows: migration.copiedRows + rows.length,
        lastCopiedRowId: lastRow.id,
      },
      rows: migratedRows,
    });

    return written ? 'continue' : 'stopped';
  }

  private async startSwap(
    lease: MigrationLease,
    migration: TableMigration,
  ): Promise<MigrationStepResult> {
    await this.verifyShadowRowCount(migration);
    const begun = await this.transitions.beginSwap(lease);

    return begun ? 'continue' : 'stopped';
  }

  private async verifyShadowRowCount(migration: TableMigration): Promise<void> {
    const shadowRowCount = await this.countRows(
      this.requireShadowTable(migration),
    );

    if (shadowRowCount !== migration.totalRows) {
      throw new Error(
        `Row count mismatch: expected ${migration.totalRows}, got ${shadowRowCount}`,
      );
    }
  }

  private requireShadowTable(migration: TableMigration): string {
    if (!migration.shadowTableVersionId) {
      throw new Error(`Shadow table not set for migration ${migration.id}`);
    }

    return migration.shadowTableVersionId;
  }

  private async swap(
    lease: MigrationLease,
    migration: TableMigration,
  ): Promise<MigrationStepResult> {
    const { patches } = decodeMigrationPayload(migration.patches);
    const shadowTableVersionId = this.requireShadowTable(migration);

    const swapped = await this.transactionService.runSerializable(async () => {
      const tx = this.transactionService.getTransaction();

      if (!(await this.transitions.lockSwap(lease, tx))) {
        return false;
      }

      await tx.table.update({
        where: { versionId: migration.sourceTableVersionId },
        data: {
          revisions: {
            disconnect: { id: migration.revisionId },
          },
        },
      });

      await tx.table.update({
        where: { versionId: shadowTableVersionId },
        data: {
          revisions: {
            connect: { id: migration.revisionId },
          },
        },
      });

      await tx.revision.update({
        where: { id: migration.revisionId },
        data: { hasChanges: true },
      });

      await this.updateSchemaRowInTx(tx, migration, patches);
      await this.updateViewsRowInTx(tx, migration, patches);
      await this.deleteSwappedRecord(lease, tx);

      return true;
    });

    if (!swapped) {
      return 'stopped';
    }

    this.logger.log(`Migration ${lease.migrationId} completed successfully`);
    return 'completed';
  }

  private async deleteSwappedRecord(
    lease: MigrationLease,
    tx: TransactionPrismaClient,
  ): Promise<void> {
    if (!(await this.transitions.completeSwap(lease, tx))) {
      throw new Error(
        `Migration ${lease.migrationId} lost its record inside its own swap`,
      );
    }
  }

  private async updateSchemaRowInTx(
    tx: ReturnType<TransactionPrismaService['getTransaction']>,
    migration: { revisionId: string; tableId: string },
    patches: JsonPatch[],
  ) {
    const schemaTable = await tx.table.findFirst({
      where: {
        id: 'revisium_schema_table',
        revisions: { some: { id: migration.revisionId } },
      },
    });
    if (!schemaTable) {
      return;
    }

    const schemaRow = await tx.row.findFirst({
      where: {
        id: migration.tableId,
        tables: { some: { versionId: schemaTable.versionId } },
      },
    });
    if (!schemaRow) {
      return;
    }

    const currentSchema = schemaRow.data as unknown as JsonSchema;
    const st = new SchemaTable(currentSchema, this.jsonSchemaStore.refs);
    st.applyPatches(patches);
    const targetSchema = st.getSchema();

    await tx.row.update({
      where: { versionId: schemaRow.versionId },
      data: {
        data: targetSchema as InputJsonValue,
        hash: objectHash(targetSchema as objectHash.NotUndefined),
        updatedAt: new Date(),
      },
    });
  }

  private async updateViewsRowInTx(
    tx: ReturnType<TransactionPrismaService['getTransaction']>,
    migration: {
      revisionId: string;
      tableId: string;
      previousSchema: unknown;
    },
    patches: JsonPatch[],
  ) {
    const viewsTable = await tx.table.findFirst({
      where: {
        id: SystemTables.Views,
        revisions: { some: { id: migration.revisionId } },
      },
    });

    if (!viewsTable) {
      return;
    }

    const viewsRow = await tx.row.findFirst({
      where: {
        id: migration.tableId,
        tables: { some: { versionId: viewsTable.versionId } },
      },
    });

    if (!viewsRow) {
      return;
    }

    const migratedViewsData = this.viewsMigrationService.migrateViews(
      {
        viewsData: viewsRow.data as unknown as TableViewsData,
        patches,
        previousSchema: migration.previousSchema as JsonSchema,
      },
      { revisionId: migration.revisionId, tableId: migration.tableId },
    );

    await tx.row.update({
      where: { versionId: viewsRow.versionId },
      data: {
        data: migratedViewsData as unknown as InputJsonValue,
        hash: objectHash(migratedViewsData),
        schemaHash: this.viewsSchemaHash,
        updatedAt: new Date(),
      },
    });
  }
}
