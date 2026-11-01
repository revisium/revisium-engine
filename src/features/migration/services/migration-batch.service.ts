import { BadRequestException, Injectable } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { nanoid } from 'nanoid';
import objectHash from 'object-hash';
import {
  SortOrder,
  TransactionIsolationLevel,
  type InputJsonValue,
  type Row,
} from 'src/engine-prisma-types';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';
import { ValidateDataCommand } from 'src/features/draft/commands/impl/transactional/validate-data.command';
import { FileUsageIntegrationService } from 'src/features/file-usage/services/file-usage-integration.service';
import { PermanentMigrationFailure } from 'src/features/migration/exceptions/permanent-migration-failure';
import { PluginService } from 'src/features/plugin/plugin.service';
import { JsonSchemaStoreService } from 'src/features/share/json-schema-store.service';
import type { MigrationLease } from 'src/features/migration/services/migration-ownership';
import {
  MigrationTransitions,
  type MigrationCheckpoint,
} from 'src/features/migration/services/migration-transitions';
import { SchemaTable } from '@revisium/schema-toolkit/lib';
import {
  JsonPatch,
  JsonSchema,
  JsonValue,
} from '@revisium/schema-toolkit/types';

export interface MigratedRows {
  rows: Row[];
  targetSchema: JsonSchema;
}

export interface ShadowBatch {
  revisionId: string;
  tableId: string;
  shadowTableVersionId: string;
  targetSchema: JsonSchema;
  targetSchemaHash: string;
  from: MigrationCheckpoint;
  to: MigrationCheckpoint;
  rows: Row[];
}

interface TableInRevision {
  revisionId: string;
  tableId: string;
}

@Injectable()
export class MigrationBatchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactionService: TransactionPrismaService,
    private readonly commandBus: CommandBus,
    private readonly pluginService: PluginService,
    private readonly jsonSchemaStore: JsonSchemaStoreService,
    private readonly transitions: MigrationTransitions,
    private readonly fileUsage: FileUsageIntegrationService,
  ) {}

  private get transaction() {
    return this.transactionService.getTransaction();
  }

  async loadBatchRows(
    sourceTableVersionId: string,
    lastCopiedRowId: string | null,
    batchSize: number,
  ) {
    const whereClause: Record<string, unknown> = {
      tables: { some: { versionId: sourceTableVersionId } },
    };
    if (lastCopiedRowId) {
      whereClause.id = { gt: lastCopiedRowId };
    }

    return this.prisma.row.findMany({
      where: whereClause,
      orderBy: { id: SortOrder.asc },
      take: batchSize,
    });
  }

  async migrateAndProcessBatch(
    rows: Row[],
    patches: JsonPatch[],
    previousSchema: JsonSchema,
    revisionId: string,
    tableId: string,
  ): Promise<MigratedRows> {
    const schemaTable = new SchemaTable(
      previousSchema,
      this.jsonSchemaStore.refs,
    );

    for (const row of rows) {
      schemaTable.addRow(row.id, row.data as JsonValue);
    }

    schemaTable.applyPatches(patches);
    const targetSchema = schemaTable.getSchema();
    const patchedRows = new Map(
      schemaTable.getRows().map((r) => [r.id, r.data]),
    );

    const processedRows: Row[] = rows.map((row) => ({
      ...row,
      data: patchedRows.get(row.id) ?? row.data,
    }));

    await this.pluginService.afterMigrateRows({
      revisionId,
      tableId,
      rows: processedRows,
      targetSchema,
    });

    return { rows: processedRows, targetSchema };
  }

  async validateMigratedRows(
    { revisionId, tableId }: TableInRevision,
    { rows, targetSchema }: MigratedRows,
  ): Promise<void> {
    try {
      // RepeatableRead gives the foreign-key lookups one snapshot of the revision.
      await this.runUnderTransactionTimeout(
        TransactionIsolationLevel.RepeatableRead,
        () =>
          this.commandBus.execute(
            new ValidateDataCommand({
              revisionId,
              tableId,
              tableSchema: targetSchema,
              rows: rows.map((row) => ({
                rowId: row.id,
                data: row.data as InputJsonValue,
              })),
            }),
          ),
      );
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw new PermanentMigrationFailure('ROW_INVALID', error.message);
      }

      throw error;
    }
  }

  writeBatch(lease: MigrationLease, batch: ShadowBatch): Promise<boolean> {
    return this.runUnderTransactionTimeout(
      TransactionIsolationLevel.ReadCommitted,
      () => this.writeBatchWithinTransaction(lease, batch),
    );
  }

  insertBatchIntoShadow(batch: ShadowBatch): Promise<Row[]> {
    return Promise.all(
      batch.rows.map((row) =>
        this.transaction.row.create({
          data: {
            versionId: nanoid(),
            createdId: row.createdId,
            id: row.id,
            readonly: false,
            data: row.data as InputJsonValue,
            meta: row.meta as InputJsonValue,
            hash: objectHash(row.data as objectHash.NotUndefined),
            schemaHash: batch.targetSchemaHash,
            createdAt: row.createdAt,
            updatedAt: new Date(),
            publishedAt: row.publishedAt,
            tables: {
              connect: { versionId: batch.shadowTableVersionId },
            },
          },
        }),
      ),
    );
  }

  private async writeBatchWithinTransaction(
    lease: MigrationLease,
    batch: ShadowBatch,
  ): Promise<boolean> {
    const advanced = await this.transitions.advanceCheckpoint(
      lease,
      batch.from,
      batch.to,
      this.transaction,
    );

    if (!advanced) {
      return false;
    }

    const shadowRows = await this.insertBatchIntoShadow(batch);
    await this.registerFileReferences(batch, shadowRows);

    return true;
  }

  private registerFileReferences(
    batch: ShadowBatch,
    shadowRows: Row[],
  ): Promise<void> {
    return this.fileUsage.registerReferencesForRows({
      revisionId: batch.revisionId,
      tableId: batch.tableId,
      tableSchema: batch.targetSchema,
      rows: shadowRows.map((row) => ({
        rowId: row.id,
        rowVersionId: row.versionId,
        data: row.data as InputJsonValue,
      })),
    });
  }

  private runUnderTransactionTimeout<T>(
    isolationLevel: TransactionIsolationLevel,
    handler: () => Promise<T>,
  ): Promise<T> {
    return this.transactionService.run(handler, {
      isolationLevel,
      timeout: this.transactionService.serializableTimeoutMs,
    });
  }
}
