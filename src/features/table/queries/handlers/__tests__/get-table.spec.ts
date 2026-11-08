import { givenDraftProject } from 'src/__tests__/fixtures/scenarios/given-draft-project';
import type { DraftProjectScenario } from 'src/__tests__/fixtures/scenarios/given-draft-project';
import {
  createQueryTestKit,
  type QueryTestKit,
} from 'src/__tests__/kit/create-query-test-kit';
import { serializationFailure } from 'src/features/draft-revision/services/__tests__/support/revision-lookup-test-kit';
import { failTableLookupOnceWith } from 'src/features/share/__tests__/support/lookup-failures';
import { GetTableQuery } from 'src/features/table/queries/impl';
import { GetTableReturnType } from 'src/features/table/queries/types';

describe('getTable', () => {
  it('retries a serialization failure of its table lookup and returns the table', async () => {
    const draft = await givenDraftProject(kit.prismaService);
    const lookup = failTableLookupOnceWith(
      kit,
      draft.tableId,
      serializationFailure(),
    );

    await expect(getTable(draft)).resolves.toMatchObject({
      id: draft.tableId,
      versionId: draft.draftTableVersionId,
    });
    expect(lookup.lookups()).toBe(2);
  });

  it('propagates an unrelated failure of its table lookup instead of answering null', async () => {
    const draft = await givenDraftProject(kit.prismaService);
    const failure = new Error('Table lookup unavailable');
    failTableLookupOnceWith(kit, draft.tableId, failure);

    await expect(getTable(draft)).rejects.toBe(failure);
  });

  function getTable(draft: DraftProjectScenario): Promise<GetTableReturnType> {
    return kit.queryBus.execute(
      new GetTableQuery({
        revisionId: draft.draftRevisionId,
        tableId: draft.tableId,
      }),
    );
  }

  let kit: QueryTestKit;

  beforeAll(async () => {
    kit = await createQueryTestKit();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await kit.close();
  });
});
