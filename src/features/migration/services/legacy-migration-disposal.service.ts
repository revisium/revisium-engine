import { Injectable, Logger } from '@nestjs/common';
import { join } from 'src/engine-prisma-types';
import {
  ACTIVE_MIGRATION_STATUSES,
  MigrationStatus,
} from 'src/features/migration/types/migration.types';
import { PrismaService } from 'src/infrastructure/database/prisma.service';

const LEGACY_JOB =
  'LEGACY_JOB: started by an engine version without the payload envelope; rerun updateTable or the import';

@Injectable()
export class LegacyMigrationDisposalService {
  private readonly logger = new Logger(LegacyMigrationDisposalService.name);

  constructor(private readonly prisma: PrismaService) {}

  async dispose(): Promise<void> {
    const deleted =
      (await this.deleteSwapsOfMissingRevisions()) +
      (await this.deleteCommittedSwaps());
    const cancelled = await this.cancelUnfinishedJobs();

    if (deleted + cancelled > 0) {
      this.logger.warn(
        `Disposed of legacy migrations: ${deleted} deleted, ${cancelled} cancelled`,
      );
    }
  }

  private deleteSwapsOfMissingRevisions(): Promise<number> {
    return this.prisma.$executeRaw`
      DELETE FROM "TableMigration" AS migration
      WHERE jsonb_typeof(migration."patches") = 'array'
        AND migration."status" = ${MigrationStatus.SWAPPING}
        AND NOT EXISTS (
          SELECT 1 FROM "Revision"
          WHERE "Revision"."id" = migration."revisionId"
        )
    `;
  }

  private deleteCommittedSwaps(): Promise<number> {
    return this.prisma.$executeRaw`
      DELETE FROM "TableMigration" AS migration
      WHERE jsonb_typeof(migration."patches") = 'array'
        AND migration."status" = ${MigrationStatus.SWAPPING}
        AND EXISTS (
          SELECT 1 FROM "Revision"
          JOIN "_RevisionToTable" ON "_RevisionToTable"."A" = "Revision"."id"
          WHERE "Revision"."id" = migration."revisionId"
            AND "Revision"."isDraft"
            AND "_RevisionToTable"."B" = migration."shadowTableVersionId"
        )
    `;
  }

  private cancelUnfinishedJobs(): Promise<number> {
    return this.prisma.$executeRaw`
      UPDATE "TableMigration"
      SET "status" = ${MigrationStatus.CANCELLED},
        "errorMessage" = ${LEGACY_JOB},
        "completedAt" = ${new Date()},
        "lockedBy" = NULL,
        "lockedAt" = NULL
      WHERE jsonb_typeof("patches") = 'array'
        AND "status" IN (${join(ACTIVE_MIGRATION_STATUSES)})
    `;
  }
}
