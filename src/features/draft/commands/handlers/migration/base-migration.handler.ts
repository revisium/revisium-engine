import {
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import {
  InternalCreateRowCommand,
  InternalCreateRowCommandReturnType,
} from 'src/features/draft/commands/impl/transactional/internal-create-row.command';
import { JsonSchemaValidatorService } from 'src/features/share/json-schema-validator.service';
import { SystemTables } from 'src/features/share/system-tables.consts';
import { Migration } from '@revisium/schema-toolkit/types';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';
import { MigrationContextService } from 'src/features/draft/migration-context.service';
import { nextNativeMigrationId } from 'src/features/share/ledger/native-migration-id';

export abstract class BaseMigrationHandler<
  T extends { data: { revisionId: string } },
> {
  protected constructor(
    protected readonly transactionService: TransactionPrismaService,
    protected readonly commandBus: CommandBus,
    protected readonly jsonSchemaValidator: JsonSchemaValidatorService,
    protected readonly migrationContextService: MigrationContextService,
  ) {}

  protected abstract readonly logger: Logger;

  protected get transaction() {
    return this.transactionService.getTransaction();
  }

  async execute(command: T): Promise<boolean> {
    await this.checkIsDraftRevision(command.data.revisionId);

    if (await this.checkTableExisting(command)) {
      const migration = await this.getMigration(command.data);

      const { result, errors } =
        this.jsonSchemaValidator.validateTableMigrationsSchema(migration);

      if (!result) {
        this.logger.error(migration);

        throw new InternalServerErrorException(errors);
      }

      await this.createRowInMigrationTable(command.data.revisionId, migration);
      return true;
    } else {
      this.logger.error(
        `No table ${SystemTables.Migration} found in draft revision ${command.data.revisionId}`,
      );

      return false;
    }
  }

  protected abstract getMigration(data: {
    revisionId: string;
  }): Promise<Migration>;

  protected async getMigrationId(revisionId: string): Promise<string> {
    const explicitId = this.migrationContextService.migrationId;
    if (explicitId !== undefined) {
      return explicitId;
    }

    const bounds = await this.readMigrationBounds(revisionId);
    return nextNativeMigrationId(bounds);
  }

  private async readMigrationBounds(revisionId: string) {
    const { _max } = await this.transaction.row.aggregate({
      where: {
        tables: {
          some: {
            id: SystemTables.Migration,
            revisions: { some: { id: revisionId } },
          },
        },
      },
      _max: { id: true, publishedAt: true },
    });
    return _max;
  }

  protected async checkTableExisting(command: T): Promise<boolean> {
    const table = await this.transaction.table.findFirst({
      where: {
        revisions: {
          some: {
            id: command.data.revisionId,
          },
        },
        id: SystemTables.Migration,
      },
      select: {
        createdId: true,
      },
    });

    return Boolean(table);
  }

  protected async checkIsDraftRevision(revisionId: string) {
    const revision = await this.transaction.revision.findUniqueOrThrow({
      where: {
        id: revisionId,
      },
    });

    if (!revision.isDraft) {
      throw new BadRequestException('Revision is not draft revision');
    }
  }

  protected createRowInMigrationTable(
    revisionId: string,
    migration: Migration,
  ) {
    return this.commandBus.execute<
      InternalCreateRowCommand,
      InternalCreateRowCommandReturnType
    >(
      new InternalCreateRowCommand({
        revisionId,
        tableId: SystemTables.Migration,
        rowId: migration.id,
        data: migration,
        schemaHash: this.jsonSchemaValidator.tableSchemaHash,
        publishedAt: migration.id,
      }),
    );
  }
}
