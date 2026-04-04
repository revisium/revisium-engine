import { CommandBus } from '@nestjs/cqrs';
import { prepareProject } from 'src/__tests__/utils/prepareProject';
import { ApiRemoveRowCommand } from 'src/features/draft/commands/impl/api-remove-row.command';
import { ApiRemoveRowHandlerReturnType } from 'src/features/draft/commands/types/api-remove-row.handler.types';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { createTestingModule } from 'src/features/draft/commands/handlers/__tests__/utils';

describe('ApiRemoveRowHandler', () => {
  it('should remove the row', async () => {
    const { branchId, draftRevisionId, tableId, draftTableVersionId, rowId } =
      await prepareProject(prismaService);

    const command = new ApiRemoveRowCommand({
      revisionId: draftRevisionId,
      tableId,
      rowId,
    });

    const result = await execute(command);

    const row = await prismaService.row.findFirst({
      where: {
        id: rowId,
        tables: {
          some: {
            versionId: draftTableVersionId,
          },
        },
      },
    });
    expect(row).toBeNull();
    expect(result.table?.versionId).toBe(draftTableVersionId);
    expect(result.previousVersionTableId).toBe(draftTableVersionId);
    expect(result.branch.id).toBe(branchId);
  });

  it('should notify endpoints if a new table was created', async () => {
    const { draftRevisionId, tableId, draftTableVersionId, rowId } =
      await prepareProject(prismaService);
    await prismaService.table.update({
      where: {
        versionId: draftTableVersionId,
      },
      data: {
        readonly: true,
      },
    });

    const command = new ApiRemoveRowCommand({
      revisionId: draftRevisionId,
      tableId,
      rowId,
    });

    const result = await execute(command);

    expect(result.table?.versionId).not.toBe(draftTableVersionId);
    expect(result.previousVersionTableId).toBe(draftTableVersionId);
  });

  let prismaService: PrismaService;
  let commandBus: CommandBus;

  function execute(
    command: ApiRemoveRowCommand,
  ): Promise<ApiRemoveRowHandlerReturnType> {
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
