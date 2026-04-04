import { CommandBus } from '@nestjs/cqrs';
import { prepareProject } from 'src/__tests__/utils/prepareProject';
import {
  ApiPatchRowCommand,
  ApiPatchRowCommandReturnType,
} from 'src/features/draft/commands/impl/api-patch-row.command';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { createTestingModule } from 'src/features/draft/commands/handlers/__tests__/utils';

describe('ApiPatchRowHandler', () => {
  it('should patch the row', async () => {
    const { draftRevisionId, tableId, draftTableVersionId, rowId } =
      await prepareProject(prismaService);

    const command = new ApiPatchRowCommand({
      revisionId: draftRevisionId,
      tableId,
      rowId,
      patches: [
        {
          op: 'replace',
          path: 'ver',
          value: 100,
        },
      ],
    });

    const result = await execute(command);

    const row = await prismaService.row.findFirstOrThrow({
      where: {
        id: rowId,
        tables: {
          some: {
            versionId: draftTableVersionId,
          },
        },
      },
    });
    expect(result.row).toMatchObject({
      ...row,
      data: { ver: 100 },
      context: {
        revisionId: draftRevisionId,
        tableId,
      },
    });
    expect(result.table?.versionId).toBe(draftTableVersionId);
    expect(result.previousVersionTableId).toBe(draftTableVersionId);
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

    const command = new ApiPatchRowCommand({
      revisionId: draftRevisionId,
      tableId,
      rowId,
      patches: [
        {
          op: 'replace',
          path: 'ver',
          value: 100,
        },
      ],
    });

    const result = await execute(command);

    expect(result.table?.versionId).not.toBe(draftTableVersionId);
    expect(result.previousVersionTableId).toBe(draftTableVersionId);
  });

  let prismaService: PrismaService;
  let commandBus: CommandBus;

  function execute(
    command: ApiPatchRowCommand,
  ): Promise<ApiPatchRowCommandReturnType> {
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
