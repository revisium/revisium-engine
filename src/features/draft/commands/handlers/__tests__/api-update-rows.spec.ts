import type { DraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import {
  givenDraftProject,
  givenDraftProjectWithRows,
  givenReadonlyDraftTable,
} from 'src/__tests__/fixtures/scenarios/given-draft-project';
import { ApiUpdateRowsCommand } from 'src/features/draft/commands/impl/api-update-rows.command';
import { ApiUpdateRowsHandlerReturnType } from 'src/features/draft/commands/types/api-update-rows.handler.types';
import {
  createTestingModule,
  testSchema,
} from 'src/features/draft/commands/handlers/__tests__/utils';

describe('ApiUpdateRowsHandler', () => {
  let kit: DraftTestKit;

  it('should update multiple rows', async () => {
    const draft = await givenDraftProjectWithRows({
      prismaService: kit.prismaService,
      schema: testSchema,
      rows: [{ data: { ver: 10 }, draftData: { ver: 20 } }],
    });
    const row2Id = draft.extraRowIds[0];

    if (!row2Id) {
      throw new Error('Expected an extra row to be created');
    }

    const command = new ApiUpdateRowsCommand({
      revisionId: draft.draftRevisionId,
      tableId: draft.tableId,
      rows: [
        { rowId: draft.rowId, data: { ver: 100 } },
        { rowId: row2Id, data: { ver: 200 } },
      ],
    });

    const result = await execute(command);

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]?.data).toEqual({ ver: 100 });
    expect(result.rows[1]?.data).toEqual({ ver: 200 });
    expect(result.table.versionId).toBe(draft.draftTableVersionId);
    expect(result.previousVersionTableId).toBe(draft.draftTableVersionId);
  });

  it('should update a single row via bulk operation', async () => {
    const draft = await givenDraftProject(kit.prismaService);

    const command = new ApiUpdateRowsCommand({
      revisionId: draft.draftRevisionId,
      tableId: draft.tableId,
      rows: [{ rowId: draft.rowId, data: { ver: 999 } }],
    });

    const result = await execute(command);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.id).toBe(draft.rowId);
    expect(result.rows[0]?.data).toEqual({ ver: 999 });
    expect(result.table.versionId).toBe(draft.draftTableVersionId);
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

    const command = new ApiUpdateRowsCommand({
      revisionId: draft.draftRevisionId,
      tableId: draft.tableId,
      rows: [
        { rowId: draft.rowId, data: { ver: 100 } },
        { rowId: row2Id, data: { ver: 200 } },
      ],
    });

    const result = await execute(command);

    expect(result.table.versionId).not.toBe(draft.draftTableVersionId);
    expect(result.previousVersionTableId).toBe(draft.draftTableVersionId);
  });

  it('should pass isRestore=true to plugin service', async () => {
    const draft = await givenDraftProject(kit.prismaService);

    const afterUpdateRowSpy = jest.spyOn(kit.pluginService, 'afterUpdateRow');

    const command = new ApiUpdateRowsCommand({
      revisionId: draft.draftRevisionId,
      tableId: draft.tableId,
      rows: [{ rowId: draft.rowId, data: { ver: 42 } }],
      isRestore: true,
    });

    await execute(command);

    expect(afterUpdateRowSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        isRestore: true,
      }),
    );
  });

  it('should pass isRestore=false (undefined) to plugin service by default', async () => {
    const draft = await givenDraftProject(kit.prismaService);

    const afterUpdateRowSpy = jest.spyOn(kit.pluginService, 'afterUpdateRow');

    const command = new ApiUpdateRowsCommand({
      revisionId: draft.draftRevisionId,
      tableId: draft.tableId,
      rows: [{ rowId: draft.rowId, data: { ver: 42 } }],
    });

    await execute(command);

    expect(afterUpdateRowSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        isRestore: undefined,
      }),
    );
  });

  function execute(
    command: ApiUpdateRowsCommand,
  ): Promise<ApiUpdateRowsHandlerReturnType> {
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
