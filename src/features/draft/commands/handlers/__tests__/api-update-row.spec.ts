import type { DraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import {
  givenDraftProject,
  givenReadonlyDraftTable,
} from 'src/__tests__/fixtures/scenarios/given-draft-project';
import { ApiUpdateRowCommand } from 'src/features/draft/commands/impl/api-update-row.command';
import { ApiUpdateRowHandlerReturnType } from 'src/features/draft/commands/types/api-update-row.handler.types';
import { createTestingModule } from 'src/features/draft/commands/handlers/__tests__/utils';

describe('ApiUpdateRowHandler', () => {
  let kit: DraftTestKit;

  it('should update the row', async () => {
    const draft = await givenDraftProject(kit.prismaService);

    const command = new ApiUpdateRowCommand({
      revisionId: draft.draftRevisionId,
      tableId: draft.tableId,
      rowId: draft.rowId,
      data: { ver: 2 },
    });

    const result = await execute(command);

    const row = await kit.prismaService.row.findFirstOrThrow({
      where: {
        id: draft.rowId,
        tables: {
          some: {
            versionId: draft.draftTableVersionId,
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

    const command = new ApiUpdateRowCommand({
      revisionId: draft.draftRevisionId,
      tableId: draft.tableId,
      rowId: draft.rowId,
      data: { ver: 2 },
    });

    const result = await execute(command);

    expect(result.table?.versionId).not.toBe(draft.draftTableVersionId);
    expect(result.previousVersionTableId).toBe(draft.draftTableVersionId);
  });

  function execute(
    command: ApiUpdateRowCommand,
  ): Promise<ApiUpdateRowHandlerReturnType> {
    return kit.commandBus.execute(command);
  }

  beforeAll(async () => {
    kit = await createTestingModule();
  });

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await kit.close();
  });
});
