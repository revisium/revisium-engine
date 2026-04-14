import type { DraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import {
  givenDraftProject,
  givenReadonlyDraftTable,
} from 'src/__tests__/fixtures/scenarios/given-draft-project';
import { ApiCreateRowsCommand } from 'src/features/draft/commands/impl/api-create-rows.command';
import { ApiCreateRowsHandlerReturnType } from 'src/features/draft/commands/types/api-create-rows.handler.types';
import { createTestingModule } from 'src/features/draft/commands/handlers/__tests__/utils';

describe('ApiCreateRowsHandler', () => {
  let kit: DraftTestKit;

  it('should create multiple rows', async () => {
    const draft = await givenDraftProject(kit.prismaService);

    const command = new ApiCreateRowsCommand({
      revisionId: draft.draftRevisionId,
      tableId: draft.tableId,
      rows: [
        { rowId: 'newRow1', data: { ver: 1 } },
        { rowId: 'newRow2', data: { ver: 2 } },
        { rowId: 'newRow3', data: { ver: 3 } },
      ],
    });

    const result = await execute(command);

    const rows = await kit.prismaService.row.findMany({
      where: {
        id: { in: ['newRow1', 'newRow2', 'newRow3'] },
        tables: {
          some: {
            versionId: draft.draftTableVersionId,
          },
        },
      },
      orderBy: { id: 'asc' },
    });
    expect(rows).toHaveLength(3);
    expect(result.rows).toHaveLength(3);
    expect(result.rows.map((r) => r.id)).toEqual([
      'newRow1',
      'newRow2',
      'newRow3',
    ]);
    expect(result.table.versionId).toBe(draft.draftTableVersionId);
    expect(result.previousVersionTableId).toBe(draft.draftTableVersionId);
  });

  it('should create a single row via bulk operation', async () => {
    const draft = await givenDraftProject(kit.prismaService);

    const command = new ApiCreateRowsCommand({
      revisionId: draft.draftRevisionId,
      tableId: draft.tableId,
      rows: [{ rowId: 'singleRow', data: { ver: 42 } }],
    });

    const result = await execute(command);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.id).toBe('singleRow');
    expect(result.rows[0]?.data).toEqual({ ver: 42 });
    expect(result.table.versionId).toBe(draft.draftTableVersionId);
  });

  it('should notify endpoints if a new table was created', async () => {
    const draft = await givenDraftProject(kit.prismaService);
    await givenReadonlyDraftTable({
      prismaService: kit.prismaService,
      draftTableVersionId: draft.draftTableVersionId,
    });

    const command = new ApiCreateRowsCommand({
      revisionId: draft.draftRevisionId,
      tableId: draft.tableId,
      rows: [
        { rowId: 'newRow1', data: { ver: 1 } },
        { rowId: 'newRow2', data: { ver: 2 } },
      ],
    });

    const result = await execute(command);

    expect(result.table.versionId).not.toBe(draft.draftTableVersionId);
    expect(result.previousVersionTableId).toBe(draft.draftTableVersionId);
  });

  function execute(
    command: ApiCreateRowsCommand,
  ): Promise<ApiCreateRowsHandlerReturnType> {
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
