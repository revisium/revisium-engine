import { Injectable } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { SchemaTable } from '@revisium/schema-toolkit/lib';
import type { JsonPatch, JsonSchema } from '@revisium/schema-toolkit/types';
import objectHash from 'object-hash';
import type { TableMigration } from 'src/engine-prisma-types';
import {
  CheckImportedMigrationIdCommand,
  MigrationAlreadyAppliedException,
  MigrationIdOutOfOrderException,
} from 'src/features/draft/commands/impl/migration';
import { PermanentMigrationFailure } from 'src/features/migration/exceptions/permanent-migration-failure';
import {
  decodeMigrationPayload,
  ledgerMigrationIdOf,
} from 'src/features/migration/migration-payload';
import { JsonSchemaStoreService } from 'src/features/share/json-schema-store.service';
import { SystemTables } from 'src/features/share/system-tables.consts';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

export interface VerifiedSwap {
  shadowTableVersionId: string;
  patches: JsonPatch[];
  previousSchema: JsonSchema;
  targetSchema: JsonSchema;
  ledgerMigrationId?: string;
}

@Injectable()
export class SwapRecheckService {
  constructor(
    private readonly transactionService: TransactionPrismaService,
    private readonly commandBus: CommandBus,
    private readonly jsonSchemaStore: JsonSchemaStoreService,
  ) {}

  private get transaction() {
    return this.transactionService.getTransaction();
  }

  async recheck(migration: TableMigration): Promise<VerifiedSwap> {
    const payload = decodeMigrationPayload(migration.patches);
    const { patches } = payload;
    const ledgerMigrationId = ledgerMigrationIdOf(payload);
    const shadowTableVersionId = shadowTableOf(migration);
    const previousSchema = migration.previousSchema as unknown as JsonSchema;

    await this.ensureRevisionIsDraft(migration);
    await this.ensureDraftLinksSource(migration, shadowTableVersionId);
    await this.ensureDraftSchemaUnchanged(migration);
    const targetSchema = this.ensurePatchesGiveTargetSchema(migration, patches);
    await this.ensureShadowComplete(migration, shadowTableVersionId);

    if (ledgerMigrationId !== undefined) {
      await this.ensureLedgerAvailable(migration);
      await this.ensureLedgerIdFree(migration, ledgerMigrationId);
    }

    return {
      shadowTableVersionId,
      patches,
      previousSchema,
      targetSchema,
      ledgerMigrationId,
    };
  }

  private async ensureRevisionIsDraft(migration: TableMigration) {
    const revision = await this.transaction.revision.findUnique({
      where: { id: migration.revisionId },
      select: { isDraft: true },
    });

    if (!revision?.isDraft) {
      throw new PermanentMigrationFailure(
        'REVISION_NOT_DRAFT',
        `revision ${migration.revisionId} is no longer the Draft`,
      );
    }
  }

  private async ensureDraftLinksSource(
    migration: TableMigration,
    shadowTableVersionId: string,
  ) {
    const linked = await this.transaction.table.findMany({
      where: {
        id: migration.tableId,
        revisions: { some: { id: migration.revisionId } },
      },
      select: { versionId: true },
    });
    const linkedVersionIds = linked.map(({ versionId }) => versionId);

    if (
      !linkedVersionIds.includes(migration.sourceTableVersionId) ||
      linkedVersionIds.includes(shadowTableVersionId)
    ) {
      throw new PermanentMigrationFailure(
        'SOURCE_TABLE_REPLACED',
        `the Draft links ${linkedVersionIds.join(', ') || 'no version'} of "${migration.tableId}" instead of its source ${migration.sourceTableVersionId}`,
      );
    }
  }

  private async ensureDraftSchemaUnchanged(migration: TableMigration) {
    const schemaRow = await this.transaction.row.findFirst({
      where: {
        id: migration.tableId,
        tables: {
          some: {
            id: SystemTables.Schema,
            revisions: { some: { id: migration.revisionId } },
          },
        },
      },
      select: { hash: true },
    });

    if (schemaRow?.hash !== migration.previousSchemaHash) {
      throw new PermanentMigrationFailure(
        'SCHEMA_CHANGED',
        `the Draft schema of "${migration.tableId}" no longer has the hash the migration started from`,
      );
    }
  }

  private ensurePatchesGiveTargetSchema(
    migration: TableMigration,
    patches: JsonPatch[],
  ): JsonSchema {
    const targetSchema = this.patchedSchema(migration, patches);

    if (
      !targetSchema ||
      objectHash(targetSchema) !== migration.targetSchemaHash
    ) {
      throw new PermanentMigrationFailure(
        'SCHEMA_CHANGED',
        `the patches no longer turn the previous schema of "${migration.tableId}" into the target schema`,
      );
    }

    return targetSchema;
  }

  private patchedSchema(
    migration: TableMigration,
    patches: JsonPatch[],
  ): JsonSchema | undefined {
    try {
      const schemaTable = new SchemaTable(
        migration.previousSchema as unknown as JsonSchema,
        this.jsonSchemaStore.refs,
      );
      schemaTable.applyPatches(patches);

      return schemaTable.getSchema();
    } catch {
      return undefined;
    }
  }

  private async ensureShadowComplete(
    migration: TableMigration,
    shadowTableVersionId: string,
  ) {
    const shadowRows = await this.transaction.row.count({
      where: { tables: { some: { versionId: shadowTableVersionId } } },
    });

    if (shadowRows !== migration.totalRows) {
      throw new PermanentMigrationFailure(
        'ROW_COUNT_MISMATCH',
        `expected ${migration.totalRows} rows in the shadow table, found ${shadowRows}`,
      );
    }
  }

  private async ensureLedgerAvailable(migration: TableMigration) {
    const migrationTable = await this.transaction.table.findFirst({
      where: {
        id: SystemTables.Migration,
        revisions: { some: { id: migration.revisionId } },
      },
      select: { versionId: true },
    });

    if (!migrationTable) {
      throw new PermanentMigrationFailure(
        'LEDGER_UNAVAILABLE',
        `the Draft has no migration table to record the imported update`,
      );
    }
  }

  private async ensureLedgerIdFree(
    migration: TableMigration,
    ledgerMigrationId: string,
  ) {
    try {
      await this.commandBus.execute(
        new CheckImportedMigrationIdCommand(
          migration.revisionId,
          ledgerMigrationId,
        ),
      );
    } catch (error) {
      if (
        error instanceof MigrationAlreadyAppliedException ||
        error instanceof MigrationIdOutOfOrderException
      ) {
        throw new PermanentMigrationFailure('LEDGER_ID_TAKEN', error.message);
      }

      throw error;
    }
  }
}

function shadowTableOf(migration: TableMigration): string {
  if (!migration.shadowTableVersionId) {
    throw new Error(`Shadow table not set for migration ${migration.id}`);
  }

  return migration.shadowTableVersionId;
}
