import { MigrationStatus } from 'src/features/migration/types/migration.types';
import { PrismaService } from 'src/infrastructure/database/prisma.service';

export interface MigrationFixtureOptions {
  tableId?: string;
  phase?: string;
  totalRows?: number;
  copiedRows?: number;
}

export async function setMigrationStatus(
  database: Pick<PrismaService, 'tableMigration'>,
  migrationId: string,
  status: MigrationStatus,
): Promise<void> {
  await database.tableMigration.update({
    where: { id: migrationId },
    data: { status, phase: status },
  });
}

export async function renameMigrationBranch(
  database: Pick<PrismaService, 'branch'>,
  branchId: string,
  name: string,
): Promise<void> {
  await database.branch.update({ where: { id: branchId }, data: { name } });
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
      targetSchemaHash: 'new',
      totalRows: options.totalRows ?? 1,
      copiedRows: options.copiedRows ?? 0,
    },
  });
}
