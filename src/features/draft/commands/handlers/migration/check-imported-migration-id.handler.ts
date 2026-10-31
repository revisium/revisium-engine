import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
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

    if (await this.isRecorded(revisionId, migrationId)) {
      throw new MigrationAlreadyAppliedException(migrationId);
    }

    const laterMigration = await this.findMigrationNotBefore(
      revisionId,
      migrationId,
    );

    if (laterMigration) {
      throw new MigrationIdOutOfOrderException(
        migrationId,
        laterMigration.publishedAt,
      );
    }
  }

  private async isRecorded(revisionId: string, migrationId: string) {
    const migration = await this.prisma.row.findFirst({
      where: {
        id: migrationId,
        tables: migrationTableOf(revisionId),
      },
      select: {
        id: true,
      },
    });

    return Boolean(migration);
  }

  private findMigrationNotBefore(revisionId: string, migrationId: string) {
    return this.prisma.row.findFirst({
      where: {
        publishedAt: {
          gte: migrationId,
        },
        tables: migrationTableOf(revisionId),
      },
      select: {
        publishedAt: true,
      },
    });
  }
}

function migrationTableOf(revisionId: string) {
  return {
    some: {
      id: SystemTables.Migration,
      revisions: {
        some: {
          id: revisionId,
        },
      },
    },
  };
}
