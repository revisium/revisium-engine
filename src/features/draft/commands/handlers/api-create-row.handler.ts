import { InternalServerErrorException } from '@nestjs/common';
import {
  CommandBus,
  CommandHandler,
  ICommandHandler,
  QueryBus,
} from '@nestjs/cqrs';
import { ApiBaseRowHandler } from 'src/features/draft/commands/handlers/api-base-row.handler';
import { RowApiService } from 'src/features/row/row-api.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';
import { ApiCreateRowCommand } from 'src/features/draft/commands/impl/api-create-row.command';
import { CreateRowsCommand } from 'src/features/draft/commands/impl/create-rows.command';
import { ApiCreateRowHandlerReturnType } from 'src/features/draft/commands/types/api-create-row.handler.types';
import { CreateRowsHandlerReturnType } from 'src/features/draft/commands/types/create-rows.handler.types';
import { MigrationLockService } from 'src/features/migration/services/migration-lock.service';
import { ShareCommands } from 'src/features/share/share.commands';

@CommandHandler(ApiCreateRowCommand)
export class ApiCreateRowHandler
  extends ApiBaseRowHandler
  implements ICommandHandler<ApiCreateRowCommand, ApiCreateRowHandlerReturnType>
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

  async execute({ data }: ApiCreateRowCommand) {
    await this.migrationLockService.checkRevisionLock(data.revisionId);
    const result: CreateRowsHandlerReturnType =
      await this.transactionService.runSerializable(async () =>
        this.commandBus.execute(
          new CreateRowsCommand({
            revisionId: data.revisionId,
            tableId: data.tableId,
            rows: [{ rowId: data.rowId, data: data.data }],
          }),
        ),
      );

    await this.tryToNotifyEndpoints({
      tableVersionId: result.tableVersionId,
      previousTableVersionId: result.previousTableVersionId,
      revisionId: data.revisionId,
    });

    const createdRow = result.createdRows[0];
    if (!createdRow) {
      throw new InternalServerErrorException('Invalid ApiCreateRowHandler');
    }

    const { table, row } = await this.getTableAndRow({
      revisionId: data.revisionId,
      tableVersionId: result.tableVersionId,
      tableId: data.tableId,
      rowId: data.rowId,
      rowVersionId: createdRow.rowVersionId,
    });

    if (!table || !row) {
      throw new InternalServerErrorException('Invalid ApiCreateRowHandler');
    }

    return {
      table,
      previousVersionTableId: result.previousTableVersionId,
      row,
    };
  }
}
