import {
  CommandBus,
  CommandHandler,
  ICommandHandler,
  QueryBus,
} from '@nestjs/cqrs';
import { GetBranchByIdQuery } from 'src/features/branch/quieries/impl';
import { MigrationLockService } from 'src/features/migration/services/migration-lock.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';
import {
  ApiRevertChangesCommand,
  ApiRevertChangesCommandReturnType,
} from 'src/features/draft/commands/impl/api-revert-changes.command';
import { RevertChangesCommand } from 'src/features/draft/commands/impl/revert-changes.command';
import { RevertChangesHandlerReturnType } from 'src/features/draft/commands/types/revert-changes.handler.types';
import { ShareCommands } from 'src/features/share/share.commands';

@CommandHandler(ApiRevertChangesCommand)
export class ApiRevertChangesHandler implements ICommandHandler<
  ApiRevertChangesCommand,
  ApiRevertChangesCommandReturnType
> {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
    private readonly transactionService: TransactionPrismaService,
    private readonly shareCommands: ShareCommands,
    private readonly migrationLockService: MigrationLockService,
  ) {}

  async execute({ data }: ApiRevertChangesCommand) {
    const { branchId, draftRevisionId }: RevertChangesHandlerReturnType =
      await this.transactionService.runSerializable(async () =>
        this.revertWithinTransaction(data),
      );

    await this.shareCommands.notifyEndpoints({ revisionId: draftRevisionId });

    return this.queryBus.execute(new GetBranchByIdQuery(branchId));
  }

  private async revertWithinTransaction(
    data: ApiRevertChangesCommand['data'],
  ): Promise<RevertChangesHandlerReturnType> {
    await this.migrationLockService.cancelBranchMigrations(
      data.projectId,
      data.branchName,
    );

    return this.commandBus.execute<
      RevertChangesCommand,
      RevertChangesHandlerReturnType
    >(new RevertChangesCommand(data));
  }
}
