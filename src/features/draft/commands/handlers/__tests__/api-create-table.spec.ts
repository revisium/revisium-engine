import type { DraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import { givenDraftProject } from 'src/__tests__/fixtures/scenarios/given-draft-project';
import { ApiCreateTableCommand } from 'src/features/draft/commands/impl/api-create-table.command';
import { ApiCreateTableHandlerReturnType } from 'src/features/draft/commands/types/api-create-table.handler.types';
import {
  createTestingModule,
  testSchema,
} from 'src/features/draft/commands/handlers/__tests__/utils';

describe('ApiCreateTableHandler', () => {
  let kit: DraftTestKit;

  it('should create a new table', async () => {
    const draft = await givenDraftProject(kit.prismaService);

    const newTableId = 'newTableId';
    const command = new ApiCreateTableCommand({
      revisionId: draft.draftRevisionId,
      tableId: newTableId,
      schema: testSchema,
    });

    const result = await execute(command);

    const table = await kit.prismaService.table.findFirstOrThrow({
      where: {
        id: newTableId,
        revisions: {
          some: {
            id: draft.draftRevisionId,
          },
        },
      },
    });
    expect(result.branch.id).toBe(draft.branchId);
    expect(result.table.versionId).toBe(table.versionId);
  });

  function execute(
    command: ApiCreateTableCommand,
  ): Promise<ApiCreateTableHandlerReturnType> {
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
