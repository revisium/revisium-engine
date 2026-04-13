import {
  CommandBus,
  CommandHandler,
  ICommandHandler,
  QueryBus,
} from '@nestjs/cqrs';
import {
  ApiRenameTableCommand,
  ApiRenameTableCommandReturnType,
} from 'src/features/draft/commands/impl/api-rename-table.command';
import {
  RenameTableCommand,
  RenameTableCommandReturnType,
} from 'src/features/draft/commands/impl/rename-table.command';
import { MigrationLockService } from 'src/features/migration/services/migration-lock.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';
import { ShareCommands } from 'src/features/share/share.commands';
import { GetTableByIdQuery } from 'src/features/table/queries/impl/get-table-by-id.query';
import { GetTableByIdReturnType } from 'src/features/table/queries/types';

@CommandHandler(ApiRenameTableCommand)
export class ApiRenameTableHandler implements ICommandHandler<
  ApiRenameTableCommand,
  ApiRenameTableCommandReturnType
> {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
    private readonly transactionService: TransactionPrismaService,
    private readonly shareCommands: ShareCommands,
    private readonly migrationLockService: MigrationLockService,
  ) {}

  async execute({ data }: ApiRenameTableCommand) {
    await this.migrationLockService.checkRevisionLock(data.revisionId);
    const {
      tableVersionId,
      previousTableVersionId,
    }: RenameTableCommandReturnType =
      await this.transactionService.runSerializable(async () =>
        this.commandBus.execute<
          RenameTableCommand,
          RenameTableCommandReturnType
        >(new RenameTableCommand(data)),
      );

    await this.shareCommands.notifyEndpoints({ revisionId: data.revisionId });

    const table = await this.queryBus.execute<
      GetTableByIdQuery,
      GetTableByIdReturnType
    >(new GetTableByIdQuery({ revisionId: data.revisionId, tableVersionId }));

    const result: ApiRenameTableCommandReturnType = {
      table,
      previousVersionTableId: previousTableVersionId,
    };

    return result;
  }
}
