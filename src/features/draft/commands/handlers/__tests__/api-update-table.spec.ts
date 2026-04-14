import type { DraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import { givenDraftProject } from 'src/__tests__/fixtures/scenarios/given-draft-project';
import { ApiUpdateTableCommand } from 'src/features/draft/commands/impl/api-update-table.command';
import { ApiUpdateTableHandlerReturnType } from 'src/features/draft/commands/types/api-update-table.handler.types';
import { JsonSchemaTypeName } from '@revisium/schema-toolkit/types';
import { createTestingModule } from 'src/features/draft/commands/handlers/__tests__/utils';

describe('ApiUpdateTableHandler', () => {
  let kit: DraftTestKit;

  it('should update the table', async () => {
    const draft = await givenDraftProject(kit.prismaService);

    const command = new ApiUpdateTableCommand({
      revisionId: draft.draftRevisionId,
      tableId: draft.tableId,
      patches: [
        {
          op: 'replace',
          path: '/properties/ver',
          value: {
            type: JsonSchemaTypeName.String,
            default: '',
          },
        },
      ],
    });

    const result = await execute(command);

    const table = await kit.prismaService.table.findFirstOrThrow({
      where: {
        versionId: draft.draftTableVersionId,
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
    command: ApiUpdateTableCommand,
  ): Promise<ApiUpdateTableHandlerReturnType> {
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
