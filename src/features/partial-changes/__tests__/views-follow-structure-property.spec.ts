import { deepEqual } from '@revisium/schema-toolkit/lib';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import type { JsonValue } from 'src/engine-prisma-types';
import type { ChangeOperation } from 'src/features/partial-changes/plan/change-operation';
import type { ListedUnit } from 'src/features/partial-changes/queries/impl/list-draft-changes.query';
import type { Selection } from 'src/features/partial-changes/selection/selection';
import {
  seededRandom,
  type SeededRandom,
} from 'src/features/share/ledger-replay/__tests__/support/seeded-random';
import { SystemTables } from 'src/features/share/system-tables.consts';
import type { AddressedUnit } from './support/catalogue-reading';
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
const PLANNED_SELECTIONS_PER_DRAFT = 3;
const BASE_SIDES: Readonly<Record<ChangeOperation, RevisionSide>> = {
  commit: 'head',
  revert: 'draft',
};
const OTHER_SIDES: Readonly<Record<RevisionSide, RevisionSide>> = {
  head: 'draft',
  draft: 'head',
};

type ViewsDocuments = Readonly<Record<string, JsonValue>>;
type SidedDocuments = Readonly<Record<RevisionSide, ViewsDocuments>>;

describe('views follow the structure over random Drafts (AS-83)', () => {
  let kit: PartialChangesTestKit;
  const moved = new Set<string>();

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
    'takes every views document from the side its table unit takes and writes it unchanged (seed %i)',
    async (seed) => {
      const { draft, twin } = await givenRandomDraftTwins(kit, seed);
      const units = await draft.listEveryUnit();
      const random = seededRandom(seed);

      for (let made = 0; made < PLANNED_SELECTIONS_PER_DRAFT; made += 1) {
        const selection = randomSelectionOf(units, random);

        for (const operation of OPERATIONS) {
          expectViewsFromTheSidesOfTheirUnits(
            operation,
            await readPlan(kit, draft.branch, operation, selection),
          );
        }
      }

      const selection = viewsSelectionOf(units, random);
      await expectWrittenAsTheirUnitsSay(draft, 'commit', selection);
      await expectWrittenAsTheirUnitsSay(twin, 'revert', selection);
    },
    RANDOM_DRAFT_SEED_TIMEOUT_MS,
  );

  it('moves views documents with structure and views units in commits and reverts across its seeds', () => {
    expect([...moved].sort()).toEqual([
      'commit structure',
      'commit views',
      'revert structure',
      'revert views',
    ]);
  });

  async function expectWrittenAsTheirUnitsSay(
    draft: ChangesScenario,
    operation: ChangeOperation,
    selection: Selection,
  ): Promise<void> {
    const plan = await readPlan(kit, draft.branch, operation, selection);
    const before: SidedDocuments = {
      head: await viewsDocumentsOf(draft, 'head'),
      draft: await viewsDocumentsOf(draft, 'draft'),
    };
    expectViewsFromTheSidesOfTheirUnits(operation, plan);

    await expect(
      applyOf(draft, operation, {
        selection,
        includeRequired: true,
        expected: plan.fingerprint,
      }),
    ).resolves.toMatchObject({ status: 'applied' });

    const expected = expectedDocumentsOf(operation, before, plan.applied);
    expect({
      operation,
      selection,
      views: await viewsDocumentsOf(draft, BASE_SIDES[operation]),
    }).toEqual({ operation, selection, views: expected });
    recordMoves(operation, before, plan.applied);
  }

  function recordMoves(
    operation: ChangeOperation,
    before: SidedDocuments,
    applied: readonly AddressedUnit[],
  ): void {
    const base = BASE_SIDES[operation];
    const other = OTHER_SIDES[base];

    for (const unit of ownersIn(applied)) {
      const taken = documentOf(before[other], idOn(other, unit));
      const replaced = documentOf(before[base], idOn(base, unit));

      if (!deepEqual(taken, replaced)) {
        moved.add(`${operation} ${unit.kind}`);
      }
    }
  }
});

// The views document of a table comes from the side its structure unit, else its views unit, takes; a table
// without either keeps the base side's document (§3.6, §6.7).
function expectViewsFromTheSidesOfTheirUnits(
  operation: ChangeOperation,
  { applied, target }: PlanView,
): void {
  const base = BASE_SIDES[operation];
  const other = OTHER_SIDES[base];

  for (const { tableId, viewsSide } of target?.views ?? []) {
    const ownedByApplied = ownersIn(applied).some(
      (unit) => idOn(other, unit) === tableId,
    );

    expect({ operation, tableId, viewsSide }).toEqual({
      operation,
      tableId,
      viewsSide: ownedByApplied ? other : base,
    });
  }
}

function expectedDocumentsOf(
  operation: ChangeOperation,
  before: SidedDocuments,
  applied: readonly AddressedUnit[],
): ViewsDocuments {
  const base = BASE_SIDES[operation];
  const other = OTHER_SIDES[base];
  const expected: Record<string, JsonValue> = { ...before[base] };
  const owners = ownersIn(applied);

  for (const unit of owners) {
    const id = idOn(base, unit);

    if (id !== undefined) {
      delete expected[id];
    }
  }

  for (const unit of owners) {
    const id = idOn(other, unit);
    const taken = documentOf(before[other], id);

    if (id !== undefined && taken !== undefined) {
      expected[id] = taken;
    }
  }

  return expected;
}

function ownersIn(applied: readonly AddressedUnit[]): AddressedUnit[] {
  return applied.filter(({ kind }) => kind === 'structure' || kind === 'views');
}

// A unit addresses its table by the Draft id, else the Head id; a renamed table keeps its Head id as
// previousTableId, and a Head table whose id a rename took over is addressed with side: 'head'.
function idOn(side: RevisionSide, unit: AddressedUnit): string | undefined {
  if (side === 'head') {
    return unit.kind === 'structure' && unit.previousTableId !== undefined
      ? unit.previousTableId
      : unit.tableId;
  }

  return unit.side === 'head' ? undefined : unit.tableId;
}

function documentOf(
  documents: ViewsDocuments,
  id: string | undefined,
): JsonValue | undefined {
  return id === undefined ? undefined : documents[id];
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

// A structure unit that carries a views change and a views unit, when the Draft lists them, plus random units.
function viewsSelectionOf(
  units: readonly ListedUnit[],
  random: SeededRandom,
): Selection {
  const carryingViews = [
    units.filter((unit) => unit.structureChange?.views === true),
    units.filter((unit) => unit.kind === 'views'),
  ]
    .filter((candidates) => candidates.length > 0)
    .map((candidates) => random.pick(candidates));
  const others = Array.from({ length: random.count(0, 2) }, () =>
    random.pick(units),
  );

  return unionOfSelections(
    [...carryingViews, ...others].map(({ selector }) => selector),
  );
}
