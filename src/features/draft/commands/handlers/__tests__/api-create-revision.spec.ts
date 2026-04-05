import { CommandBus } from '@nestjs/cqrs';
import { prepareProject } from 'src/__tests__/utils/prepareProject';
import {
  ApiCreateRevisionCommand,
  ApiCreateRevisionCommandReturnType,
} from 'src/features/draft/commands/impl/api-create-revision.command';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { createTestingModule } from 'src/features/draft/commands/handlers/__tests__/utils';

describe('ApiCreateRevisionHandler', () => {
  it('should create a new draft revision', async () => {
    const { projectId, branchName, draftRevisionId } =
      await prepareProject(prismaService);
    await prismaService.revision.update({
      where: {
        id: draftRevisionId,
      },
      data: {
        hasChanges: true,
      },
    });

    const command = new ApiCreateRevisionCommand({
      projectId,
      branchName,
      comment: 'comment',
    });

    const result = await execute(command);

    const committedHeadRevision =
      await prismaService.revision.findUniqueOrThrow({
        where: { id: draftRevisionId },
      });
    expect(committedHeadRevision.isHead).toBe(true);
    expect(committedHeadRevision.isDraft).toBe(false);

    const { previousHeadRevisionId, previousDraftRevisionId, ...revision } =
      result;
    expect(revision).toStrictEqual(committedHeadRevision);
    expect(previousDraftRevisionId).toBe(draftRevisionId);
    expect(typeof previousHeadRevisionId).toBe('string');
  });

  let prismaService: PrismaService;
  let commandBus: CommandBus;

  function execute(
    command: ApiCreateRevisionCommand,
  ): Promise<ApiCreateRevisionCommandReturnType> {
    return commandBus.execute(command);
  }

  beforeAll(async () => {
    const result = await createTestingModule();
    prismaService = result.prismaService;
    commandBus = result.commandBus;
  });

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await prismaService.$disconnect();
  });
});
