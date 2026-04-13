import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import { nanoid } from 'nanoid';
import { type InputJsonValue } from 'src/engine-prisma-types';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';
import { JsonSchemaStoreService } from 'src/features/share/json-schema-store.service';
import { MigrationBatchService } from 'src/features/migration/services/migration-batch.service';
import { MigrationProgressService } from 'src/features/migration/services/migration-progress.service';
import {
  MigrationPhase,
  MigrationStatus,
} from 'src/features/migration/types/migration.types';
import {
  MIGRATION_DEFAULTS,
  MIGRATION_OPTIONS,
} from 'src/features/migration/migration.consts';
import { SchemaTable } from '@revisium/schema-toolkit/lib';
import { JsonPatch, JsonSchema } from '@revisium/schema-toolkit/types';
import type { MigrationOptions } from 'src/app.module';
import objectHash from 'object-hash';
import { JsonSchemaValidatorService } from 'src/features/share/json-schema-validator.service';
import { ViewsMigrationService } from 'src/features/share/views-migration.service';
import { tableViewsSchema } from 'src/features/share/schema/table-views-schema';
import { SystemTables } from 'src/features/share/system-tables.consts';
import type { TableViewsData } from 'src/features/views/types';

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
    private readonly progressService: MigrationProgressService,
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

  async countRows(tableVersionId: string): Promise<number> {
    return this.prisma.row.count({
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
        patches: data.patches as InputJsonValue,
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

  async processMigration(migrationId: string): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      const migration = await this.prisma.tableMigration.findUniqueOrThrow({
        where: { id: migrationId },
      });

      try {
        await this.initPhase(migration);
        await this.copyPhase(migration.id);
        await this.validatePhase(migration.id);
        await this.swapPhase(migration.id);
        await this.cleanupPhase(migration.id);
        return;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);

        const current = await this.prisma.tableMigration.findUnique({
          where: { id: migrationId },
        });

        if (!current || current.status === MigrationStatus.CANCELLED) {
          return;
        }

        if (current.retryCount < current.maxRetries) {
          this.logger.warn(
            `Migration ${migrationId} attempt ${attempt + 1} failed: ${msg}`,
          );
          await this.progressService.incrementRetry(migrationId);
          continue;
        }

        this.logger.error(
          `Migration ${migrationId} failed after ${attempt + 1} attempts: ${msg}`,
          error instanceof Error ? error.stack : undefined,
        );
        await this.progressService.setFailed(migrationId, msg);
        return;
      }
    }
  }

  private async initPhase(migration: {
    id: string;
    tableId: string;
    sourceTableVersionId: string;
    shadowTableVersionId: string | null;
  }): Promise<void> {
    await this.progressService.setPhase(
      migration.id,
      MigrationPhase.COPYING,
      MigrationStatus.COPYING,
    );

    if (migration.shadowTableVersionId) {
      return;
    }

    const sourceTable = await this.prisma.table.findUniqueOrThrow({
      where: { versionId: migration.sourceTableVersionId },
    });

    const shadowVersionId = nanoid();
    await this.prisma.table.create({
      data: {
        versionId: shadowVersionId,
        createdId: sourceTable.createdId,
        id: migration.tableId,
        readonly: false,
        system: false,
      },
    });

    await this.progressService.setShadowTableVersionId(
      migration.id,
      shadowVersionId,
    );
  }

  private async copyPhase(migrationId: string): Promise<void> {
    let migration = await this.prisma.tableMigration.findUniqueOrThrow({
      where: { id: migrationId },
    });

    const patches = migration.patches as unknown as JsonPatch[];
    const previousSchema = migration.previousSchema as unknown as JsonSchema;
    let lastCopiedRowId = migration.lastCopiedRowId;
    let copiedRows = migration.copiedRows;
    let currentBatch = migration.currentBatch;

    while (copiedRows < migration.totalRows) {
      if (await this.progressService.isCancelled(migrationId)) {
        this.logger.log(`Migration ${migrationId} cancelled during copy`);
        return;
      }

      const rows = await this.batchService.loadBatchRows(
        migration.sourceTableVersionId,
        lastCopiedRowId,
        migration.batchSize,
      );
      if (rows.length === 0) {
        break;
      }

      const processedRows = await this.batchService.migrateAndProcessBatch(
        rows,
        patches,
        previousSchema,
        migration.revisionId,
        migration.tableId,
      );

      if (!migration.shadowTableVersionId) {
        throw new Error(`Shadow table not set for migration ${migrationId}`);
      }

      await this.batchService.insertBatchIntoShadow(
        processedRows,
        migration.shadowTableVersionId,
        migration.targetSchemaHash,
      );

      const lastRow = rows.at(-1);
      if (!lastRow) break;
      copiedRows += rows.length;
      currentBatch += 1;
      lastCopiedRowId = lastRow.id;

      await this.progressService.updateProgress(migrationId, {
        copiedRows,
        lastCopiedRowId,
        currentBatch,
      });

      migration = await this.prisma.tableMigration.findUniqueOrThrow({
        where: { id: migrationId },
      });
    }
  }

  private async validatePhase(migrationId: string): Promise<void> {
    if (await this.progressService.isCancelled(migrationId)) {
      return;
    }

    await this.progressService.setPhase(migrationId, MigrationPhase.VALIDATING);

    const migration = await this.prisma.tableMigration.findUniqueOrThrow({
      where: { id: migrationId },
    });

    if (!migration.shadowTableVersionId) {
      throw new Error(`Shadow table not set for migration ${migrationId}`);
    }

    const shadowRowCount = await this.prisma.row.count({
      where: {
        tables: { some: { versionId: migration.shadowTableVersionId } },
      },
    });

    if (shadowRowCount !== migration.totalRows) {
      throw new Error(
        `Row count mismatch: expected ${migration.totalRows}, got ${shadowRowCount}`,
      );
    }
  }

  private async swapPhase(migrationId: string): Promise<void> {
    if (await this.progressService.isCancelled(migrationId)) {
      return;
    }

    await this.progressService.setPhase(
      migrationId,
      MigrationPhase.SWAPPING,
      MigrationStatus.SWAPPING,
    );

    const migration = await this.prisma.tableMigration.findUniqueOrThrow({
      where: { id: migrationId },
    });

    if (!migration.shadowTableVersionId) {
      throw new Error(`Shadow table not set for migration ${migrationId}`);
    }

    const shadowTableVersionId = migration.shadowTableVersionId;

    await this.transactionService.runSerializable(async () => {
      const tx = this.transactionService.getTransaction();

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

      await this.updateSchemaRowInTx(tx, migration);
      await this.updateViewsRowInTx(tx, migration);
    });
  }

  private async updateSchemaRowInTx(
    tx: ReturnType<TransactionPrismaService['getTransaction']>,
    migration: { revisionId: string; tableId: string; patches: unknown },
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
    st.applyPatches(migration.patches as JsonPatch[]);
    const targetSchema = st.getSchema();

    await tx.row.update({
      where: { versionId: schemaRow.versionId },
      data: {
        data: targetSchema as InputJsonValue,
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
      patches: unknown;
    },
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
        patches: migration.patches as JsonPatch[],
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

  private async cleanupPhase(migrationId: string): Promise<void> {
    if (await this.progressService.isCancelled(migrationId)) {
      return;
    }

    await this.prisma.tableMigration.delete({
      where: { id: migrationId },
    });

    this.logger.log(`Migration ${migrationId} completed successfully`);
  }
}
