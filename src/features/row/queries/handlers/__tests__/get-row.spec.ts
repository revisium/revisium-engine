import { givenDraftProject } from 'src/__tests__/fixtures/scenarios/given-draft-project';
import type { DraftProjectScenario } from 'src/__tests__/fixtures/scenarios/given-draft-project';
import {
  createQueryTestKit,
  type QueryTestKit,
} from 'src/__tests__/kit/create-query-test-kit';
import { serializationFailure } from 'src/features/draft-revision/services/__tests__/support/revision-lookup-test-kit';
import {
  GetRowQuery,
  GetRowQueryReturnType,
} from 'src/features/row/queries/impl';

describe('getRow', () => {
  it('propagates a failure of its row lookup instead of answering null', async () => {
    const draft = await givenDraftProject(kit.prismaService);
    const failure = serializationFailure();
    failRowLookupOnceWith(failure);

    await expect(getRow(draft)).rejects.toBe(failure);
  });

  function failRowLookupOnceWith(failure: Error) {
    jest
      .spyOn(kit.prismaService.row, 'findFirst')
      .mockRejectedValueOnce(failure);
  }

  function getRow(draft: DraftProjectScenario): Promise<GetRowQueryReturnType> {
    return kit.queryBus.execute(
      new GetRowQuery({
        revisionId: draft.draftRevisionId,
        tableId: draft.tableId,
        rowId: draft.rowId,
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
