import type { DraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import {
  givenDraftProject,
  givenReadonlyDraftTable,
} from 'src/__tests__/fixtures/scenarios/given-draft-project';
import { ApiRemoveRowCommand } from 'src/features/draft/commands/impl/api-remove-row.command';
import { ApiRemoveRowHandlerReturnType } from 'src/features/draft/commands/types/api-remove-row.handler.types';
import { createTestingModule } from 'src/features/draft/commands/handlers/__tests__/utils';

describe('ApiRemoveRowHandler', () => {
  let kit: DraftTestKit;

  it('should remove the row', async () => {
    const draft = await givenDraftProject(kit.prismaService);

    const command = new ApiRemoveRowCommand({
      revisionId: draft.draftRevisionId,
      tableId: draft.tableId,
      rowId: draft.rowId,
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

  it('should notify endpoints if a new table was created', async () => {
    const draft = await givenDraftProject(kit.prismaService);
    await givenReadonlyDraftTable({
      prismaService: kit.prismaService,
      draftTableVersionId: draft.draftTableVersionId,
    });

    const command = new ApiRemoveRowCommand({
      revisionId: draft.draftRevisionId,
      tableId: draft.tableId,
      rowId: draft.rowId,
    });

    const result = await execute(command);

    expect(result.table?.versionId).not.toBe(draft.draftTableVersionId);
    expect(result.previousVersionTableId).toBe(draft.draftTableVersionId);
  });

  function execute(
    command: ApiRemoveRowCommand,
  ): Promise<ApiRemoveRowHandlerReturnType> {
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
