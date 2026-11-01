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

// The closure (SPEC §6.6) follows dependencies between the tables of the target, not between ledger steps: when a
// pending migration needs a table id that only another unit's pending migration provides (a table renamed into a
// vacated id, a table created with a reference to a table created or renamed in the Draft), reverting that other unit
// alone is blocked as ledgerInconsistent (§6.9). These Drafts make no such steps until the SPEC closes that gap.
const WITHOUT_LEDGER_ONLY_DEPENDENCIES = { ledgerOnlyDependencies: false };

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

  it.each(RANDOM_DRAFT_SEEDS)(
    'leaves the Draft equal to Head in every compared column, without changes (seed %i)',
    async (seed) => {
      const draft = await givenRandomDraft(
        kit,
        seed,
        WITHOUT_LEDGER_ONLY_DEPENDENCIES,
      );
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
    const listedAtStart = await draft.listEveryUnit();

    for (let reverted = 0; reverted < listedAtStart.length; reverted += 1) {
      const units = await draft.listEveryUnit();

      if (units.length === 0) {
        return;
      }

      const unit = random.pick(units);

      expect({ unit, result: await revertAsReviewed(draft, unit) }).toEqual({
        unit,
        result: expect.objectContaining({ status: 'applied' }),
      });
    }

    expect(await draft.listEveryUnit()).toEqual([]);
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
