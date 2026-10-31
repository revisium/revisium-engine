import {
  CommandBus,
  CommandHandler,
  ICommandHandler,
  QueryBus,
} from '@nestjs/cqrs';
import { GetBranchByIdQuery } from 'src/features/branch/quieries/impl';
import { ApiCreateTableCommand } from 'src/features/draft/commands/impl/api-create-table.command';
import { CreateTableCommand } from 'src/features/draft/commands/impl/create-table.command';
import { ApiCreateTableHandlerReturnType } from 'src/features/draft/commands/types/api-create-table.handler.types';
import { CreateTableHandlerReturnType } from 'src/features/draft/commands/types/create-table.handler.types';
import { DraftWriteAdmissionService } from 'src/features/draft/draft-write-admission.service';
import { ShareCommands } from 'src/features/share/share.commands';
import { GetTableByIdQuery } from 'src/features/table/queries/impl/get-table-by-id.query';

@CommandHandler(ApiCreateTableCommand)
export class ApiCreateTableHandler implements ICommandHandler<
  ApiCreateTableCommand,
  ApiCreateTableHandlerReturnType
> {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
    private readonly shareCommands: ShareCommands,
    private readonly draftWriteAdmission: DraftWriteAdmissionService,
  ) {}

  async execute({ data }: ApiCreateTableCommand) {
    const { branchId, tableVersionId }: CreateTableHandlerReturnType =
      await this.draftWriteAdmission.runSerializableRevisionWrite(
        data.revisionId,
        async () =>
          this.commandBus.execute<
            CreateTableCommand,
            CreateTableHandlerReturnType
          >(new CreateTableCommand(data)),
      );

    await this.shareCommands.notifyEndpoints({ revisionId: data.revisionId });

    const result: ApiCreateTableHandlerReturnType = {
      branch: await this.queryBus.execute(new GetBranchByIdQuery(branchId)),
      table: await this.queryBus.execute(
        new GetTableByIdQuery({ revisionId: data.revisionId, tableVersionId }),
      ),
    };

    return result;
  }
}
