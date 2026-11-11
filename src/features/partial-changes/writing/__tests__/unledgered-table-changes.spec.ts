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
import type { PlanBlocker } from 'src/features/partial-changes/planning/plan-refs';
import type {
  FieldRef,
  Selection,
} from 'src/features/partial-changes/selection/selection';
import { SystemTables } from 'src/features/share/system-tables.consts';
import { ChangesScenario } from '../../__tests__/support/changes-scenario';
import type { RevisionSide } from '../../__tests__/support/snapshot-reading';

const CATEGORIES = 'categories';
const KINDS = 'kinds';
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

const unledgered = (tableId: string): PlanBlocker => ({
  code: 'unledgeredTable',
  tableId,
  message: `${tableId} is refused: it has no intact ledger lineage`,
});

const unledgeredProducts = unledgered(PRODUCTS);

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
      draftHasChanges: true,
      renumberedMigrations: [],
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
      draftHasChanges: true,
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
        planned: true,
        blockers: [unledgeredProducts],
        blockersTotal: 1,
        required: [],
        requiredTotal: 0,
        unmatched: {},
      });
      expect(await branchContentsOf(kit, draft)).toEqual(contents);
    },
  );

  const requirementsOfUnledgered: RefusedRequirement[] = [
    {
      operation: 'commit',
      selected:
        'the deletion of a category that the Head of the unledgered table references',
      given: givenUnledgeredProductsRepointedAcrossCategories,
      apply: (draft) =>
        draft.commitChanges({
          selection: { rows: [{ tableId: CATEGORIES, rowId: 'c1' }] },
        }),
    },
    {
      operation: 'revert',
      selected:
        'the creation of a category that the Draft of the unledgered table references',
      given: givenUnledgeredProductsRepointedAcrossCategories,
      apply: (draft) =>
        draft.revertChanges({
          selection: { rows: [{ tableId: CATEGORIES, rowId: 'c3' }] },
        }),
    },
    {
      operation: 'commit',
      selected: 'the rename of the table that the unledgered table references',
      given: givenRenamedCategoriesUnderUnledgeredProducts,
      apply: (draft) =>
        draft.commitChanges({
          selection: { structures: [{ tableId: KINDS }] },
        }),
    },
    {
      operation: 'revert',
      selected: 'the rename of the table that the unledgered table references',
      given: givenRenamedCategoriesUnderUnledgeredProducts,
      apply: (draft) =>
        draft.revertChanges({
          selection: { structures: [{ tableId: KINDS }] },
        }),
    },
  ];

  it.each(requirementsOfUnledgered)(
    'blocks a $operation of $selected with unledgeredTable, since only the unledgered table could keep its references, and writes nothing (AS-49)',
    async ({ given, apply }) => {
      const draft = await given();
      const contents = await branchContentsOf(kit, draft);

      const result = await apply(draft);

      expect(result).toEqual<ChangesBlocked>({
        status: 'blocked',
        planned: true,
        blockers: [unledgeredProducts],
        blockersTotal: 1,
        required: [],
        requiredTotal: 0,
        unmatched: {},
      });
      expect(await branchContentsOf(kit, draft)).toEqual(contents);
    },
  );

  it('commits a change of another table next to a content-equal Draft version of the unledgered table and keeps that Draft version (AS-49)', async () => {
    const draft = await givenContentEqualUnledgeredProductsOfEditedCategory();
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
      draftHasChanges: true,
      renumberedMigrations: [],
    });
    await expectRows(draft, 'head', CATEGORIES, {
      c1: { title: 'uno' },
      c2: { title: 'two' },
    });
    expect(await draft.tableVersionId('head', PRODUCTS)).toBe(headProducts);
    expect(await draft.tableVersionId('draft', PRODUCTS)).toBe(draftProducts);
  });

  it('reverts a change of another table next to a content-equal Draft version of the unledgered table and keeps that Draft version (AS-49)', async () => {
    const draft = await givenContentEqualUnledgeredProductsOfEditedCategory();
    const headRevisionId = await draft.revisionId('head');
    const draftRevisionId = await draft.revisionId('draft');
    const headProducts = await draft.tableVersionId('head', PRODUCTS);
    const draftProducts = await draft.tableVersionId('draft', PRODUCTS);

    const result = await draft.revertChanges({ selection: titleOfC1 });

    expect(result).toEqual<RevertChangesResult>({
      status: 'applied',
      headRevisionId,
      draftRevisionId,
      applied: { selected: 1, required: 0 },
      draftHasChanges: true,
    });
    await expectRows(draft, 'draft', CATEGORIES, {
      c1: { title: 'one' },
      c2: { title: 'two' },
    });
    expect(await draft.tableVersionId('head', PRODUCTS)).toBe(headProducts);
    expect(await draft.tableVersionId('draft', PRODUCTS)).toBe(draftProducts);
  });

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

  describe('in a project without a migration table', () => {
    const refusedWithoutMigrationTable: (RefusedSelection & {
      readonly refused: readonly string[];
    })[] = [
      {
        selected: 'a change of one table',
        selection: titleOfC1,
        refused: [CATEGORIES],
      },
      {
        selected: 'all: true with an exclusion',
        selection: { all: true, exclude: titleOfC1 },
        refused: [CATEGORIES, PRODUCTS],
      },
    ];

    it.each(
      operations.flatMap((operation) =>
        refusedWithoutMigrationTable.map((refused) => ({
          ...operation,
          ...refused,
        })),
      ),
    )(
      'blocks a $operation of $selected with unledgeredTable for each table it involves and writes nothing (AS-49)',
      async ({ apply, selection, refused }) => {
        const draft = await givenEditedCatalogWithoutMigrationTable();
        const contents = await branchContentsOf(kit, draft);

        const result = await apply(draft, selection);

        expect(result).toEqual<ChangesBlocked>({
          status: 'blocked',
          planned: true,
          blockers: refused.map(unledgered),
          blockersTotal: refused.length,
          required: [],
          requiredTotal: 0,
          unmatched: {},
        });
        expect(await branchContentsOf(kit, draft)).toEqual(contents);
      },
    );

    it('commits exactly { all: true } as native createRevision does and adds no migration table (AS-49)', async () => {
      const native = await givenEditedCatalogWithoutMigrationTable();
      const partial = await givenEditedCatalogWithoutMigrationTable();

      await native.commit();
      await expectApplied(partial.commitChanges({ selection: { all: true } }));

      expect(await branchContentOf(kit, partial)).toEqual(
        await branchContentOf(kit, native),
      );
      await expectRows(partial, 'head', PRODUCTS, {
        p1: { title: 'uno', category: 'c1' },
        p2: { title: 'two', category: 'c2' },
      });
      expect(await partial.hasTable('head', SystemTables.Migration)).toBe(
        false,
      );
      expect(await partial.hasChanges()).toBe(false);
    });

    it('reverts exactly { all: true } as native revertChanges does and adds no migration table (AS-49)', async () => {
      const native = await givenEditedCatalogWithoutMigrationTable();
      const partial = await givenEditedCatalogWithoutMigrationTable();

      await native.revertNatively();
      await expectApplied(partial.revertChanges({ selection: { all: true } }));

      expect(await branchContentOf(kit, partial)).toEqual(
        await branchContentOf(kit, native),
      );
      await expectRows(partial, 'draft', PRODUCTS, {
        p1: { title: 'one', category: 'c1' },
      });
      expect(await partial.hasTable('draft', SystemTables.Migration)).toBe(
        false,
      );
      expect(await partial.hasChanges()).toBe(false);
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
    const draft = await givenCommittedUnledgeredProducts();
    await draft.updateRow(PRODUCTS, 'p1', { title: 'uno', category: 'c1' });
    await draft.createRows(PRODUCTS, { p2: { title: 'two', category: 'c2' } });
    await draft.updateRow(CATEGORIES, 'c1', { title: 'uno' });
    await draft.updateRow(CATEGORIES, 'c2', { title: 'dos' });

    return draft;
  }

  async function givenUnledgeredProductsRepointedAcrossCategories(): Promise<ChangesScenario> {
    const draft = await givenCommittedUnledgeredProducts();
    await draft.updateRow(PRODUCTS, 'p1', { title: 'one', category: 'c2' });
    await draft.removeRow(CATEGORIES, 'c1');
    await draft.createRows(CATEGORIES, { c3: { title: 'three' } });
    await draft.createRows(PRODUCTS, { p2: { title: 'two', category: 'c3' } });

    return draft;
  }

  async function givenRenamedCategoriesUnderUnledgeredProducts(): Promise<ChangesScenario> {
    const draft = await givenCommittedUnledgeredProducts();
    await draft.renameTable(CATEGORIES, KINDS);

    return draft;
  }

  async function givenContentEqualUnledgeredProductsOfEditedCategory(): Promise<ChangesScenario> {
    const draft = await givenCommittedUnledgeredProducts();
    await draft.updateRow(PRODUCTS, 'p1', { title: 'uno', category: 'c1' });
    await draft.updateRow(PRODUCTS, 'p1', { title: 'one', category: 'c1' });
    await draft.updateRow(CATEGORIES, 'c1', { title: 'uno' });
    expect(await draft.tableVersionId('draft', PRODUCTS)).not.toBe(
      await draft.tableVersionId('head', PRODUCTS),
    );

    return draft;
  }

  async function givenCommittedUnledgeredProducts(): Promise<ChangesScenario> {
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

    return draft;
  }

  async function givenEditedCatalogWithoutMigrationTable(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committedWithoutLedger(kit, {
      [CATEGORIES]: {
        schema: categorySchema,
        rows: { c1: { title: 'one' }, c2: { title: 'two' } },
      },
      [PRODUCTS]: {
        schema: productSchema,
        rows: { p1: { title: 'one', category: 'c1' } },
      },
    });
    expect(await draft.hasTable('head', SystemTables.Migration)).toBe(false);
    await draft.updateRow(PRODUCTS, 'p1', { title: 'uno', category: 'c1' });
    await draft.createRows(PRODUCTS, { p2: { title: 'two', category: 'c2' } });
    await draft.updateRow(CATEGORIES, 'c1', { title: 'uno' });

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

interface RefusedRequirement {
  readonly operation: string;
  readonly selected: string;
  readonly given: () => Promise<ChangesScenario>;
  readonly apply: (
    draft: ChangesScenario,
  ) => Promise<CommitChangesResult | RevertChangesResult>;
}
