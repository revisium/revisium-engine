import type { DraftProjectScenario } from 'src/__tests__/fixtures/scenarios/given-draft-project';
import {
  createDraftTestKit,
  type DraftTestKit,
} from 'src/__tests__/kit/create-draft-test-kit';
import { BranchApiService } from 'src/features/branch/branch-api.service';
import { serializationFailure } from 'src/features/draft-revision/services/__tests__/support/revision-lookup-test-kit';
import {
  commitBranchDraft,
  givenDraftWithRows,
  revertBranchDraft,
} from './support/held-branch-operation';

interface BranchOperation {
  name: string;
  run(kit: DraftTestKit, draft: DraftProjectScenario): Promise<unknown>;
}

const branchOperations: BranchOperation[] = [
  { name: 'createRevision', run: commitBranchDraft },
  { name: 'revertChanges', run: revertBranchDraft },
];

describe.each(branchOperations)('Native $name retries', ({ run }) => {
  it('retries a serialization failure of its Head lookup and applies', async () => {
    const draft = await givenDraftWithRows(kit, ['row-1']);
    const headLookups = failHeadLookupOnceWith(kit, serializationFailure());

    await expect(run(kit, draft)).resolves.toBeDefined();
    expect(headLookups).toHaveBeenCalledTimes(2);
  });

  it('fails with an unrelated failure of its Head lookup without retrying', async () => {
    const draft = await givenDraftWithRows(kit, ['row-1']);
    const failure = new Error('Head lookup unavailable');
    const headLookups = failHeadLookupOnceWith(kit, failure);

    await expect(run(kit, draft)).rejects.toBe(failure);
    expect(headLookups).toHaveBeenCalledTimes(1);
  });

  let kit: DraftTestKit;

  beforeAll(async () => {
    kit = await createDraftTestKit({
      migrationOptions: { workerMode: 'disabled' },
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await kit.close();
  });
});

function failHeadLookupOnceWith(kit: DraftTestKit, error: Error) {
  return jest
    .spyOn(kit.module.get(BranchApiService), 'getHeadRevision')
    .mockRejectedValueOnce(error);
}
