import objectHash from 'object-hash';
import type { DraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import { givenDraftProject } from 'src/__tests__/fixtures/scenarios/given-draft-project';
import { InternalUpdateRowsCommand } from 'src/features/draft/commands/impl/transactional/internal-update-rows.command';
import {
  createTestingModule,
  testSchema,
} from 'src/features/draft/commands/handlers/__tests__/utils';

describe('InternalUpdateRowsHandler', () => {
  let kit: DraftTestKit;

  it('should update the row if conditions are met', async () => {
    const { draftRevisionId, tableId, rowId } = await givenDraftProject(
      kit.prismaService,
    );

    const command = new InternalUpdateRowsCommand({
      revisionId: draftRevisionId,
      tableId,
      tableSchema: testSchema,
      schemaHash: objectHash(testSchema),
      rows: [
        {
          rowId,
          data: { ver: 3 },
        },
      ],
    });

    await runTransaction(command);

    const row = await kit.rowApiService.getRow({
      revisionId: draftRevisionId,
      tableId,
      rowId,
    });
    expect(row).not.toBeNull();
    expect(row?.data).toStrictEqual({ ver: 3 });
  });

  function runTransaction(command: InternalUpdateRowsCommand): Promise<void> {
    return kit.transactionService.run(async () =>
      kit.commandBus.execute(command),
    );
  }

  beforeAll(async () => {
    kit = await createTestingModule();
  });

  afterAll(async () => {
    if (kit) {
      await kit.close();
    }
  });
});
