import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { SortOrder } from 'src/engine-prisma-types';
import {
  CheckImportedMigrationIdCommand,
  MigrationAlreadyAppliedException,
  MigrationIdOutOfOrderException,
} from 'src/features/draft/commands/impl/migration';
import { MigrationContextService } from 'src/features/draft/migration-context.service';
import { SystemTables } from 'src/features/share/system-tables.consts';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

@CommandHandler(CheckImportedMigrationIdCommand)
export class CheckImportedMigrationIdHandler implements ICommandHandler<CheckImportedMigrationIdCommand> {
  constructor(
    private readonly transactionService: TransactionPrismaService,
    private readonly migrationContextService: MigrationContextService,
  ) {}

  private get prisma() {
    return this.transactionService.getTransactionOrPrisma();
  }

  async execute({ revisionId }: CheckImportedMigrationIdCommand) {
    const migrationId = this.migrationContextService.migrationId;

    if (migrationId === undefined) {
      return;
    }

    const conflicts = await this.findConflictingMigrations(
      revisionId,
      migrationId,
    );

    if (conflicts.some(({ id }) => id === migrationId)) {
      throw new MigrationAlreadyAppliedException(migrationId);
    }

    const [lastMigration] = conflicts;

    if (lastMigration) {
      throw new MigrationIdOutOfOrderException(
        migrationId,
        lastMigration.publishedAt,
      );
    }
  }

  private findConflictingMigrations(revisionId: string, migrationId: string) {
    return this.prisma.row.findMany({
      where: {
        OR: [{ id: migrationId }, { publishedAt: { gte: migrationId } }],
        tables: {
          some: {
            id: SystemTables.Migration,
            revisions: { some: { id: revisionId } },
          },
        },
      },
      select: {
        id: true,
        publishedAt: true,
      },
      orderBy: {
        publishedAt: SortOrder.desc,
      },
    });
  }
}
