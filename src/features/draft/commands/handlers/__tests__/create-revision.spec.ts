import { CommandBus } from '@nestjs/cqrs';
import {
  prepareProject,
  PrepareProjectReturnType,
} from 'src/__tests__/utils/prepareProject';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';
import { createTestingModule } from 'src/features/draft/commands/handlers/__tests__/utils';
import { CreateRevisionCommand } from 'src/features/draft/commands/impl/create-revision.command';
import { CreateRevisionHandlerReturnType } from 'src/features/draft/commands/types/create-revision.handler.types';
import { ShareTransactionalQueries } from 'src/features/share/share.transactional.queries';

describe('CreateRevisionHandler', () => {
  it('should throw an error if the branch does not exist in the project', async () => {
    const ids = await prepareProject(prismaService);
    const { projectId, branchName } = ids;
    await prepareRevision(ids);

    jest
      .spyOn(shareTransactionalQueries, 'findBranchInProjectOrThrow')
      .mockRejectedValue(new Error('Branch not found'));

    const command = new CreateRevisionCommand({
      projectId,
      branchName,
    });

    await expect(runTransaction(command)).rejects.toThrow('Branch not found');
  });

  it('should create a new draft revision if there are changes', async () => {
    const ids = await prepareProject(prismaService);
    const { projectId, branchName, headRevisionId, draftRevisionId } = ids;
    await prepareRevision(ids);

    const command = new CreateRevisionCommand({
      projectId,
      branchName,
      comment: 'comment',
    });
    const result = await runTransaction(command);

    expect(result.previousDraftRevisionId).toEqual(draftRevisionId);
    expect(result.previousHeadRevisionId).toEqual(headRevisionId);
    expect(result.nextDraftRevisionId).not.toEqual(draftRevisionId);
  });

  async function prepareRevision(ids: PrepareProjectReturnType) {
    await prismaService.revision.update({
      where: { id: ids.draftRevisionId },
      data: { hasChanges: true },
    });
  }

  let prismaService: PrismaService;
  let commandBus: CommandBus;
  let transactionService: TransactionPrismaService;
  let shareTransactionalQueries: ShareTransactionalQueries;

  function runTransaction(
    command: CreateRevisionCommand,
  ): Promise<CreateRevisionHandlerReturnType> {
    return transactionService.run(async () => commandBus.execute(command));
  }

  beforeAll(async () => {
    const result = await createTestingModule();
    prismaService = result.prismaService;
    commandBus = result.commandBus;
    transactionService = result.transactionService;
    shareTransactionalQueries = result.shareTransactionalQueries;
  });

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await prismaService.$disconnect();
  });
});
