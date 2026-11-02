import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import type { ChangeOperation } from 'src/features/partial-changes/plan/change-operation';
import type { ListedUnit } from 'src/features/partial-changes/queries/impl/list-draft-changes.query';
import type { Selection } from 'src/features/partial-changes/selection/selection';
import {
  seededRandom,
  type SeededRandom,
} from 'src/features/share/ledger-replay/__tests__/support/seeded-random';
import type { ChangesScenario } from './support/changes-scenario';
import { unionOfSelections } from './support/dependency-closing';
import {
  type PlannedTableView,
  type PlanView,
  readPlan,
} from './support/plan-reading';
import {
  givenRandomDraft,
  RANDOM_DRAFT_SEED_TIMEOUT_MS,
  RANDOM_DRAFT_SEEDS,
} from './support/random-draft';
import { READING_EVERY_TABLE } from './support/scoped-reading';
import { UnitKindCoverage } from './support/unit-kind-coverage';

const OPERATIONS: readonly ChangeOperation[] = ['commit', 'revert'];
const SELECTIONS_PER_DRAFT = 4;

describe('scoped reading over random Drafts and selections (AS-74)', () => {
  let kit: PartialChangesTestKit;
  let wideKit: PartialChangesTestKit;
  const coverage = new UnitKindCoverage();

  beforeAll(async () => {
    kit = await createPartialChangesTestKit();
    wideKit = await createPartialChangesTestKit({
      overrides: [READING_EVERY_TABLE],
    });
  });

  afterEach(async () => {
    await kit.guard.verifyAndForget();
  });

  afterAll(async () => {
    await kit.close();
    await wideKit.close();
  });

  it.each(RANDOM_DRAFT_SEEDS)(
    'plans every selection as the plan that reads every table (seed %i)',
    async (seed) => {
      const draft = await givenRandomDraft(kit, seed);
      const units = await draft.listEveryUnit();
      const random = seededRandom(seed);

      for (let made = 0; made < SELECTIONS_PER_DRAFT; made += 1) {
        const selection = randomSelectionOf(units, random);

        for (const operation of OPERATIONS) {
          await expectScopedPlanToEqualWidePlan(draft, operation, selection);
        }
      }
    },
    RANDOM_DRAFT_SEED_TIMEOUT_MS,
  );

  it('applies every unit kind across its seeds', () => {
    expect(coverage.missingKinds()).toEqual([]);
  });

  async function expectScopedPlanToEqualWidePlan(
    draft: ChangesScenario,
    operation: ChangeOperation,
    selection: Selection,
  ): Promise<void> {
    const scoped = await readPlan(kit, draft.branch, operation, selection);
    const wide = await readPlan(wideKit, draft.branch, operation, selection);
    coverage.record(scoped.applied);

    expect({ operation, selection, plan: withinScopeOf(wide, scoped) }).toEqual(
      { operation, selection, plan: scoped },
    );
    expect(tablesOutsideScopeOf(wide, scoped).map(linkChangesOf)).toEqual(
      tablesOutsideScopeOf(wide, scoped).map(keepingItsBaseVersion),
    );
  }
});

function randomSelectionOf(
  units: readonly ListedUnit[],
  random: SeededRandom,
): Selection {
  const included = Array.from({ length: random.count(1, 3) }, () =>
    random.pick(units),
  );
  const selection = unionOfSelections([
    ...included.map(({ selector }) => selector),
    ...tableDataOf(included, random),
  ]);

  if (random.pick([true, false])) {
    return { ...selection, exclude: random.pick(units).selector };
  }

  return selection;
}

function tableDataOf(
  included: readonly ListedUnit[],
  random: SeededRandom,
): Selection[] {
  if (random.pick([true, false, false])) {
    return [{ tableData: [random.pick(included).tableId] }];
  }

  return [];
}

function withinScopeOf(wide: PlanView, scoped: PlanView): PlanView {
  if (!wide.target || !scoped.target) {
    return wide;
  }

  const read = identitiesOf(scoped);

  return {
    ...wide,
    target: {
      ...wide.target,
      tables: wide.target.tables.filter(({ identity }) => read.has(identity)),
    },
  };
}

function tablesOutsideScopeOf(
  wide: PlanView,
  scoped: PlanView,
): PlannedTableView[] {
  const read = identitiesOf(scoped);

  return (wide.target?.tables ?? []).filter(
    ({ identity }) => !read.has(identity),
  );
}

function identitiesOf({ target }: PlanView): Set<string> {
  return new Set((target?.tables ?? []).map(({ identity }) => identity));
}

function linkChangesOf(table: PlannedTableView) {
  const { headId, draftId, outcome, relinkCandidate } = table;
  const { removedLinks, addedLinks, newRows } = table;

  return {
    headId,
    draftId,
    outcome,
    relinkCandidate,
    removedLinks,
    addedLinks,
    newRows,
  };
}

function keepingItsBaseVersion({ headId, draftId }: PlannedTableView) {
  return {
    headId,
    draftId,
    outcome: 'base',
    relinkCandidate: false,
    removedLinks: [],
    addedLinks: [],
    newRows: [],
  };
}
