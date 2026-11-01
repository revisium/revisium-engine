import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import type { RevertChangesResult } from 'src/features/partial-changes/commands/impl/revert-draft-changes.command';
import type { ListedUnit } from 'src/features/partial-changes/queries/impl/list-draft-changes.query';
import {
  seededRandom,
  type SeededRandom,
} from 'src/features/share/ledger-replay/__tests__/support/seeded-random';
import type { ChangesScenario } from './support/changes-scenario';
import { givenRandomDraft, RANDOM_DRAFT_SEEDS } from './support/random-draft';
import { comparedColumnsOf } from './support/revision-contents';
import { UnitKindCoverage } from './support/unit-kind-coverage';

// A Draft in which reverting a unit alone requires reverting another unit whose pending migration needs a table id at
// its ledger step (SPEC §6.6); the random revert order of this seed reaches that state.
const SEEDS_WITH_LEDGER_DEPENDENCIES = [5_767_684];

// A structure revert can change the form of the remaining units (row columns become field units), so the number of
// listed units does not shrink with every revert.
const REVERTS_PER_LISTED_UNIT = 3;
const EXTRA_REVERTS = 10;

describe('reverting listed units one by one over random Drafts (AS-65a)', () => {
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

  it.each([...RANDOM_DRAFT_SEEDS, ...SEEDS_WITH_LEDGER_DEPENDENCIES])(
    'leaves the Draft equal to Head in every compared column, without changes (seed %i)',
    async (seed) => {
      const draft = await givenRandomDraft(kit, seed);
      coverage.record(await draft.listEveryUnit());

      await revertListedUnitsOneByOne(draft, seededRandom(seed));

      expect(await comparedColumnsOf(kit, draft, 'draft')).toEqual(
        await comparedColumnsOf(kit, draft, 'head'),
      );
      expect(await draft.hasChanges()).toBe(false);
    },
  );

  it('reverts every unit kind across its seeds', () => {
    expect(coverage.missingKinds()).toEqual([]);
  });

  async function revertListedUnitsOneByOne(
    draft: ChangesScenario,
    random: SeededRandom,
  ): Promise<void> {
    let units = await draft.listEveryUnit();
    const maxReverts = REVERTS_PER_LISTED_UNIT * units.length + EXTRA_REVERTS;

    for (
      let reverted = 0;
      units.length > 0 && reverted < maxReverts;
      reverted += 1
    ) {
      const unit = random.pick(units);

      expect({ unit, result: await revertAsReviewed(draft, unit) }).toEqual({
        unit,
        result: expect.objectContaining({ status: 'applied' }),
      });

      units = await draft.listEveryUnit();
    }

    expect(units).toEqual([]);
  }

  async function revertAsReviewed(
    draft: ChangesScenario,
    { selector }: ListedUnit,
  ): Promise<RevertChangesResult> {
    const preview = await draft.previewChanges({
      operation: 'revert',
      selection: selector,
    });

    return draft.revertChanges({
      selection: selector,
      includeRequired: preview.status === 'required',
      expected: preview.fingerprint,
    });
  }
});
