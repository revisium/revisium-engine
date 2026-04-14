import type { DraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import {
  givenDraftProject,
  givenDraftProjectWithRows,
  givenReadonlyDraftTable,
} from 'src/__tests__/fixtures/scenarios/given-draft-project';
import { ApiPatchRowsCommand } from 'src/features/draft/commands/impl/api-patch-rows.command';
import { ApiPatchRowsHandlerReturnType } from 'src/features/draft/commands/types/api-patch-rows.handler.types';
import {
  createTestingModule,
  testSchema,
} from 'src/features/draft/commands/handlers/__tests__/utils';

describe('ApiPatchRowsHandler', () => {
  let kit: DraftTestKit;

  it('should patch multiple rows', async () => {
    const draft = await givenDraftProjectWithRows({
      prismaService: kit.prismaService,
      schema: testSchema,
      rows: [{ data: { ver: 10 }, draftData: { ver: 20 } }],
    });
    const row2Id = draft.extraRowIds[0];

    if (!row2Id) {
      throw new Error('Expected an extra row to be created');
    }

    const command = new ApiPatchRowsCommand({
      revisionId: draft.draftRevisionId,
      tableId: draft.tableId,
      rows: [
        {
          rowId: draft.rowId,
          patches: [{ op: 'replace', path: 'ver', value: 100 }],
        },
        {
          rowId: row2Id,
          patches: [{ op: 'replace', path: 'ver', value: 200 }],
        },
      ],
    });

    const result = await execute(command);

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]?.data).toEqual({ ver: 100 });
    expect(result.rows[1]?.data).toEqual({ ver: 200 });
    expect(result.table.versionId).toBe(draft.draftTableVersionId);
    expect(result.previousVersionTableId).toBe(draft.draftTableVersionId);
  });

  it('should patch a single row via bulk operation', async () => {
    const draft = await givenDraftProject(kit.prismaService);

    const command = new ApiPatchRowsCommand({
      revisionId: draft.draftRevisionId,
      tableId: draft.tableId,
      rows: [
        {
          rowId: draft.rowId,
          patches: [{ op: 'replace', path: 'ver', value: 999 }],
        },
      ],
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

    const command = new ApiPatchRowsCommand({
      revisionId: draft.draftRevisionId,
      tableId: draft.tableId,
      rows: [
        {
          rowId: draft.rowId,
          patches: [{ op: 'replace', path: 'ver', value: 100 }],
        },
        {
          rowId: row2Id,
          patches: [{ op: 'replace', path: 'ver', value: 200 }],
        },
      ],
    });

    const result = await execute(command);

    expect(result.table.versionId).not.toBe(draft.draftTableVersionId);
    expect(result.previousVersionTableId).toBe(draft.draftTableVersionId);
  });

  function execute(
    command: ApiPatchRowsCommand,
  ): Promise<ApiPatchRowsHandlerReturnType> {
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
