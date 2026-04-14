import type { DraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import {
  givenDraftProject,
  givenDraftProjectWithRows,
  givenReadonlyDraftTable,
} from 'src/__tests__/fixtures/scenarios/given-draft-project';
import { ApiRemoveRowsCommand } from 'src/features/draft/commands/impl/api-remove-rows.command';
import { ApiRemoveRowsHandlerReturnType } from 'src/features/draft/commands/types/api-remove-rows.handler.types';
import {
  createTestingModule,
  testSchema,
} from 'src/features/draft/commands/handlers/__tests__/utils';

describe('ApiRemoveRowsHandler', () => {
  let kit: DraftTestKit;

  it('should remove multiple rows', async () => {
    const draft = await givenDraftProjectWithRows({
      prismaService: kit.prismaService,
      schema: testSchema,
      rows: [{ data: { ver: 10 }, draftData: { ver: 20 } }],
    });
    const row2Id = draft.extraRowIds[0];

    if (!row2Id) {
      throw new Error('Expected an extra row to be created');
    }

    const command = new ApiRemoveRowsCommand({
      revisionId: draft.draftRevisionId,
      tableId: draft.tableId,
      rowIds: [draft.rowId, row2Id],
    });

    const result = await execute(command);

    const remainingRows = await kit.prismaService.row.findMany({
      where: {
        id: {
          in: [draft.rowId, row2Id],
        },
        tables: {
          some: {
            versionId: draft.draftTableVersionId,
          },
        },
      },
    });
    expect(remainingRows).toHaveLength(0);
    expect(result.table?.versionId).toBe(draft.draftTableVersionId);
    expect(result.previousVersionTableId).toBe(draft.draftTableVersionId);
    expect(result.branch.id).toBe(draft.branchId);
  });

  it('should notify endpoints if a new table was created', async () => {
    const draft = await givenDraftProjectWithRows({
      prismaService: kit.prismaService,
      schema: testSchema,
      rows: [{ data: { ver: 10 }, draftData: { ver: 20 } }],
    });
    const row2Id = draft.extraRowIds[0];

    if (!row2Id) {
      throw new Error('Expected an extra row to be created');
    }

    await givenReadonlyDraftTable({
      prismaService: kit.prismaService,
      draftTableVersionId: draft.draftTableVersionId,
    });

    const command = new ApiRemoveRowsCommand({
      revisionId: draft.draftRevisionId,
      tableId: draft.tableId,
      rowIds: [draft.rowId, row2Id],
    });

    const result = await execute(command);

    expect(result.table?.versionId).not.toBe(draft.draftTableVersionId);
    expect(result.previousVersionTableId).toBe(draft.draftTableVersionId);
  });

  it('should remove a single row', async () => {
    const draft = await givenDraftProject(kit.prismaService);

    const command = new ApiRemoveRowsCommand({
      revisionId: draft.draftRevisionId,
      tableId: draft.tableId,
      rowIds: [draft.rowId],
    });

    const result = await execute(command);

    const row = await kit.prismaService.row.findFirst({
      where: {
        id: draft.rowId,
        tables: {
          some: {
            versionId: draft.draftTableVersionId,
          },
        },
      },
    });
    expect(row).toBeNull();
    expect(result.table?.versionId).toBe(draft.draftTableVersionId);
    expect(result.previousVersionTableId).toBe(draft.draftTableVersionId);
    expect(result.branch.id).toBe(draft.branchId);
  });

  function execute(
    command: ApiRemoveRowsCommand,
  ): Promise<ApiRemoveRowsHandlerReturnType> {
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
