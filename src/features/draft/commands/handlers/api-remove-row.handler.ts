import {
  CommandBus,
  CommandHandler,
  ICommandHandler,
  QueryBus,
} from '@nestjs/cqrs';
import { GetBranchByIdQuery } from 'src/features/branch/quieries/impl';
import { GetBranchByIdReturnType } from 'src/features/branch/quieries/types/get-branch-by-id.types';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';
import { ApiRemoveRowCommand } from 'src/features/draft/commands/impl/api-remove-row.command';
import { RemoveRowsCommand } from 'src/features/draft/commands/impl/remove-rows.command';
import { ApiRemoveRowHandlerReturnType } from 'src/features/draft/commands/types/api-remove-row.handler.types';
import { RemoveRowsHandlerReturnType } from 'src/features/draft/commands/types/remove-rows.handler.types';
import { MigrationLockService } from 'src/features/migration/services/migration-lock.service';
import { ShareCommands } from 'src/features/share/share.commands';
import { GetTableByIdQuery } from 'src/features/table/queries/impl/get-table-by-id.query';
import { GetTableByIdReturnType } from 'src/features/table/queries/types';

@CommandHandler(ApiRemoveRowCommand)
export class ApiRemoveRowHandler implements ICommandHandler<
  ApiRemoveRowCommand,
  ApiRemoveRowHandlerReturnType
> {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
    private readonly transactionService: TransactionPrismaService,
    private readonly shareCommands: ShareCommands,
    private readonly migrationLockService: MigrationLockService,
  ) {}

  async execute({ data }: ApiRemoveRowCommand) {
    await this.migrationLockService.checkRevisionLock(data.revisionId);
    const { rowId, ...rest } = data;
    const {
      branchId,
      tableVersionId,
      previousTableVersionId,
    }: RemoveRowsHandlerReturnType =
      await this.transactionService.runSerializable(async () =>
        this.commandBus.execute<RemoveRowsCommand, RemoveRowsHandlerReturnType>(
          new RemoveRowsCommand({ ...rest, rowIds: [rowId] }),
        ),
      );

    if (tableVersionId !== previousTableVersionId) {
      await this.shareCommands.notifyEndpoints({ revisionId: data.revisionId });
    }

    const branch = await this.queryBus.execute<
      GetBranchByIdQuery,
      GetBranchByIdReturnType
    >(new GetBranchByIdQuery(branchId));

    const table = tableVersionId
      ? await this.queryBus.execute<GetTableByIdQuery, GetTableByIdReturnType>(
          new GetTableByIdQuery({
            revisionId: data.revisionId,
            tableVersionId,
          }),
        )
      : undefined;

    const result: ApiRemoveRowHandlerReturnType = {
      table,
      previousVersionTableId: previousTableVersionId,
      branch,
    };

    return result;
  }
}
