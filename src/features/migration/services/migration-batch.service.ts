import { Injectable } from '@nestjs/common';
import { nanoid } from 'nanoid';
import objectHash from 'object-hash';
import {
  SortOrder,
  type InputJsonValue,
  type Row,
} from 'src/engine-prisma-types';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { PluginService } from 'src/features/plugin/plugin.service';
import { JsonSchemaStoreService } from 'src/features/share/json-schema-store.service';
import type { TransactionPrismaClient } from 'src/features/share/types';
import {
  MigrationTransitionService,
  type MigrationCheckpoint,
  type MigrationLease,
} from 'src/features/migration/services/migration-transition.service';
import { SchemaTable } from '@revisium/schema-toolkit/lib';
import {
  JsonPatch,
  JsonSchema,
  JsonValue,
} from '@revisium/schema-toolkit/types';

export interface ShadowBatch {
  shadowTableVersionId: string;
  targetSchemaHash: string;
  from: MigrationCheckpoint;
  to: MigrationCheckpoint;
  rows: Row[];
}

@Injectable()
export class MigrationBatchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pluginService: PluginService,
    private readonly jsonSchemaStore: JsonSchemaStoreService,
    private readonly transitions: MigrationTransitionService,
  ) {}

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
  ): Promise<Row[]> {
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

    return processedRows;
  }

  async writeBatch(
    lease: MigrationLease,
    batch: ShadowBatch,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      const advanced = await this.transitions.advanceCheckpoint(
        lease,
        batch.from,
        batch.to,
        transaction,
      );

      if (!advanced) {
        return false;
      }

      await this.insertBatchIntoShadow(
        batch.rows,
        batch.shadowTableVersionId,
        batch.targetSchemaHash,
        transaction,
      );

      return true;
    });
  }

  async insertBatchIntoShadow(
    rows: Row[],
    shadowTableVersionId: string,
    targetSchemaHash: string,
    client?: TransactionPrismaClient,
  ) {
    const runInsert = (db: TransactionPrismaClient | PrismaService) =>
      Promise.all(
        rows.map((row) =>
          db.row.create({
            data: {
              versionId: nanoid(),
              createdId: row.createdId,
              id: row.id,
              readonly: false,
              data: row.data as InputJsonValue,
              meta: row.meta as InputJsonValue,
              hash: objectHash(row.data as objectHash.NotUndefined),
              schemaHash: targetSchemaHash,
              createdAt: row.createdAt,
              updatedAt: new Date(),
              publishedAt: row.publishedAt,
              tables: {
                connect: { versionId: shadowTableVersionId },
              },
            },
          }),
        ),
      );

    if (client) {
      await runInsert(client);
      return;
    }

    await this.prisma.$transaction((tx) => runInsert(tx));
  }
}
