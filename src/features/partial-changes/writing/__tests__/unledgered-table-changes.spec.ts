import { obj, str } from '@revisium/schema-toolkit/mocks';
import objectHash from 'object-hash';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import type { JsonValue } from 'src/engine-prisma-types';
import {
  branchContentOf,
  branchContentsOf,
} from 'src/__tests__/fixtures/branch-content';
import { describedLedgerOf } from 'src/__tests__/fixtures/stored-ledger';
import type { ChangesBlocked } from 'src/features/partial-changes/commands/impl/apply-changes';
import type { CommitChangesResult } from 'src/features/partial-changes/commands/impl/commit-draft-changes.command';
import type { RevertChangesResult } from 'src/features/partial-changes/commands/impl/revert-draft-changes.command';
import type { Blocker } from 'src/features/partial-changes/planning/plan-refs';
import type {
  FieldRef,
  Selection,
} from 'src/features/partial-changes/selection/selection';
import { ChangesScenario } from '../../__tests__/support/changes-scenario';
import type { RevisionSide } from '../../__tests__/support/snapshot-reading';

const CATEGORIES = 'categories';
const PRODUCTS = 'products';

const categorySchema = obj({ title: str() });
const productSchema = obj({
  title: str(),
  category: str({ foreignKey: CATEGORIES }),
});

const titleOf = (tableId: string, rowId: string): FieldRef => ({
  tableId,
  rowId,
  path: '/title',
});

const titleOfC1: Selection = { fields: [titleOf(CATEGORIES, 'c1')] };

const unledgeredProducts: Blocker = {
  code: 'unledgeredTable',
  tableId: PRODUCTS,
  message: 'products is refused: it has no intact ledger lineage',
};

describe('commitChanges and revertChanges next to an unledgered table', () => {
  let kit: PartialChangesTestKit;

  beforeAll(async () => {
    kit = await createPartialChangesTestKit();
  });

  afterEach(async () => {
    await kit.guard.verifyAndForget();
  });

  afterAll(async () => {
    await kit.close();
  });

  it('commits a change of a table the unledgered table references: Head gets only that change, and the unledgered table keeps its Head version and its Draft changes (AS-49)', async () => {
    const draft = await givenUnledgeredProductsOfEditedCategories();
    const previousHeadRevisionId = await draft.revisionId('head');
    const formerDraftRevisionId = await draft.revisionId('draft');
    const headProducts = await draft.tableVersionId('head', PRODUCTS);
    const draftProducts = await draft.tableVersionId('draft', PRODUCTS);

    const result = await draft.commitChanges({ selection: titleOfC1 });

    expect(result).toEqual<CommitChangesResult>({
      status: 'applied',
      previousHeadRevisionId,
      headRevisionId: formerDraftRevisionId,
      draftRevisionId: await draft.revisionId('draft'),
      applied: { selected: 1, required: 0 },
      remaining: { units: 1, unreadTables: 0 },
      renumbered: [],
    });
    await expectRows(draft, 'head', CATEGORIES, {
      c1: { title: 'uno' },
      c2: { title: 'two' },
    });
    await expectRows(draft, 'draft', CATEGORIES, {
      c1: { title: 'uno' },
      c2: { title: 'dos' },
    });
    expect(await draft.tableVersionId('head', PRODUCTS)).toBe(headProducts);
    await expectRows(draft, 'head', PRODUCTS, {
      p1: { title: 'one', category: 'c1' },
    });
    expect(await draft.tableVersionId('draft', PRODUCTS)).toBe(draftProducts);
    await expectRows(draft, 'draft', PRODUCTS, {
      p1: { title: 'uno', category: 'c1' },
      p2: { title: 'two', category: 'c2' },
    });
    expect(await describedLedgerOf(draft, 'head')).toEqual(['init categories']);
  });

  it('reverts a change of a table the unledgered table references: only that change leaves the Draft, and the unledgered table keeps its Draft changes (AS-49)', async () => {
    const draft = await givenUnledgeredProductsOfEditedCategories();
    const headRevisionId = await draft.revisionId('head');
    const draftRevisionId = await draft.revisionId('draft');
    const headVersionIds = await draft.linkedTableVersionIds('head');
    const draftProducts = await draft.tableVersionId('draft', PRODUCTS);

    const result = await draft.revertChanges({ selection: titleOfC1 });

    expect(result).toEqual<RevertChangesResult>({
      status: 'applied',
      headRevisionId,
      draftRevisionId,
      applied: { selected: 1, required: 0 },
      remaining: { units: 1, unreadTables: 0 },
    });
    await expectRows(draft, 'draft', CATEGORIES, {
      c1: { title: 'one' },
      c2: { title: 'dos' },
    });
    expect(await draft.tableVersionId('draft', PRODUCTS)).toBe(draftProducts);
    await expectRows(draft, 'draft', PRODUCTS, {
      p1: { title: 'uno', category: 'c1' },
      p2: { title: 'two', category: 'c2' },
    });
    expect(await draft.revisionId('head')).toBe(headRevisionId);
    expect(await draft.linkedTableVersionIds('head')).toEqual(headVersionIds);
  });

  const operations: ApplyingOperation[] = [
    {
      operation: 'commit',
      apply: (draft, selection) => draft.commitChanges({ selection }),
    },
    {
      operation: 'revert',
      apply: (draft, selection) => draft.revertChanges({ selection }),
    },
  ];

  const refusedSelections: RefusedSelection[] = [
    {
      selected: 'a change of the unledgered table',
      selection: { fields: [titleOf(PRODUCTS, 'p1')] },
    },
    {
      selected:
        'a row of the unledgered table next to a change of another table',
      selection: { ...titleOfC1, rows: [{ tableId: PRODUCTS, rowId: 'p2' }] },
    },
    {
      selected: 'all: true with an exclusion of another table',
      selection: { all: true, exclude: titleOfC1 },
    },
  ];

  it.each(
    operations.flatMap((operation) =>
      refusedSelections.map((refused) => ({ ...operation, ...refused })),
    ),
  )(
    'blocks a $operation of $selected with unledgeredTable and writes nothing (AS-49)',
    async ({ apply, selection }) => {
      const draft = await givenUnledgeredProductsOfEditedCategories();
      const contents = await branchContentsOf(kit, draft);

      const result = await apply(draft, selection);

      expect(result).toEqual<ChangesBlocked>({
        status: 'blocked',
        blockers: [unledgeredProducts],
        required: [],
      });
      expect(await branchContentsOf(kit, draft)).toEqual(contents);
    },
  );

  it('commits exactly { all: true } with the changes of the unledgered table, as native createRevision does (AS-49)', async () => {
    const native = await givenUnledgeredProductsOfEditedCategories();
    const partial = await givenUnledgeredProductsOfEditedCategories();

    await native.commit();
    await expectApplied(partial.commitChanges({ selection: { all: true } }));

    expect(await branchContentOf(kit, partial)).toEqual(
      await branchContentOf(kit, native),
    );
    await expectRows(partial, 'head', PRODUCTS, {
      p1: { title: 'uno', category: 'c1' },
      p2: { title: 'two', category: 'c2' },
    });
    await expectRows(partial, 'head', CATEGORIES, {
      c1: { title: 'uno' },
      c2: { title: 'dos' },
    });
    expect(await describedLedgerOf(partial, 'head')).toEqual([
      'init categories',
    ]);
    expect(await partial.hasChanges()).toBe(false);
  });

  it('reverts exactly { all: true } with the changes of the unledgered table, as native revertChanges does (AS-49)', async () => {
    const native = await givenUnledgeredProductsOfEditedCategories();
    const partial = await givenUnledgeredProductsOfEditedCategories();

    await native.revertNatively();
    await expectApplied(partial.revertChanges({ selection: { all: true } }));

    expect(await branchContentOf(kit, partial)).toEqual(
      await branchContentOf(kit, native),
    );
    expect(await partial.linkedTableVersionIds('draft')).toEqual(
      await partial.linkedTableVersionIds('head'),
    );
    await expectRows(partial, 'draft', PRODUCTS, {
      p1: { title: 'one', category: 'c1' },
    });
    await expectRows(partial, 'draft', CATEGORIES, {
      c1: { title: 'one' },
      c2: { title: 'two' },
    });
  });

  async function expectApplied(
    applying: Promise<CommitChangesResult | RevertChangesResult>,
  ): Promise<void> {
    await expect(applying).resolves.toMatchObject({ status: 'applied' });
  }

  async function expectRows(
    draft: ChangesScenario,
    side: RevisionSide,
    tableId: string,
    rows: Readonly<Record<string, JsonValue>>,
  ): Promise<void> {
    expect(await draft.rowIds(side, tableId)).toEqual(Object.keys(rows));

    for (const [rowId, data] of Object.entries(rows)) {
      const row = await draft.row(side, tableId, rowId);

      expect(row.data).toEqual(data);
      expect(row.hash).toBe(objectHash(data));
    }
  }

  async function givenUnledgeredProductsOfEditedCategories(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [CATEGORIES]: {
        schema: categorySchema,
        rows: { c1: { title: 'one' }, c2: { title: 'two' } },
      },
    });
    await draft.createTable(PRODUCTS, productSchema);
    await draft.createRows(PRODUCTS, { p1: { title: 'one', category: 'c1' } });
    await draft.dropFromDraftLedger('init', PRODUCTS);
    await draft.commit();
    expect(await describedLedgerOf(draft, 'head')).toEqual(['init categories']);
    await draft.updateRow(PRODUCTS, 'p1', { title: 'uno', category: 'c1' });
    await draft.createRows(PRODUCTS, { p2: { title: 'two', category: 'c2' } });
    await draft.updateRow(CATEGORIES, 'c1', { title: 'uno' });
    await draft.updateRow(CATEGORIES, 'c2', { title: 'dos' });

    return draft;
  }
});

interface ApplyingOperation {
  readonly operation: string;
  readonly apply: (
    draft: ChangesScenario,
    selection: Selection,
  ) => Promise<CommitChangesResult | RevertChangesResult>;
}

interface RefusedSelection {
  readonly selected: string;
  readonly selection: Selection;
}
