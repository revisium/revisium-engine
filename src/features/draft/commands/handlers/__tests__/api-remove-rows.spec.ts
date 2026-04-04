import { CommandBus } from '@nestjs/cqrs';
import { prepareProject, prepareRow } from 'src/__tests__/utils/prepareProject';
import { ApiRemoveRowsCommand } from 'src/features/draft/commands/impl/api-remove-rows.command';
import { ApiRemoveRowsHandlerReturnType } from 'src/features/draft/commands/types/api-remove-rows.handler.types';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import {
  createTestingModule,
  testSchema,
} from 'src/features/draft/commands/handlers/__tests__/utils';

describe('ApiRemoveRowsHandler', () => {
  it('should remove multiple rows', async () => {
    const {
      branchId,
      draftRevisionId,
      tableId,
      draftTableVersionId,
      headTableVersionId,
      rowId,
    } = await prepareProject(prismaService);

    const row2 = await prepareRow({
      prismaService,
      headTableVersionId,
      draftTableVersionId,
      data: { ver: 10 },
      dataDraft: { ver: 20 },
      schema: testSchema,
    });

    const command = new ApiRemoveRowsCommand({
      revisionId: draftRevisionId,
      tableId,
      rowIds: [rowId, row2.rowId],
    });

    const result = await execute(command);

    const remainingRows = await prismaService.row.findMany({
      where: {
        id: {
          in: [rowId, row2.rowId],
        },
        tables: {
          some: {
            versionId: draftTableVersionId,
          },
        },
      },
    });
    expect(remainingRows).toHaveLength(0);
    expect(result.table?.versionId).toBe(draftTableVersionId);
    expect(result.previousVersionTableId).toBe(draftTableVersionId);
    expect(result.branch.id).toBe(branchId);
  });

  it('should notify endpoints if a new table was created', async () => {
    const {
      draftRevisionId,
      tableId,
      draftTableVersionId,
      headTableVersionId,
      rowId,
    } = await prepareProject(prismaService);

    const row2 = await prepareRow({
      prismaService,
      headTableVersionId,
      draftTableVersionId,
      data: { ver: 10 },
      dataDraft: { ver: 20 },
      schema: testSchema,
    });

    await prismaService.table.update({
      where: {
        versionId: draftTableVersionId,
      },
      data: {
        readonly: true,
      },
    });

    const command = new ApiRemoveRowsCommand({
      revisionId: draftRevisionId,
      tableId,
      rowIds: [rowId, row2.rowId],
    });

    const result = await execute(command);

    expect(result.table?.versionId).not.toBe(draftTableVersionId);
    expect(result.previousVersionTableId).toBe(draftTableVersionId);
  });

  it('should remove a single row', async () => {
    const { branchId, draftRevisionId, tableId, draftTableVersionId, rowId } =
      await prepareProject(prismaService);

    const command = new ApiRemoveRowsCommand({
      revisionId: draftRevisionId,
      tableId,
      rowIds: [rowId],
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

  let prismaService: PrismaService;
  let commandBus: CommandBus;

  function execute(
    command: ApiRemoveRowsCommand,
  ): Promise<ApiRemoveRowsHandlerReturnType> {
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
