import { CommandHandler } from '@nestjs/cqrs';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';
import { CreateRevisionHandlerReturnType } from 'src/features/draft/commands/types/create-revision.handler.types';
import { CreateRevisionCommand } from 'src/features/draft/commands/impl/create-revision.command';
import { DraftContextService } from 'src/features/draft/draft-context.service';
import { DraftHandler } from 'src/features/draft/draft.handler';
import { ShareTransactionalQueries } from 'src/features/share/share.transactional.queries';
import { DraftRevisionApiService } from 'src/features/draft-revision/draft-revision-api.service';

@CommandHandler(CreateRevisionCommand)
export class CreateRevisionHandler extends DraftHandler<
  CreateRevisionCommand,
  CreateRevisionHandlerReturnType
> {
  constructor(
    protected readonly draftContext: DraftContextService,
    protected readonly transactionService: TransactionPrismaService,
    protected readonly shareTransactionalQueries: ShareTransactionalQueries,
    protected readonly draftRevisionApi: DraftRevisionApiService,
  ) {
    super(transactionService, draftContext);
  }

  protected async handler({
    data,
  }: CreateRevisionCommand): Promise<CreateRevisionHandlerReturnType> {
    const { projectId, branchName, comment } = data;

    const { id: branchId } =
      await this.shareTransactionalQueries.findBranchInProjectOrThrow(
        projectId,
        branchName,
      );

    const {
      previousHeadRevisionId,
      previousDraftRevisionId,
      nextDraftRevisionId,
    } = await this.draftRevisionApi.commit({ branchId, comment });

    return {
      previousHeadRevisionId,
      previousDraftRevisionId,
      nextDraftRevisionId,
    };
  }
}
