import type { DraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import {
  givenDraftProject,
  givenReadonlyDraftTable,
} from 'src/__tests__/fixtures/scenarios/given-draft-project';
import {
  ApiRenameRowCommand,
  ApiRenameRowCommandReturnType,
} from 'src/features/draft/commands/impl/api-rename-row.command';
import { createTestingModule } from 'src/features/draft/commands/handlers/__tests__/utils';

describe('ApiRenameRowHandler', () => {
  const nextRowId = 'nextRowId';
  let kit: DraftTestKit;

  it('should update the row', async () => {
    const draft = await givenDraftProject(kit.prismaService);

    const command = new ApiRenameRowCommand({
      revisionId: draft.draftRevisionId,
      tableId: draft.tableId,
      rowId: draft.rowId,
      nextRowId,
    });

    const result = await execute(command);

    const row = await kit.prismaService.row.findFirstOrThrow({
      where: {
        id: nextRowId,
        tables: {
          some: {
            revisions: {
              some: {
                id: draft.draftRevisionId,
              },
            },
          },
        },
      },
    });
    expect(result.row).toMatchObject({
      ...row,
      data: { ver: 2 },
      context: {
        revisionId: draft.draftRevisionId,
        tableId: draft.tableId,
      },
    });
    expect(result.table?.versionId).toBe(draft.draftTableVersionId);
    expect(result.previousVersionTableId).toBe(draft.draftTableVersionId);
  });

  it('should notify endpoints if a new table was created', async () => {
    const draft = await givenDraftProject(kit.prismaService);
    await givenReadonlyDraftTable({
      prismaService: kit.prismaService,
      draftTableVersionId: draft.draftTableVersionId,
    });

    const command = new ApiRenameRowCommand({
      revisionId: draft.draftRevisionId,
      tableId: draft.tableId,
      rowId: draft.rowId,
      nextRowId,
    });

    const result = await execute(command);

    expect(result.table?.versionId).not.toBe(draft.draftTableVersionId);
    expect(result.previousVersionTableId).toBe(draft.draftTableVersionId);
  });

  function execute(
    command: ApiRenameRowCommand,
  ): Promise<ApiRenameRowCommandReturnType> {
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
