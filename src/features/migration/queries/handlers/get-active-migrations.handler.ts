import { QueryHandler, IQueryHandler } from '@nestjs/cqrs';
import type { TableMigration } from 'src/engine-prisma-types';
import { GetActiveMigrationsQuery } from 'src/features/migration/queries/impl/get-active-migrations.query';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { PERCENTAGE_MULTIPLIER } from 'src/features/migration/migration.consts';
import {
  ActiveMigrationResult,
  ACTIVE_MIGRATION_STATUSES,
  MigrationStatus,
} from 'src/features/migration/types/migration.types';

@QueryHandler(GetActiveMigrationsQuery)
export class GetActiveMigrationsHandler implements IQueryHandler<
  GetActiveMigrationsQuery,
  ActiveMigrationResult[]
> {
  constructor(private readonly prisma: PrismaService) {}

  async execute({
    data,
  }: GetActiveMigrationsQuery): Promise<ActiveMigrationResult[]> {
    const migrations: Pick<
      TableMigration,
      'id' | 'tableId' | 'status' | 'copiedRows' | 'totalRows'
    >[] = await this.prisma.tableMigration.findMany({
      where: {
        revisionId: data.revisionId,
        status: { in: [...ACTIVE_MIGRATION_STATUSES] },
      },
    });

    return migrations.map((m) => ({
      migrationId: m.id,
      tableId: m.tableId,
      status: m.status as MigrationStatus,
      progress: {
        percentage:
          m.totalRows > 0
            ? (m.copiedRows / m.totalRows) * PERCENTAGE_MULTIPLIER
            : 0,
        copiedRows: m.copiedRows,
        totalRows: m.totalRows,
      },
    }));
  }
}
