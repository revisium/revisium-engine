import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import {
  givenRandomDraftTwins,
  RANDOM_DRAFT_SEED_TIMEOUT_MS,
  RANDOM_DRAFT_SEEDS,
} from './support/random-draft';
import { versionedContentsOf } from './support/revision-contents';
import { UnitKindCoverage } from './support/unit-kind-coverage';

describe('{ all: true } revert against native revertChanges over random Drafts (oracle)', () => {
  let kit: PartialChangesTestKit;
  const coverage = new UnitKindCoverage();

  beforeAll(async () => {
    kit = await createPartialChangesTestKit();
  });

  afterEach(async () => {
    await kit.guard.verifyAndForget();
  });

  afterAll(async () => {
    await kit.close();
  });

  it.each(RANDOM_DRAFT_SEEDS)(
    'leaves the Draft with exactly the table versions, rows, schemas, views and ledger of a native revert of its twin (seed %i)',
    async (seed) => {
      const { draft, twin } = await givenRandomDraftTwins(kit, seed);
      coverage.record(await draft.listEveryUnit());

      await expect(
        draft.revertChanges({ selection: { all: true } }),
      ).resolves.toMatchObject({ status: 'applied' });
      await twin.revertNatively();

      expect(await versionedContentsOf(kit, draft, 'draft')).toEqual(
        await versionedContentsOf(kit, twin, 'draft'),
      );
      expect(await draft.hasChanges()).toBe(await twin.hasChanges());
    },
    RANDOM_DRAFT_SEED_TIMEOUT_MS,
  );

  it('reverts every unit kind across its seeds', () => {
    expect(coverage.missingKinds()).toEqual([]);
  });
});
