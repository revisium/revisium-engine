import { deepEqual } from '@revisium/schema-toolkit/lib';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import type { JsonValue } from 'src/engine-prisma-types';
import type { TableViews } from 'src/features/partial-changes/assembly/system-table-targets';
import type { ChangeOperation } from 'src/features/partial-changes/plan/change-operation';
import type { ListedUnit } from 'src/features/partial-changes/queries/impl/list-draft-changes.query';
import type { Selection } from 'src/features/partial-changes/selection/selection';
import type { TablePair } from 'src/features/partial-changes/snapshot/changes-snapshot';
import {
  seededRandom,
  type SeededRandom,
} from 'src/features/share/ledger-replay/__tests__/support/seeded-random';
import { SystemTables } from 'src/features/share/system-tables.consts';
import type { RevertOptions } from './support/change-reverting';
import type { ChangesScenario } from './support/changes-scenario';
import { unionOfSelections } from './support/dependency-closing';
import { type PlanView, readPlan } from './support/plan-reading';
import {
  givenRandomDraftTwins,
  RANDOM_DRAFT_SEED_TIMEOUT_MS,
  RANDOM_DRAFT_SEEDS,
} from './support/random-draft';
import type { RevisionSide } from './support/snapshot-reading';

const OPERATIONS: readonly ChangeOperation[] = ['commit', 'revert'];
const SELECTIONS_PER_DRAFT = 4;
const TARGET_SIDES: Readonly<Record<ChangeOperation, RevisionSide>> = {
  commit: 'head',
  revert: 'draft',
};

type ViewsDocuments = Readonly<Record<string, JsonValue>>;

describe('views follow the structure over random Drafts (AS-83)', () => {
  let kit: PartialChangesTestKit;
  let applied = 0;

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
    'takes every views document from the side of its structure and writes it unchanged (seed %i)',
    async (seed) => {
      const { draft, twin } = await givenRandomDraftTwins(kit, seed);
      const units = await draft.listEveryUnit();
      const random = seededRandom(seed);

      for (let made = 1; made < SELECTIONS_PER_DRAFT; made += 1) {
        const selection = randomSelectionOf(units, random);

        for (const operation of OPERATIONS) {
          expectViewsFromTheirStructureSide(
            await readPlan(kit, draft.branch, operation, selection),
          );
        }
      }

      const selection = randomSelectionOf(units, random);
      await expectWrittenAsPlanned(draft, 'commit', selection);
      await expectWrittenAsPlanned(twin, 'revert', selection);
    },
    RANDOM_DRAFT_SEED_TIMEOUT_MS,
  );

  it('applies some of the selections across its seeds', () => {
    expect(applied).toBeGreaterThan(0);
  });

  async function expectWrittenAsPlanned(
    draft: ChangesScenario,
    operation: ChangeOperation,
    selection: Selection,
  ): Promise<void> {
    const plan = await readPlan(kit, draft.branch, operation, selection);
    expectViewsFromTheirStructureSide(plan);
    const result = await applyOf(draft, operation, {
      selection,
      includeRequired: true,
      expected: plan.fingerprint,
    });

    if (result.status !== 'applied' || !plan.target) {
      return;
    }

    applied += 1;
    expect({
      operation,
      selection,
      views: await viewsDocumentsOf(draft, TARGET_SIDES[operation]),
    }).toEqual({
      operation,
      selection,
      views: plannedDocumentsOf(plan.target.views),
    });
  }
});

function expectViewsFromTheirStructureSide(plan: PlanView): void {
  for (const views of plan.target?.views ?? []) {
    if (views.viewsSide !== views.tableSide) {
      expect({
        tableId: views.tableId,
        sameStructureOnBothSides: hasSameStructureOnBothSides(views.pair),
      }).toEqual({ tableId: views.tableId, sameStructureOnBothSides: true });
    }
  }
}

function hasSameStructureOnBothSides({ head, draft }: TablePair): boolean {
  return (
    head !== undefined &&
    draft !== undefined &&
    head.id === draft.id &&
    deepEqual(head.schema, draft.schema)
  );
}

function plannedDocumentsOf(views: readonly TableViews[]): ViewsDocuments {
  return Object.fromEntries(
    views.map(({ tableId, source }) => [tableId, source.data]),
  );
}

async function viewsDocumentsOf(
  draft: ChangesScenario,
  side: RevisionSide,
): Promise<ViewsDocuments> {
  if (!(await draft.hasTable(side, SystemTables.Views))) {
    return {};
  }

  const rows = await draft.rows(side, SystemTables.Views);

  return Object.fromEntries(rows.map(({ id, data }) => [id, data]));
}

function applyOf(
  draft: ChangesScenario,
  operation: ChangeOperation,
  options: RevertOptions,
): Promise<{ status: string }> {
  if (operation === 'commit') {
    return draft.commitChanges(options);
  }

  return draft.revertChanges(options);
}

function randomSelectionOf(
  units: readonly ListedUnit[],
  random: SeededRandom,
): Selection {
  const included = Array.from({ length: random.count(1, 3) }, () =>
    random.pick(units),
  );
  const selection = unionOfSelections(included.map(({ selector }) => selector));

  if (random.pick([true, false, false])) {
    return { ...selection, exclude: random.pick(units).selector };
  }

  return selection;
}
