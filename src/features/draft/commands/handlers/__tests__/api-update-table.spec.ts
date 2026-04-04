import { CommandBus } from '@nestjs/cqrs';
import { prepareProject } from 'src/__tests__/utils/prepareProject';
import { ApiUpdateTableCommand } from 'src/features/draft/commands/impl/api-update-table.command';
import { ApiUpdateTableHandlerReturnType } from 'src/features/draft/commands/types/api-update-table.handler.types';
import { JsonSchemaTypeName } from '@revisium/schema-toolkit/types';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { createTestingModule } from 'src/features/draft/commands/handlers/__tests__/utils';

describe('ApiUpdateTableHandler', () => {
  it('should update the table', async () => {
    const { draftRevisionId, tableId, draftTableVersionId } =
      await prepareProject(prismaService);

    const command = new ApiUpdateTableCommand({
      revisionId: draftRevisionId,
      tableId,
      patches: [
        {
          op: 'replace',
          path: '/properties/ver',
          value: {
            type: JsonSchemaTypeName.String,
            default: '',
          },
        },
      ],
    });

    const result = await execute(command);

    const table = await prismaService.table.findFirstOrThrow({
      where: {
        versionId: draftTableVersionId,
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
    command: ApiUpdateTableCommand,
  ): Promise<ApiUpdateTableHandlerReturnType> {
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
