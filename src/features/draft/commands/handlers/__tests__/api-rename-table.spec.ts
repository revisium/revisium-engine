import { CommandBus } from '@nestjs/cqrs';
import { prepareProject } from 'src/__tests__/utils/prepareProject';
import {
  ApiRenameTableCommand,
  ApiRenameTableCommandReturnType,
} from 'src/features/draft/commands/impl/api-rename-table.command';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { createTestingModule } from 'src/features/draft/commands/handlers/__tests__/utils';

describe('ApiRenameTableHandler', () => {
  const nextTableId = 'nextTableId';

  it('should rename the table', async () => {
    const { draftRevisionId, tableId, draftTableVersionId } =
      await prepareProject(prismaService);

    const command = new ApiRenameTableCommand({
      revisionId: draftRevisionId,
      tableId,
      nextTableId,
    });

    const result = await execute(command);

    const table = await prismaService.table.findFirstOrThrow({
      where: {
        id: nextTableId,
        revisions: {
          some: {
            id: draftRevisionId,
          },
        },
      },
    });

    expect(result.previousVersionTableId).toBe(draftTableVersionId);
    expect(result.table).toStrictEqual({
      ...table,
      context: {
        revisionId: draftRevisionId,
      },
    });
  });

  let prismaService: PrismaService;
  let commandBus: CommandBus;

  function execute(
    command: ApiRenameTableCommand,
  ): Promise<ApiRenameTableCommandReturnType> {
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
