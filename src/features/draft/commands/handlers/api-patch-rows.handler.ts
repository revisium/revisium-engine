import {
  CommandBus,
  CommandHandler,
  ICommandHandler,
  QueryBus,
} from '@nestjs/cqrs';
import { ApiBaseRowHandler } from 'src/features/draft/commands/handlers/api-base-row.handler';
import { RowApiService } from 'src/features/row/row-api.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';
import { ApiPatchRowsCommand } from 'src/features/draft/commands/impl/api-patch-rows.command';
import { PatchRowsCommand } from 'src/features/draft/commands/impl/patch-rows.command';
import { ApiPatchRowsHandlerReturnType } from 'src/features/draft/commands/types/api-patch-rows.handler.types';
import { PatchRowsHandlerReturnType } from 'src/features/draft/commands/types/patch-rows.handler.types';
import { MigrationLockService } from 'src/features/migration/services/migration-lock.service';
import { ShareCommands } from 'src/features/share/share.commands';

@CommandHandler(ApiPatchRowsCommand)
export class ApiPatchRowsHandler
  extends ApiBaseRowHandler
  implements ICommandHandler<ApiPatchRowsCommand, ApiPatchRowsHandlerReturnType>
{
  constructor(
    protected readonly commandBus: CommandBus,
    protected readonly queryBus: QueryBus,
    protected readonly transactionService: TransactionPrismaService,
    protected readonly shareCommands: ShareCommands,
    protected readonly rowApi: RowApiService,
    protected readonly migrationLockService: MigrationLockService,
  ) {
    super(queryBus, shareCommands, rowApi);
  }

  async execute({ data }: ApiPatchRowsCommand) {
    await this.migrationLockService.checkRevisionLock(data.revisionId);
    const result: PatchRowsHandlerReturnType =
      await this.transactionService.runSerializable(async () =>
        this.commandBus.execute(
          new PatchRowsCommand({
            revisionId: data.revisionId,
            tableId: data.tableId,
            rows: data.rows,
          }),
        ),
      );

    return this.getTableAndRows({
      revisionId: data.revisionId,
      tableId: data.tableId,
      result,
      affectedRows: result.patchedRows,
      operationName: 'patch',
    });
  }
}
