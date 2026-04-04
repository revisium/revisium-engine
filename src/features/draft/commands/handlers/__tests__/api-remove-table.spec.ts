import { CommandBus } from '@nestjs/cqrs';
import { prepareProject } from 'src/__tests__/utils/prepareProject';
import { ApiRemoveTableCommand } from 'src/features/draft/commands/impl/api-remove-table.command';
import { ApiRemoveTableHandlerReturnType } from 'src/features/draft/commands/types/api-remove-table.handler.types';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { createTestingModule } from 'src/features/draft/commands/handlers/__tests__/utils';

describe('ApiRemoveTableHandler', () => {
  it('should remove the table', async () => {
    const { draftRevisionId, tableId, branchId } =
      await prepareProject(prismaService);

    const command = new ApiRemoveTableCommand({
      revisionId: draftRevisionId,
      tableId,
    });

    const result = await execute(command);

    expect(result.branch.id).toBe(branchId);
  });

  let prismaService: PrismaService;
  let commandBus: CommandBus;

  function execute(
    command: ApiRemoveTableCommand,
  ): Promise<ApiRemoveTableHandlerReturnType> {
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
