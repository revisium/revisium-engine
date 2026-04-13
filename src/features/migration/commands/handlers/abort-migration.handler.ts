import { BadRequestException } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { AbortMigrationCommand } from 'src/features/migration/commands/impl/abort-migration.command';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { MigrationStatus } from 'src/features/migration/types/migration.types';

@CommandHandler(AbortMigrationCommand)
export class AbortMigrationHandler implements ICommandHandler<
  AbortMigrationCommand,
  void
> {
  constructor(private readonly prisma: PrismaService) {}

  async execute({ data }: AbortMigrationCommand): Promise<void> {
    const migration = await this.prisma.tableMigration.findUnique({
      where: {
        revisionId_tableId: {
          revisionId: data.revisionId,
          tableId: data.tableId,
        },
      },
    });

    if (!migration) {
      throw new BadRequestException(
        `No migration found for table "${data.tableId}" in revision "${data.revisionId}"`,
      );
    }

    if (migration.status === MigrationStatus.SWAPPING) {
      throw new BadRequestException(
        'Cannot abort during swap phase, please wait for completion',
      );
    }

    if (
      migration.status === MigrationStatus.COMPLETED ||
      migration.status === MigrationStatus.CANCELLED
    ) {
      throw new BadRequestException(
        `Migration already ${migration.status.toLowerCase()}`,
      );
    }

    if (migration.shadowTableVersionId) {
      await this.prisma.table
        .delete({
          where: { versionId: migration.shadowTableVersionId },
        })
        .catch((err: Error & { code?: string }) => {
          if (err.code !== 'P2025') {
            throw err;
          }
        });
    }

    await this.prisma.tableMigration.delete({
      where: { id: migration.id },
    });
  }
}
