import { SchemaTable } from '@revisium/schema-toolkit/lib';
import type { JsonPatch, JsonSchema } from '@revisium/schema-toolkit/types';
import { nanoid } from 'nanoid';
import objectHash from 'object-hash';
import type { InputJsonValue } from 'src/engine-prisma-types';
import {
  decodeMigrationPayload,
  encodeMigrationPayload,
} from 'src/features/migration/migration-payload';
import { MigrationStatus } from 'src/features/migration/types/migration.types';
import { SystemTables } from 'src/features/share/system-tables.consts';
import { PrismaService } from 'src/infrastructure/database/prisma.service';

const TARGET_SCHEMA_HASH = 'new';
const LEASES_PER_EXPIRY = 2;

export interface MigrationFixtureOptions {
  tableId?: string;
  phase?: string;
  payload?: InputJsonValue;
  sourceTableVersionId?: string;
  totalRows?: number;
  copiedRows?: number;
  shadowTableVersionId?: string;
  lockedBy?: string;
  lockedAt?: Date;
  heartbeatAt?: Date;
  retryCount?: number;
}

export interface ShadowTableFixture {
  versionId: string;
  rowVersionIds: string[];
}

export function createMigrationRecord(
  database: Pick<PrismaService, 'tableMigration'>,
  revisionId: string,
  status: MigrationStatus | string,
  options: MigrationFixtureOptions = {},
) {
  return database.tableMigration.create({
    data: {
      revisionId,
      tableId: options.tableId ?? 'products',
      sourceTableVersionId: options.sourceTableVersionId ?? 'source-v1',
      status,
      phase: options.phase ?? status,
      patches: options.payload ?? encodeMigrationPayload([]),
      previousSchema: {},
      previousSchemaHash: 'old',
      targetSchemaHash: TARGET_SCHEMA_HASH,
      totalRows: options.totalRows ?? 1,
      copiedRows: options.copiedRows ?? 0,
      shadowTableVersionId: options.shadowTableVersionId,
      lockedBy: options.lockedBy,
      lockedAt: options.lockedAt,
      heartbeatAt: options.heartbeatAt,
      retryCount: options.retryCount,
    },
  });
}

export async function createShadowTableWithRows(
  database: Pick<PrismaService, 'table'>,
  tableId: string,
  rowCount: number,
): Promise<ShadowTableFixture> {
  const shadowTable = await database.table.create({
    data: {
      versionId: nanoid(),
      createdId: nanoid(),
      id: tableId,
      rows: {
        create: Array.from({ length: rowCount }, (_, index) => ({
          versionId: nanoid(),
          createdId: nanoid(),
          id: `row-${index}`,
          data: {},
          hash: `copied-row-${index}`,
          schemaHash: TARGET_SCHEMA_HASH,
        })),
      },
    },
    include: { rows: { select: { versionId: true } } },
  });

  return {
    versionId: shadowTable.versionId,
    rowVersionIds: shadowTable.rows.map((row) => row.versionId),
  };
}

export function asyncUpdateOf(schema: JsonSchema, patches: JsonPatch[]) {
  const target = new SchemaTable(schema);
  target.applyPatches(patches);

  return {
    patches: encodeMigrationPayload(patches),
    previousSchema: schema as InputJsonValue,
    previousSchemaHash: objectHash(schema),
    targetSchemaHash: objectHash(target.getSchema()),
  };
}

export function expiredHeartbeat(lockTimeoutMs: number): Date {
  return new Date(Date.now() - LEASES_PER_EXPIRY * lockTimeoutMs);
}

export async function expireLease(
  database: Pick<PrismaService, 'tableMigration'>,
  migrationId: string,
  lockTimeoutMs: number,
): Promise<void> {
  await database.tableMigration.update({
    where: { id: migrationId },
    data: { heartbeatAt: expiredHeartbeat(lockTimeoutMs) },
  });
}

export async function cancelKeepingOwner(
  database: Pick<PrismaService, 'tableMigration'>,
  migrationId: string,
): Promise<void> {
  await database.tableMigration.update({
    where: { id: migrationId },
    data: { status: MigrationStatus.CANCELLED },
  });
}

export async function passTimeWithoutProgress(
  database: Pick<PrismaService, 'tableMigration'>,
  migrationId: string,
  elapsedMs: number,
): Promise<void> {
  const record = await database.tableMigration.findUniqueOrThrow({
    where: { id: migrationId },
  });

  await database.tableMigration.update({
    where: { id: migrationId },
    data: {
      createdAt: new Date(record.createdAt.getTime() - elapsedMs),
      startedAt: earlier(record.startedAt, elapsedMs),
      lastProgressAt: earlier(record.lastProgressAt, elapsedMs),
      lockedAt: earlier(record.lockedAt, elapsedMs),
      heartbeatAt: record.lockedBy ? new Date() : record.heartbeatAt,
    },
  });
}

export async function replacePayload(
  database: Pick<PrismaService, 'tableMigration'>,
  migrationId: string,
  payload: InputJsonValue,
): Promise<void> {
  await database.tableMigration.update({
    where: { id: migrationId },
    data: { patches: payload },
  });
}

export async function recordImportedLedgerId(
  database: Pick<PrismaService, 'tableMigration'>,
  migrationId: string,
  ledgerMigrationId: string,
): Promise<void> {
  const { patches } = await database.tableMigration.findUniqueOrThrow({
    where: { id: migrationId },
  });

  await replacePayload(database, migrationId, {
    version: 2,
    patches: decodeMigrationPayload(patches).patches,
    ledgerMigrationId,
  } as unknown as InputJsonValue);
}

export async function commitRevisionBehindMigration(
  database: Pick<PrismaService, 'revision' | 'table' | 'row'>,
  revisionId: string,
): Promise<void> {
  const linkedByRevision = { revisions: { some: { id: revisionId } } };

  await database.row.updateMany({
    where: { tables: { some: linkedByRevision } },
    data: { readonly: true },
  });
  await database.table.updateMany({
    where: linkedByRevision,
    data: { readonly: true },
  });
  await database.revision.update({
    where: { id: revisionId },
    data: { isDraft: false },
  });
}

export async function replaceDraftTableVersion(
  database: Pick<PrismaService, 'table'>,
  revisionId: string,
  tableVersionId: string,
): Promise<void> {
  const replaced = await database.table.update({
    where: { versionId: tableVersionId },
    data: { revisions: { disconnect: { id: revisionId } } },
  });

  await database.table.create({
    data: {
      versionId: nanoid(),
      createdId: replaced.createdId,
      id: replaced.id,
      revisions: { connect: { id: revisionId } },
    },
  });
}

export async function linkTableVersion(
  database: Pick<PrismaService, 'table'>,
  revisionId: string,
  tableVersionId: string,
): Promise<void> {
  await database.table.update({
    where: { versionId: tableVersionId },
    data: { revisions: { connect: { id: revisionId } } },
  });
}

export async function describeDraftSchema(
  database: Pick<PrismaService, 'row'>,
  revisionId: string,
  tableId: string,
): Promise<void> {
  const schemaRow = await database.row.findFirstOrThrow({
    where: {
      id: tableId,
      tables: {
        some: {
          id: SystemTables.Schema,
          revisions: { some: { id: revisionId } },
        },
      },
    },
  });
  const described = {
    ...(schemaRow.data as Record<string, unknown>),
    description: 'changed after the migration started',
  };

  await database.row.update({
    where: { versionId: schemaRow.versionId },
    data: { data: described, hash: objectHash(described) },
  });
}

export async function removeOneRow(
  database: Pick<PrismaService, 'row'>,
  tableVersionId: string,
): Promise<void> {
  const row = await database.row.findFirstOrThrow({
    where: { tables: { some: { versionId: tableVersionId } } },
  });

  await database.row.delete({ where: { versionId: row.versionId } });
}

export async function unlinkMigrationTable(
  database: Pick<PrismaService, 'table'>,
  revisionId: string,
): Promise<void> {
  const migrationTable = await database.table.findFirstOrThrow({
    where: {
      id: SystemTables.Migration,
      revisions: { some: { id: revisionId } },
    },
  });

  await database.table.update({
    where: { versionId: migrationTable.versionId },
    data: { revisions: { disconnect: { id: revisionId } } },
  });
}

function earlier(moment: Date | null, elapsedMs: number): Date | null {
  return moment && new Date(moment.getTime() - elapsedMs);
}
