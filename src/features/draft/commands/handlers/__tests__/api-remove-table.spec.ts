import type { DraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import { givenDraftProject } from 'src/__tests__/fixtures/scenarios/given-draft-project';
import { ApiRemoveTableCommand } from 'src/features/draft/commands/impl/api-remove-table.command';
import { ApiRemoveTableHandlerReturnType } from 'src/features/draft/commands/types/api-remove-table.handler.types';
import { createTestingModule } from 'src/features/draft/commands/handlers/__tests__/utils';

describe('ApiRemoveTableHandler', () => {
  let kit: DraftTestKit;

  it('should remove the table', async () => {
    const draft = await givenDraftProject(kit.prismaService);

    const command = new ApiRemoveTableCommand({
      revisionId: draft.draftRevisionId,
      tableId: draft.tableId,
    });

    const result = await execute(command);

    expect(result.branch.id).toBe(draft.branchId);
  });

  function execute(
    command: ApiRemoveTableCommand,
  ): Promise<ApiRemoveTableHandlerReturnType> {
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
