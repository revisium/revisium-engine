import {
  CommandBus,
  CommandHandler,
  ICommandHandler,
  QueryBus,
} from '@nestjs/cqrs';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';
import { ApiUpdateTableCommand } from 'src/features/draft/commands/impl/api-update-table.command';
import { UpdateTableCommand } from 'src/features/draft/commands/impl/update-table.command';
import { ApiUpdateTableHandlerReturnType } from 'src/features/draft/commands/types/api-update-table.handler.types';
import { UpdateTableHandlerReturnType } from 'src/features/draft/commands/types/update-table.handler.types';
import { MigrationLockService } from 'src/features/migration/services/migration-lock.service';
import { MigrationService } from 'src/features/migration/services/migration.service';
import { StartAsyncMigrationCommand } from 'src/features/migration/commands/impl/start-async-migration.command';
import { StartAsyncMigrationResult } from 'src/features/migration/types/migration.types';
import { ShareCommands } from 'src/features/share/share.commands';
import { GetTableByIdQuery } from 'src/features/table/queries/impl/get-table-by-id.query';
import { GetTableByIdReturnType } from 'src/features/table/queries/types';

@CommandHandler(ApiUpdateTableCommand)
export class ApiUpdateTableHandler implements ICommandHandler<
  ApiUpdateTableCommand,
  ApiUpdateTableHandlerReturnType
> {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
    private readonly transactionService: TransactionPrismaService,
    private readonly shareCommands: ShareCommands,
    private readonly migrationLockService: MigrationLockService,
    private readonly migrationService: MigrationService,
  ) {}

  async execute({ data }: ApiUpdateTableCommand) {
    await this.migrationLockService.checkRevisionLock(data.revisionId);

    if (await this.shouldUseAsyncMigration(data.revisionId, data.tableId)) {
      return this.executeAsyncMigration(data);
    }

    return this.executeSyncMigration(data);
  }

  private async shouldUseAsyncMigration(
    revisionId: string,
    tableId: string,
  ): Promise<boolean> {
    return this.migrationService.shouldUseAsyncMigrationByTableId(
      revisionId,
      tableId,
    );
  }

  private async executeSyncMigration(
    data: ApiUpdateTableCommand['data'],
  ): Promise<ApiUpdateTableHandlerReturnType> {
    const {
      tableVersionId,
      previousTableVersionId,
    }: UpdateTableHandlerReturnType =
      await this.transactionService.runSerializable(async () =>
        this.commandBus.execute<
          UpdateTableCommand,
          UpdateTableHandlerReturnType
        >(new UpdateTableCommand(data)),
      );

    await this.shareCommands.notifyEndpoints({ revisionId: data.revisionId });

    const table = await this.queryBus.execute<
      GetTableByIdQuery,
      GetTableByIdReturnType
    >(new GetTableByIdQuery({ revisionId: data.revisionId, tableVersionId }));

    return {
      table,
      previousVersionTableId: previousTableVersionId,
    };
  }

  private async executeAsyncMigration(
    data: ApiUpdateTableCommand['data'],
  ): Promise<ApiUpdateTableHandlerReturnType> {
    const { migrationId }: StartAsyncMigrationResult =
      await this.commandBus.execute(
        new StartAsyncMigrationCommand({
          revisionId: data.revisionId,
          tableId: data.tableId,
          patches: data.patches,
        }),
      );

    const tableVersionId = await this.migrationService.getTableVersionId(
      data.revisionId,
      data.tableId,
    );

    const table = tableVersionId
      ? await this.queryBus.execute<GetTableByIdQuery, GetTableByIdReturnType>(
          new GetTableByIdQuery({
            revisionId: data.revisionId,
            tableVersionId,
          }),
        )
      : null;

    return {
      table,
      previousVersionTableId: tableVersionId ?? '',
      migrationId,
      migrationStatus: 'migrating',
    };
  }
}
