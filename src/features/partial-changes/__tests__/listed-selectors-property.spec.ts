import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import type { ChangeOperation } from 'src/features/partial-changes/plan/change-operation';
import type { ListedUnit } from 'src/features/partial-changes/queries/impl/list-draft-changes.query';
import type { PreviewChangesResult } from 'src/features/partial-changes/queries/impl/preview-draft-changes.query';
import type { ChangesScenario } from './support/changes-scenario';
import { unionOfSelections } from './support/dependency-closing';
import {
  givenRandomDraft,
  RANDOM_DRAFT_SEED_TIMEOUT_MS,
  RANDOM_DRAFT_SEEDS,
} from './support/random-draft';
import { UnitKindCoverage } from './support/unit-kind-coverage';

const OPERATIONS: readonly ChangeOperation[] = ['commit', 'revert'];

describe('listed selectors over random Drafts (AS-61)', () => {
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
    'previews each listed selector as its unit alone, and their union as { all: true } (seed %i)',
    async (seed) => {
      const draft = await givenRandomDraft(kit, seed);
      const units = await draft.listEveryUnit();
      coverage.record(units);

      for (const operation of OPERATIONS) {
        for (const unit of units) {
          await expectSelectorToPreviewOnlyItsUnit(draft, operation, unit);
        }

        await expectUnionToPreviewAsWholeDraft(draft, operation, units);
      }
    },
    RANDOM_DRAFT_SEED_TIMEOUT_MS,
  );

  it('lists every unit kind across its seeds', () => {
    expect(coverage.missingKinds()).toEqual([]);
  });

  async function expectSelectorToPreviewOnlyItsUnit(
    draft: ChangesScenario,
    operation: ChangeOperation,
    unit: ListedUnit,
  ): Promise<void> {
    const preview = await draft.previewChanges({
      operation,
      selection: unit.selector,
    });

    expect({ unit, preview: selectionOutcomeOf(preview) }).toEqual({
      unit,
      preview: {
        selected: 1,
        unmatched: {},
        notSelectable: [],
      },
    });
    expect(preview.sample).toContainEqual(unitRefOf(unit));
  }

  async function expectUnionToPreviewAsWholeDraft(
    draft: ChangesScenario,
    operation: ChangeOperation,
    units: readonly ListedUnit[],
  ): Promise<void> {
    const union = await draft.previewChanges({
      operation,
      selection: unionOfSelections(units.map(({ selector }) => selector)),
    });
    const wholeDraft = await draft.previewChanges({
      operation,
      selection: { all: true },
    });

    expect(decisionOf(union)).toEqual(decisionOf(wholeDraft));
  }
});

function selectionOutcomeOf(preview: PreviewChangesResult) {
  return {
    selected: preview.counts.selected,
    unmatched: preview.unmatched,
    notSelectable: preview.blockers.filter(
      ({ code }) => code === 'notSelectable',
    ),
  };
}

function decisionOf({ status, counts, fingerprint }: PreviewChangesResult) {
  return { status, counts, fingerprint };
}

function unitRefOf({ structure: _structure, ...unit }: ListedUnit) {
  return unit;
}
