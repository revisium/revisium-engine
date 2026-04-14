import type { DraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import {
  givenDraftProject,
  givenReadonlyDraftTable,
} from 'src/__tests__/fixtures/scenarios/given-draft-project';
import {
  ApiPatchRowCommand,
  ApiPatchRowCommandReturnType,
} from 'src/features/draft/commands/impl/api-patch-row.command';
import { createTestingModule } from 'src/features/draft/commands/handlers/__tests__/utils';

describe('ApiPatchRowHandler', () => {
  let kit: DraftTestKit;

  it('should patch the row', async () => {
    const draft = await givenDraftProject(kit.prismaService);

    const command = new ApiPatchRowCommand({
      revisionId: draft.draftRevisionId,
      tableId: draft.tableId,
      rowId: draft.rowId,
      patches: [
        {
          op: 'replace',
          path: 'ver',
          value: 100,
        },
      ],
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
      data: { ver: 100 },
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

    const command = new ApiPatchRowCommand({
      revisionId: draft.draftRevisionId,
      tableId: draft.tableId,
      rowId: draft.rowId,
      patches: [
        {
          op: 'replace',
          path: 'ver',
          value: 100,
        },
      ],
    });

    const result = await execute(command);

    expect(result.table?.versionId).not.toBe(draft.draftTableVersionId);
    expect(result.previousVersionTableId).toBe(draft.draftTableVersionId);
  });

  function execute(
    command: ApiPatchRowCommand,
  ): Promise<ApiPatchRowCommandReturnType> {
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
