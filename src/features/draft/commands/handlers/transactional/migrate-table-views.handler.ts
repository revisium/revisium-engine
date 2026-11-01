import { BadRequestException } from '@nestjs/common';
import { CommandBus, CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import type { InputJsonValue } from 'src/engine-prisma-types';
import { InternalUpdateRowCommand } from 'src/features/draft/commands/impl/transactional/internal-update-row.command';
import { MigrateTableViewsCommand } from 'src/features/draft/commands/impl/transactional/migrate-table-views.command';
import { JsonSchemaValidatorService } from 'src/features/share/json-schema-validator.service';
import { tableViewsSchema } from 'src/features/share/schema/table-views-schema';
import { ShareTransactionalQueries } from 'src/features/share/share.transactional.queries';
import { SystemTables } from 'src/features/share/system-tables.consts';
import {
  ViewsMigrationError,
  ViewsMigrationService,
} from 'src/features/share/views-migration.service';
import type { TableViewsData } from 'src/features/views/types';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

@CommandHandler(MigrateTableViewsCommand)
export class MigrateTableViewsHandler implements ICommandHandler<
  MigrateTableViewsCommand,
  void
> {
  constructor(
    private readonly transactionService: TransactionPrismaService,
    private readonly commandBus: CommandBus,
    private readonly shareTransactionalQueries: ShareTransactionalQueries,
    private readonly jsonSchemaValidator: JsonSchemaValidatorService,
    private readonly viewsMigrationService: ViewsMigrationService,
  ) {}

  private get transaction() {
    return this.transactionService.getTransaction();
  }

  async execute({ data }: MigrateTableViewsCommand): Promise<void> {
    const { revisionId, tableId, patches, previousSchema } = data;
    const viewsTable = await this.shareTransactionalQueries.findTableInRevision(
      revisionId,
      SystemTables.Views,
    );

    if (!viewsTable) {
      return;
    }

    const viewsRow = await this.findViewsRow(viewsTable.versionId, tableId);
    if (!viewsRow) {
      return;
    }

    const viewsData = viewsRow.data as unknown as TableViewsData;

    try {
      const migratedViewsData = this.viewsMigrationService.migrateViews(
        {
          viewsData,
          patches,
          previousSchema,
        },
        { revisionId, tableId },
      );

      if (data.dryRun) {
        return;
      }

      const schemaHash =
        this.jsonSchemaValidator.getSchemaHash(tableViewsSchema);

      await this.commandBus.execute(
        new InternalUpdateRowCommand({
          revisionId,
          tableId: SystemTables.Views,
          rowId: tableId,
          data: migratedViewsData as unknown as InputJsonValue,
          schemaHash,
        }),
      );
    } catch (error) {
      if (error instanceof ViewsMigrationError) {
        throw new BadRequestException(
          `Views migration failed for table "${tableId}" in revision "${revisionId}": ${error.message}`,
          {
            cause: {
              revisionId: error.context.revisionId,
              tableId: error.context.tableId,
              ...error.details,
            },
          },
        );
      }
      throw error;
    }
  }

  private async findViewsRow(tableVersionId: string, rowId: string) {
    return this.transaction.row.findFirst({
      where: {
        id: rowId,
        tables: {
          some: {
            versionId: tableVersionId,
          },
        },
      },
    });
  }
}
