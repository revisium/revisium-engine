import { nanoid } from 'nanoid';
import { MigrationStatus } from 'src/features/migration/types/migration.types';
import { PrismaService } from 'src/infrastructure/database/prisma.service';

const TARGET_SCHEMA_HASH = 'new';

export interface MigrationFixtureOptions {
  tableId?: string;
  phase?: string;
  totalRows?: number;
  copiedRows?: number;
  shadowTableVersionId?: string;
  lockedBy?: string;
  heartbeatAt?: Date;
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
