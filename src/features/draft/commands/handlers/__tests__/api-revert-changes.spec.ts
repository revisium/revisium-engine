import { CommandBus } from '@nestjs/cqrs';
import { prepareProject } from 'src/__tests__/utils/prepareProject';
import {
  ApiRevertChangesCommand,
  ApiRevertChangesCommandReturnType,
} from 'src/features/draft/commands/impl/api-revert-changes.command';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { createTestingModule } from 'src/features/draft/commands/handlers/__tests__/utils';

describe('ApiRevertChangesHandler', () => {
  it('should revert changes', async () => {
    const { branchId, projectId, branchName, draftRevisionId } =
      await prepareProject(prismaService);
    await prismaService.revision.update({
      where: {
        id: draftRevisionId,
      },
      data: {
        hasChanges: true,
      },
    });

    const command = new ApiRevertChangesCommand({
      projectId,
      branchName,
    });

    const result = await execute(command);

    expect(result.id).toStrictEqual(branchId);
  });

  let prismaService: PrismaService;
  let commandBus: CommandBus;

  function execute(
    command: ApiRevertChangesCommand,
  ): Promise<ApiRevertChangesCommandReturnType> {
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
