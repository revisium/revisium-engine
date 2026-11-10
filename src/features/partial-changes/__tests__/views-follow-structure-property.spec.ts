import { deepEqual } from '@revisium/schema-toolkit/lib';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import type { JsonValue } from 'src/engine-prisma-types';
import type { ChangeOperation } from 'src/features/partial-changes/plan/change-operation';
import {
  type ListedUnit,
  STRUCTURE_TABLE_CHANGES,
  type StructureTableChange,
} from 'src/features/partial-changes/queries/impl/list-draft-changes.query';
import type { Selection } from 'src/features/partial-changes/selection/selection';
import {
  seededRandom,
  type SeededRandom,
} from 'src/features/share/ledger-replay/__tests__/support/seeded-random';
import { SystemTables } from 'src/features/share/system-tables.consts';
import type { AddressedUnit } from './support/catalogue-reading';
import { addressedUnitOfListed } from './support/change-listing';
import type { RevertOptions } from './support/change-reverting';
import type { ChangesScenario } from './support/changes-scenario';
import { unionOfSelections } from './support/dependency-closing';
import { readPlan } from './support/plan-reading';
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

// How each listed table unit exists on the two sides, by its address.
class TableUnits {
  private readonly tableChanges = new Map<string, StructureTableChange>();

  constructor(units: readonly ListedUnit[]) {
    for (const unit of units) {
      if (unit.structureChange) {
        this.tableChanges.set(
          keyOf(addressedUnitOfListed(unit)),
          unit.structureChange.table,
        );
      }
    }
  }

  public tableChangeOf(unit: AddressedUnit): StructureTableChange {
    const change = this.tableChanges.get(keyOf(unit));

    if (change === undefined) {
      throw new Error(`The listing has no structure unit ${keyOf(unit)}`);
    }

    return change;
  }

  public ownersIn(applied: readonly AddressedUnit[]): AddressedUnit[] {
    return applied.filter(
      ({ kind }) => kind === 'structure' || kind === 'views',
    );
  }

  // The table id a unit's table has on a side, or undefined where the table does not exist.
  public idOn(side: RevisionSide, unit: AddressedUnit): string | undefined {
    if (unit.kind === 'views') {
      return unit.tableId;
    }

    switch (this.tableChangeOf(unit)) {
      case 'created':
        return side === 'draft' ? unit.tableId : undefined;
      case 'removed':
        return side === 'head' ? unit.tableId : undefined;
      case 'replaced':
        return unit.tableId;
      case 'changed':
        return side === 'head'
          ? (unit.previousTableId ?? unit.tableId)
          : unit.tableId;
      case 'transient':
        return undefined;
    }
  }

  public expectedDocumentsOf(
    operation: ChangeOperation,
    before: SidedDocuments,
    applied: readonly AddressedUnit[],
  ): ViewsDocuments {
    const base = BASE_SIDES[operation];
    const other = OTHER_SIDES[base];
    const expected: Record<string, JsonValue> = { ...before[base] };
    const owners = this.ownersIn(applied);

    for (const unit of owners) {
      const id = this.idOn(base, unit);

      if (id !== undefined) {
        delete expected[id];
      }
    }

    for (const unit of owners) {
      const id = this.idOn(other, unit);
      const taken = documentOf(before[other], id);

      if (id !== undefined && taken !== undefined) {
        expected[id] = taken;
      }
    }

    return expected;
  }
}

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
    'plans and writes every views document of the side its table unit takes, unchanged (seed %i)',
    async (seed) => {
      const { draft, twin } = await givenRandomDraftTwins(kit, seed);
      const listed = await draft.listEveryUnit();
      const units = new TableUnits(listed);
      const before = await sidedDocumentsOf(draft);
      const random = seededRandom(seed);
      expectNoTableWithBothStructureAndViewsUnits(listed);

      for (let made = 0; made < PLANNED_SELECTIONS_PER_DRAFT; made += 1) {
        const selection = randomSelectionOf(listed, random);

        for (const operation of OPERATIONS) {
          await expectPlannedAsTheirUnitsSay(
            draft,
            units,
            before,
            operation,
            selection,
          );
        }
      }

      const selection = viewsSelectionOf(listed, random);
      await expectWrittenAsTheirUnitsSay(draft, units, 'commit', selection);
      await expectWrittenAsTheirUnitsSay(twin, units, 'revert', selection);
    },
    RANDOM_DRAFT_SEED_TIMEOUT_MS,
  );

  it('moves views documents with changed structures, other structures and views units in commits and reverts across its seeds', () => {
    for (const operation of OPERATIONS) {
      expect({
        operation,
        changed: moved.has(`${operation} structure changed`),
        other: STRUCTURE_TABLE_CHANGES.some(
          (change) =>
            change !== 'changed' &&
            moved.has(`${operation} structure ${change}`),
        ),
        views: moved.has(`${operation} views`),
      }).toEqual({ operation, changed: true, other: true, views: true });
    }
  });

  async function expectPlannedAsTheirUnitsSay(
    draft: ChangesScenario,
    units: TableUnits,
    before: SidedDocuments,
    operation: ChangeOperation,
    selection: Selection,
  ): Promise<void> {
    const plan = await readPlan(kit, draft.branch, operation, selection);

    if (!plan.target) {
      return;
    }

    expect({
      operation,
      selection,
      views: Object.fromEntries(
        plan.target.views.map(({ tableId, source }) => [tableId, source.data]),
      ),
    }).toEqual({
      operation,
      selection,
      views: units.expectedDocumentsOf(operation, before, plan.applied),
    });
  }

  async function expectWrittenAsTheirUnitsSay(
    draft: ChangesScenario,
    units: TableUnits,
    operation: ChangeOperation,
    selection: Selection,
  ): Promise<void> {
    const plan = await readPlan(kit, draft.branch, operation, selection);
    const before = await sidedDocumentsOf(draft);
    const base = BASE_SIDES[operation];

    await expect(
      applyOf(draft, operation, {
        selection,
        includeRequired: true,
        expected: plan.fingerprint,
      }),
    ).resolves.toMatchObject({ status: 'applied' });

    expect({
      operation,
      selection,
      views: await sidedDocumentsOf(draft),
    }).toEqual({
      operation,
      selection,
      views: {
        [base]: units.expectedDocumentsOf(operation, before, plan.applied),
        [OTHER_SIDES[base]]: before[OTHER_SIDES[base]],
      },
    });
    recordMoves(units, operation, before, plan.applied);
  }

  function recordMoves(
    units: TableUnits,
    operation: ChangeOperation,
    before: SidedDocuments,
    applied: readonly AddressedUnit[],
  ): void {
    const base = BASE_SIDES[operation];
    const other = OTHER_SIDES[base];

    for (const unit of units.ownersIn(applied)) {
      const taken = documentOf(before[other], units.idOn(other, unit));
      const replaced = documentOf(before[base], units.idOn(base, unit));

      if (!deepEqual(taken, replaced)) {
        moved.add(
          unit.kind === 'structure'
            ? `${operation} structure ${units.tableChangeOf(unit)}`
            : `${operation} ${unit.kind}`,
        );
      }
    }
  }
});

function expectNoTableWithBothStructureAndViewsUnits(
  units: readonly ListedUnit[],
): void {
  const addressed = units.map(addressedUnitOfListed);
  const structureTableIds = new Set(
    addressed.flatMap((unit) => {
      if (unit.kind !== 'structure') {
        return [];
      }

      return unit.previousTableId === undefined
        ? [unit.tableId]
        : [unit.tableId, unit.previousTableId];
    }),
  );
  const viewsTableIds = addressed.flatMap((unit) =>
    unit.kind === 'views' ? [unit.tableId] : [],
  );

  expect(
    viewsTableIds.filter((tableId) => structureTableIds.has(tableId)),
  ).toEqual([]);
}

function keyOf(unit: AddressedUnit): string {
  if (unit.kind !== 'structure') {
    return JSON.stringify([unit.kind, unit]);
  }

  return JSON.stringify([
    unit.tableId,
    unit.previousTableId ?? null,
    unit.side ?? null,
  ]);
}

function documentOf(
  documents: ViewsDocuments,
  id: string | undefined,
): JsonValue | undefined {
  return id === undefined ? undefined : documents[id];
}

async function sidedDocumentsOf(
  draft: ChangesScenario,
): Promise<SidedDocuments> {
  return {
    head: await viewsDocumentsOf(draft, 'head'),
    draft: await viewsDocumentsOf(draft, 'draft'),
  };
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

// A changed structure that carries a views change, another structure that does, and a views unit, when the Draft lists
// them, plus random units.
function viewsSelectionOf(
  units: readonly ListedUnit[],
  random: SeededRandom,
): Selection {
  const carryingViews = units.filter(
    (unit) => unit.structureChange?.views === true,
  );
  const owners = [
    carryingViews.filter((unit) => unit.structureChange?.table === 'changed'),
    carryingViews.filter((unit) => unit.structureChange?.table !== 'changed'),
    units.filter((unit) => unit.kind === 'views'),
  ]
    .filter((candidates) => candidates.length > 0)
    .map((candidates) => random.pick(candidates));
  const others = Array.from({ length: random.count(0, 2) }, () =>
    random.pick(units),
  );

  return unionOfSelections(
    [...owners, ...others].map(({ selector }) => selector),
  );
}
