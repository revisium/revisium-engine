import { CommandBus, CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { RevisionsApiService } from 'src/features/revision';
import { MigrationLockService } from 'src/features/migration/services/migration-lock.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';
import {
  ApiCreateRevisionCommand,
  ApiCreateRevisionCommandReturnType,
} from 'src/features/draft/commands/impl/api-create-revision.command';
import { CreateRevisionCommand } from 'src/features/draft/commands/impl/create-revision.command';
import { CreateRevisionHandlerReturnType } from 'src/features/draft/commands/types/create-revision.handler.types';

@CommandHandler(ApiCreateRevisionCommand)
export class ApiCreateRevisionHandler implements ICommandHandler<
  ApiCreateRevisionCommand,
  ApiCreateRevisionCommandReturnType
> {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly transactionService: TransactionPrismaService,
    private readonly revisionApi: RevisionsApiService,
    private readonly migrationLockService: MigrationLockService,
  ) {}

  async execute({ data }: ApiCreateRevisionCommand) {
    await this.migrationLockService.checkBranchLock(
      data.projectId,
      data.branchName,
    );
    const {
      previousDraftRevisionId,
      previousHeadRevisionId,
    }: CreateRevisionHandlerReturnType =
      await this.transactionService.runSerializable(async () =>
        this.commandBus.execute<
          CreateRevisionCommand,
          CreateRevisionHandlerReturnType
        >(new CreateRevisionCommand(data)),
      );

    const revision = await this.revisionApi.revision({
      revisionId: previousDraftRevisionId,
    });

    return {
      ...revision,
      previousHeadRevisionId,
      previousDraftRevisionId,
    };
  }
}
