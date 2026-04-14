import type { DraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import {
  givenDraftProject,
  givenReadonlyDraftTable,
} from 'src/__tests__/fixtures/scenarios/given-draft-project';
import { ApiCreateRowCommand } from 'src/features/draft/commands/impl/api-create-row.command';
import { ApiCreateRowHandlerReturnType } from 'src/features/draft/commands/types/api-create-row.handler.types';
import { createTestingModule } from 'src/features/draft/commands/handlers/__tests__/utils';

describe('ApiCreateRowHandler', () => {
  let kit: DraftTestKit;

  it('should create a new row', async () => {
    const draft = await givenDraftProject(kit.prismaService);

    const newRowId = 'newRowId';
    const command = new ApiCreateRowCommand({
      revisionId: draft.draftRevisionId,
      tableId: draft.tableId,
      rowId: newRowId,
      data: { ver: 1 },
    });

    const result = await execute(command);

    const row = await kit.prismaService.row.findFirstOrThrow({
      where: {
        id: newRowId,
        tables: {
          some: {
            versionId: draft.draftTableVersionId,
          },
        },
      },
    });
    expect(result.row).toMatchObject({
      ...row,
      context: {
        revisionId: draft.draftRevisionId,
        tableId: draft.tableId,
      },
    });
    expect(result.table.versionId).toBe(draft.draftTableVersionId);
    expect(result.previousVersionTableId).toBe(draft.draftTableVersionId);
  });

  it('should create a new table version when table is readonly', async () => {
    const draft = await givenDraftProject(kit.prismaService);
    await givenReadonlyDraftTable({
      prismaService: kit.prismaService,
      draftTableVersionId: draft.draftTableVersionId,
    });

    const newRowId = 'newRowId';
    const command = new ApiCreateRowCommand({
      revisionId: draft.draftRevisionId,
      tableId: draft.tableId,
      rowId: newRowId,
      data: { ver: 1 },
    });

    const result = await execute(command);

    expect(result.table.versionId).not.toBe(draft.draftTableVersionId);
    expect(result.previousVersionTableId).toBe(draft.draftTableVersionId);
  });

  function execute(
    command: ApiCreateRowCommand,
  ): Promise<ApiCreateRowHandlerReturnType> {
    return kit.commandBus.execute(command);
  }

  beforeAll(async () => {
    kit = await createTestingModule();
  });

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    if (kit) {
      await kit.close();
    }
  });
});
