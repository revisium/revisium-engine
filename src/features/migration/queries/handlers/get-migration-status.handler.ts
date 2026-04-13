import { QueryHandler, IQueryHandler } from '@nestjs/cqrs';
import { GetMigrationStatusQuery } from 'src/features/migration/queries/impl/get-migration-status.query';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { PERCENTAGE_MULTIPLIER } from 'src/features/migration/migration.consts';
import {
  MigrationPhase,
  MigrationStatus,
  MigrationStatusResult,
} from 'src/features/migration/types/migration.types';

@QueryHandler(GetMigrationStatusQuery)
export class GetMigrationStatusHandler implements IQueryHandler<
  GetMigrationStatusQuery,
  MigrationStatusResult | null
> {
  constructor(private readonly prisma: PrismaService) {}

  async execute({
    data,
  }: GetMigrationStatusQuery): Promise<MigrationStatusResult | null> {
    const migration = await this.prisma.tableMigration.findUnique({
      where: {
        revisionId_tableId: {
          revisionId: data.revisionId,
          tableId: data.tableId,
        },
      },
    });

    if (!migration) {
      return null;
    }

    return {
      migrationId: migration.id,
      revisionId: migration.revisionId,
      tableId: migration.tableId,
      status: migration.status as MigrationStatus,
      phase: migration.phase as MigrationPhase,
      progress: {
        percentage:
          migration.totalRows > 0
            ? (migration.copiedRows / migration.totalRows) *
              PERCENTAGE_MULTIPLIER
            : 0,
        copiedRows: migration.copiedRows,
        totalRows: migration.totalRows,
      },
      createdAt: migration.createdAt,
      startedAt: migration.startedAt,
      completedAt: migration.completedAt,
      errorMessage: migration.errorMessage,
    };
  }
}
