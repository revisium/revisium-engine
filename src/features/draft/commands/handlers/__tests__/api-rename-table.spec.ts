import type { DraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import { givenDraftProject } from 'src/__tests__/fixtures/scenarios/given-draft-project';
import {
  ApiRenameTableCommand,
  ApiRenameTableCommandReturnType,
} from 'src/features/draft/commands/impl/api-rename-table.command';
import { createTestingModule } from 'src/features/draft/commands/handlers/__tests__/utils';

describe('ApiRenameTableHandler', () => {
  const nextTableId = 'nextTableId';
  let kit: DraftTestKit;

  it('should rename the table', async () => {
    const draft = await givenDraftProject(kit.prismaService);

    const command = new ApiRenameTableCommand({
      revisionId: draft.draftRevisionId,
      tableId: draft.tableId,
      nextTableId,
    });

    const result = await execute(command);

    const table = await kit.prismaService.table.findFirstOrThrow({
      where: {
        id: nextTableId,
        revisions: {
          some: {
            id: draft.draftRevisionId,
          },
        },
      },
    });

    expect(result.previousVersionTableId).toBe(draft.draftTableVersionId);
    expect(result.table).toStrictEqual({
      ...table,
      context: {
        revisionId: draft.draftRevisionId,
      },
    });
  });

  function execute(
    command: ApiRenameTableCommand,
  ): Promise<ApiRenameTableCommandReturnType> {
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
