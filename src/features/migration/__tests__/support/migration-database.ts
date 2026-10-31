import { nanoid } from 'nanoid';
import type { InputJsonValue } from 'src/engine-prisma-types';
import { MigrationStatus } from 'src/features/migration/types/migration.types';
import { PrismaService } from 'src/infrastructure/database/prisma.service';

const TARGET_SCHEMA_HASH = 'new';
const LEASES_PER_EXPIRY = 2;

export interface MigrationFixtureOptions {
  tableId?: string;
  phase?: string;
  totalRows?: number;
  copiedRows?: number;
  shadowTableVersionId?: string;
  lockedBy?: string;
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
      sourceTableVersionId: 'source-v1',
      status,
      phase: options.phase ?? status,
      patches: [],
      previousSchema: {},
      previousSchemaHash: 'old',
      targetSchemaHash: TARGET_SCHEMA_HASH,
      totalRows: options.totalRows ?? 1,
      copiedRows: options.copiedRows ?? 0,
      shadowTableVersionId: options.shadowTableVersionId,
      lockedBy: options.lockedBy,
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

export async function cancelAsStalled(
  database: Pick<PrismaService, 'tableMigration'>,
  migrationId: string,
): Promise<void> {
  await database.tableMigration.update({
    where: { id: migrationId },
    data: {
      status: MigrationStatus.CANCELLED,
      errorMessage: 'STALLED: no progress within the stall timeout',
      completedAt: new Date(),
      lockedBy: null,
      lockedAt: null,
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
