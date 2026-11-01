import { arr, obj, str } from '@revisium/schema-toolkit/mocks';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import type { ChangeOperation } from 'src/features/partial-changes/assembly/outcome-rules';
import type {
  FieldRef,
  RowRef,
  Selection,
} from 'src/features/partial-changes/selection/selection';
import { replaceField } from 'src/features/share/ledger-replay/__tests__/support/ledger-steps';
import { ChangesScenario } from '../../__tests__/support/changes-scenario';
import { withSelectorsOf } from '../../__tests__/support/dependency-closing';

const CATEGORIES = 'categories';
const PRODUCTS = 'products';
const BRANDS = 'brands';
const SHELVES = 'shelves';

const categorySchema = obj({ title: str() });
const productSchema = obj({
  title: str(),
  category: str({ foreignKey: CATEGORIES }),
});

const plainCategorySchema = obj({ title: str(), category: str() });

const shelfSchema = obj({
  title: str(),
  categories: arr(str({ foreignKey: CATEGORIES })),
});

const brandSchema = obj({
  title: str(),
  category: str({ foreignKey: CATEGORIES }),
});

const category = (rowId: string): RowRef => ({ tableId: CATEGORIES, rowId });
const productsStructure = {
  kind: 'structure',
  tableId: PRODUCTS,
  selector: { tables: [PRODUCTS] },
};
const brandsStructure = {
  kind: 'structure',
  tableId: BRANDS,
  selector: { tables: [BRANDS] },
};
const product = (rowId: string): RowRef => ({ tableId: PRODUCTS, rowId });
const categoriesOfS1: FieldRef = {
  tableId: SHELVES,
  rowId: 's1',
  path: '/categories',
};
const categoryOf = (rowId: string): FieldRef => ({
  tableId: PRODUCTS,
  rowId,
  path: '/category',
});

type Given = (kit: PartialChangesTestKit) => Promise<ChangesScenario>;

describe('DependencyClosure: references and ids of rows', () => {
  let kit: PartialChangesTestKit;

  beforeAll(async () => {
    kit = await createPartialChangesTestKit();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await kit.guard.verifyAndForget();
  });

  afterAll(async () => {
    await kit.close();
  });

  describe('a referenced row missing from the target', () => {
    it('requires the creation of a row that a committed field references, with the selector of the creation', async () => {
      const draft = await givenProductMovedToCreatedCategory(kit);

      const closure = await draft.closeDependencies('commit', {
        fields: [categoryOf('p1')],
      });

      expect(closure.required).toEqual([
        {
          unit: {
            kind: 'rowCreate',
            tableId: CATEGORIES,
            rowId: 'c9',
            selector: { rows: [category('c9')] },
          },
          reason: {
            code: 'referencedRowMissing',
            tableId: PRODUCTS,
            rowId: 'p1',
            path: '/category',
            because:
              'products/p1/category references categories/c9, which exists only in the Draft',
          },
        },
      ]);
      expect(closure.blockers).toEqual([]);
    });

    it('requires restoring a deleted row that a reverted field references', async () => {
      const draft = await givenProductMovedFromDeletedCategory(kit);

      const closure = await draft.closeDependencies('revert', {
        fields: [categoryOf('p1')],
      });

      expect(closure.required).toEqual([
        {
          unit: {
            kind: 'rowDelete',
            tableId: CATEGORIES,
            rowId: 'c1',
            selector: { rows: [category('c1')] },
          },
          reason: {
            code: 'referencedRowMissing',
            tableId: PRODUCTS,
            rowId: 'p1',
            path: '/category',
            because:
              'products/p1/category references categories/c1, which exists only in Head',
          },
        },
      ]);
      expect(closure.blockers).toEqual([]);
    });
  });

  it('requires the structure when a restored row would reference a missing row through a changed field', async () => {
    const draft = await givenRemovedProductWhoseCategoryBecameABrand(kit);

    const closure = await draft.closeDependencies('revert', {
      rows: [{ tableId: PRODUCTS, rowId: 'p1' }],
    });

    expect(closure.required).toMatchObject([
      {
        unit: {
          kind: 'structure',
          tableId: PRODUCTS,
          selector: { tables: [PRODUCTS] },
        },
        reason: {
          code: 'structureBoundData',
          tableId: PRODUCTS,
          rowId: 'p1',
          path: '/category',
        },
      },
    ]);
    expect(closure.blockers).toEqual([]);
  });

  describe('a referrer that still references a row the target loses', () => {
    it.each<{
      operation: ChangeOperation;
      given: Given;
      selection: Selection;
      because: string;
    }>([
      {
        operation: 'revert',
        given: givenProductMovedToCreatedCategory,
        selection: { rows: [category('c9')] },
        because:
          'products/p1/category references categories/c9, which the reverted Draft no longer contains',
      },
      {
        operation: 'commit',
        given: givenProductMovedFromDeletedCategory,
        selection: { rows: [category('c1')] },
        because:
          'products/p1/category references categories/c1, which the new Head no longer contains',
      },
    ])(
      'requires the edit of the referrer kept on the base side in a $operation',
      async ({ operation, given, selection, because }) => {
        const draft = await given(kit);

        const closure = await draft.closeDependencies(operation, selection);

        expect(closure.required).toEqual([
          {
            unit: {
              kind: 'field',
              tableId: PRODUCTS,
              rowId: 'p1',
              path: '/category',
              selector: { fields: [categoryOf('p1')] },
            },
            reason: {
              code: 'referrerStillReferences',
              tableId: PRODUCTS,
              rowId: 'p1',
              path: '/category',
              because,
            },
          },
        ]);
        expect(closure.blockers).toEqual([]);
      },
    );
  });

  describe('a referrer whose other-side value still holds the reference', () => {
    it.each<{
      operation: ChangeOperation;
      selection: Selection;
      provider: Record<string, unknown>;
      side: string;
    }>([
      {
        operation: 'commit',
        selection: {
          renames: [category('c2')],
          exclude: { rows: [product('p1')] },
        },
        provider: {
          kind: 'rowCreate',
          tableId: CATEGORIES,
          rowId: 'c1',
          selector: { rows: [category('c1')] },
        },
        side: 'the Draft',
      },
      {
        operation: 'revert',
        selection: {
          rows: [category('c1')],
          exclude: { rows: [product('p1')] },
        },
        provider: {
          kind: 'rowRename',
          tableId: CATEGORIES,
          rowId: 'c2',
          previousRowId: 'c1',
          selector: { renames: [category('c2')] },
        },
        side: 'Head',
      },
    ])(
      'requires the row the reference needs, not the excluded replacement that references it as well, in a $operation',
      async ({ operation, selection, provider, side }) => {
        const draft = await givenRenamedCategoryAndReplacedProduct(kit);

        const closure = await draft.closeDependencies(operation, selection);

        expect(closure.required).toEqual([
          {
            unit: provider,
            reason: {
              code: 'referencedRowMissing',
              tableId: PRODUCTS,
              rowId: 'p1',
              path: '/category',
              because: `products/p1/category references categories/c1, which exists only in ${side}`,
            },
          },
        ]);
        expect(closure.blockers).toEqual([]);
      },
    );

    it('requires the referenced row, not the excluded atomic array whose other side holds it as well', async () => {
      const draft = await givenShelfOfRenamedCategory(kit, ['c2', 'c1']);

      const closure = await draft.closeDependencies('commit', {
        renames: [category('c2')],
        exclude: { fields: [categoriesOfS1] },
      });

      expect(closure.required).toEqual([
        {
          unit: {
            kind: 'rowCreate',
            tableId: CATEGORIES,
            rowId: 'c1',
            selector: { rows: [category('c1')] },
          },
          reason: {
            code: 'referencedRowMissing',
            tableId: SHELVES,
            rowId: 's1',
            path: '/categories/0',
            because:
              'shelves/s1/categories/0 references categories/c1, which exists only in the Draft',
          },
        },
      ]);
      expect(closure.blockers).toEqual([]);
    });

    it('requires the atomic array whose other side drops the reference', async () => {
      const draft = await givenShelfOfRenamedCategory(kit, ['c2']);

      const closure = await draft.closeDependencies('commit', {
        renames: [category('c2')],
      });

      expect(closure.required).toEqual([
        {
          unit: {
            kind: 'field',
            ...categoriesOfS1,
            selector: { fields: [categoriesOfS1] },
          },
          reason: {
            code: 'referrerStillReferences',
            tableId: SHELVES,
            rowId: 's1',
            path: '/categories/0',
            because:
              'shelves/s1/categories/0 references categories/c1, which the new Head no longer contains',
          },
        },
      ]);
    });
  });

  describe('an unchanged row that references an id the target loses', () => {
    it('reads the unchanged referrers of a rename chain once, not on every pass', async () => {
      const draft = await givenShiftedCategoriesUnderUnchangedReferrers(kit);
      const referrerReads = jest.spyOn(
        kit.snapshotReader,
        'readFirstReferrers',
      );

      const closure = await draft.closeDependencies('commit', {
        renames: [category('c5')],
      });

      expect(closure.required.map(({ unit }) => unit)).toMatchObject([
        { kind: 'rowRename', rowId: 'c2', previousRowId: 'c1' },
        { kind: 'rowRename', rowId: 'c3', previousRowId: 'c2' },
        { kind: 'rowRename', rowId: 'c4', previousRowId: 'c3' },
      ]);
      expect(closure.blockers).toEqual([]);
      expect(referrerReads).toHaveBeenCalledTimes(1);
    });

    it('requires the rename that gives the lost id back, then the referrer edit that rename needs', async () => {
      const draft = await givenRenameChainUnderUnchangedReferrer(kit);

      const closure = await draft.closeDependencies('commit', {
        renames: [category('c9')],
      });

      expect(closure.required).toEqual([
        {
          unit: {
            kind: 'rowRename',
            tableId: CATEGORIES,
            rowId: 'c2',
            previousRowId: 'c1',
            selector: { renames: [category('c2')] },
          },
          reason: {
            code: 'referencedRowMissing',
            tableId: PRODUCTS,
            rowId: 'q1',
            because:
              'products/q1 references categories/c2, which the new Head loses',
          },
        },
        {
          unit: {
            kind: 'field',
            tableId: PRODUCTS,
            rowId: 'p1',
            path: '/category',
            selector: { fields: [categoryOf('p1')] },
          },
          reason: {
            code: 'referrerStillReferences',
            tableId: PRODUCTS,
            rowId: 'p1',
            path: '/category',
            because:
              'products/p1/category references categories/c1, which the new Head no longer contains',
          },
        },
      ]);
      expect(closure.blockers).toEqual([]);
    });

    it.each([
      { deleted: 1, read: 'an indexed lookup' },
      { deleted: 101, read: 'one scan, past the ids of an indexed lookup' },
    ])(
      'blocks committed deletions that an unchanged row still references as danglingInSource, read by $read',
      async ({ deleted }) => {
        const categoryIds = idsOf('c', deleted);
        const draft = await givenCategoriesDeletedUnderUnchangedReferrer(
          kit,
          categoryIds,
        );
        const referrerReads = jest.spyOn(
          kit.snapshotReader,
          'readFirstReferrers',
        );

        const closure = await draft.closeDependencies('commit', {
          rows: categoryIds.map(category),
        });

        expect(closure.required).toEqual([]);
        expect(closure.blockers).toEqual([
          {
            code: 'danglingInSource',
            tableId: PRODUCTS,
            rowId: 'p1',
            message:
              'No unit can restore consistency: products/p1 references categories/c1, which the new Head loses',
            unit: {
              kind: 'rowDelete',
              tableId: CATEGORIES,
              rowId: 'c1',
              selector: { rows: [category('c1')] },
            },
          },
        ]);
        expect(referrerReads).toHaveBeenCalledTimes(1);
        expect(referrerReads.mock.calls[0]?.[1].rowIds).toHaveLength(deleted);
      },
    );
  });

  describe('an unchanged row whose key the structure changes and that references an id the target loses', () => {
    it.each<{
      operation: ChangeOperation;
      given: Given;
      selection: Selection;
      because: string;
    }>([
      {
        operation: 'commit',
        given: givenCategoryDeletedAfterItsKeyWasDropped,
        selection: { rows: [category('c1')] },
        because:
          'products/p1/category references categories/c1, which the new Head loses; the value follows the structure of products',
      },
      {
        operation: 'revert',
        given: givenCategoryCreatedForANewKey,
        selection: { rows: [category('c9')] },
        because:
          'products/p1/category references categories/c9, which the reverted Draft loses; the value follows the structure of products',
      },
    ])(
      'requires the structure that owns the key in a $operation',
      async ({ operation, given, selection, because }) => {
        const draft = await given(kit);

        const closure = await draft.closeDependencies(operation, selection);

        expect(closure.required).toEqual([
          {
            unit: productsStructure,
            reason: {
              code: 'structureBoundData',
              tableId: PRODUCTS,
              rowId: 'p1',
              path: '/category',
              because,
            },
          },
        ]);
        expect(closure.blockers).toEqual([]);
      },
    );

    it('blocks the structure that owns the key as requiredExcluded when the selection excludes it', async () => {
      const draft = await givenCategoryDeletedAfterItsKeyWasDropped(kit);

      const closure = await draft.closeDependencies('commit', {
        rows: [category('c1')],
        exclude: { tables: [PRODUCTS] },
      });

      expect(closure.required).toEqual([]);
      expect(closure.blockers).toEqual([
        {
          code: 'requiredExcluded',
          tableId: PRODUCTS,
          message: 'products is required but excluded',
          unit: productsStructure,
          reason: {
            code: 'structureBoundData',
            tableId: PRODUCTS,
            rowId: 'p1',
            path: '/category',
            because:
              'products/p1/category references categories/c1, which the new Head loses; the value follows the structure of products',
          },
        },
      ]);
    });
  });

  describe('a row of a table on one side only that references an id the target loses', () => {
    it.each<{
      operation: ChangeOperation;
      given: Given;
      selection: Selection;
      because: string;
    }>([
      {
        operation: 'revert',
        given: givenCreatedBrandOfCreatedCategory,
        selection: { rows: [category('c9')] },
        because:
          'brands/b1/category references categories/c9, which the reverted Draft loses; the value follows the structure of brands',
      },
      {
        operation: 'commit',
        given: givenRemovedBrandOfDeletedCategory,
        selection: { rows: [category('c1')] },
        because:
          'brands/b1/category references categories/c1, which the new Head loses; the value follows the structure of brands',
      },
    ])(
      'requires the structure of that table in a $operation',
      async ({ operation, given, selection, because }) => {
        const draft = await given(kit);

        const closure = await draft.closeDependencies(operation, selection);

        expect(closure.required).toEqual([
          {
            unit: brandsStructure,
            reason: {
              code: 'structureBoundData',
              tableId: BRANDS,
              rowId: 'b1',
              path: '/category',
              because,
            },
          },
        ]);
        expect(closure.blockers).toEqual([]);
      },
    );
  });

  it('blocks a committed value that references a row of neither revision as danglingInSource', async () => {
    const draft = await givenProductReferencingMissingCategory(kit);

    const closure = await draft.closeDependencies('commit', {
      fields: [categoryOf('p1')],
    });

    expect(closure.required).toEqual([]);
    expect(closure.blockers).toEqual([
      {
        code: 'danglingInSource',
        tableId: PRODUCTS,
        rowId: 'p1',
        path: '/category',
        message:
          'No unit can restore consistency: products/p1/category references categories/c404, which the new Head does not contain',
        unit: {
          kind: 'field',
          tableId: PRODUCTS,
          rowId: 'p1',
          path: '/category',
          selector: { fields: [categoryOf('p1')] },
        },
      },
    ]);
  });

  describe('two rows holding one id in the target', () => {
    it.each<{ operation: ChangeOperation; rowId: string; target: string }>([
      { operation: 'commit', rowId: 'c2', target: 'new Head' },
      { operation: 'revert', rowId: 'c1', target: 'reverted Draft' },
    ])(
      'requires the other half of a row id swap in a $operation',
      async ({ operation, rowId, target }) => {
        const draft = await givenSwappedCategoryIds(kit);

        const closure = await draft.closeDependencies(operation, {
          renames: [category('c2')],
        });

        expect(closure.required).toEqual([
          {
            unit: {
              kind: 'rowRename',
              tableId: CATEGORIES,
              rowId: 'c1',
              previousRowId: 'c2',
              selector: { renames: [category('c1')] },
            },
            reason: {
              code: 'idOccupied',
              tableId: CATEGORIES,
              rowId,
              because: `categories/${rowId} would be held by two rows in the ${target}`,
            },
          },
        ]);
        expect(closure.blockers).toEqual([]);
      },
    );

    it('requires the deletion that vacated the id a committed rename takes, addressed on the Head side', async () => {
      const draft = await givenRenameIntoDeletedCategoryId(kit);

      const closure = await draft.closeDependencies('commit', {
        renames: [category('c1')],
      });

      expect(closure.required).toEqual([
        {
          unit: {
            kind: 'rowDelete',
            tableId: CATEGORIES,
            rowId: 'c1',
            side: 'head',
            selector: { rows: [{ ...category('c1'), side: 'head' }] },
          },
          reason: {
            code: 'idOccupied',
            tableId: CATEGORIES,
            rowId: 'c1',
            because: 'categories/c1 would be held by two rows in the new Head',
          },
        },
      ]);
    });
  });

  it('blocks a required unit that the selection excludes as requiredExcluded, naming the unit and its reason', async () => {
    const draft = await givenProductMovedToCreatedCategory(kit);

    const closure = await draft.closeDependencies('commit', {
      fields: [categoryOf('p1')],
      exclude: { rows: [category('c9')] },
    });

    expect(closure.required).toEqual([]);
    expect(closure.blockers).toEqual([
      {
        code: 'requiredExcluded',
        tableId: CATEGORIES,
        rowId: 'c9',
        message: 'categories/c9 is required but excluded',
        unit: {
          kind: 'rowCreate',
          tableId: CATEGORIES,
          rowId: 'c9',
          selector: { rows: [category('c9')] },
        },
        reason: {
          code: 'referencedRowMissing',
          tableId: PRODUCTS,
          rowId: 'p1',
          path: '/category',
          because:
            'products/p1/category references categories/c9, which exists only in the Draft',
        },
      },
    ]);
  });

  it.each<{
    name: string;
    operation: ChangeOperation;
    given: Given;
    selection: Selection;
  }>([
    {
      name: 'a created referenced row',
      operation: 'commit',
      given: givenProductMovedToCreatedCategory,
      selection: { fields: [categoryOf('p1')] },
    },
    {
      name: 'a rename and the referrer edit it needs',
      operation: 'commit',
      given: givenRenameChainUnderUnchangedReferrer,
      selection: { renames: [category('c9')] },
    },
    {
      name: 'a Head-side deletion',
      operation: 'commit',
      given: givenRenameIntoDeletedCategoryId,
      selection: { renames: [category('c1')] },
    },
    {
      name: 'the other half of a swap',
      operation: 'revert',
      given: givenSwappedCategoryIds,
      selection: { renames: [category('c2')] },
    },
    {
      name: 'the structure that dropped the key of an unchanged referrer',
      operation: 'commit',
      given: givenCategoryDeletedAfterItsKeyWasDropped,
      selection: { rows: [category('c1')] },
    },
    {
      name: 'the structure that added the key of an unchanged referrer',
      operation: 'revert',
      given: givenCategoryCreatedForANewKey,
      selection: { rows: [category('c9')] },
    },
  ])(
    'closes with nothing required once the selectors of $name are added (AS-67)',
    async ({ operation, given, selection }) => {
      const draft = await given(kit);
      const { required } = await draft.closeDependencies(operation, selection);

      const closure = await draft.closeDependencies(
        operation,
        withSelectorsOf(selection, required),
      );

      expect(required).not.toEqual([]);
      expect(closure.required).toEqual([]);
      expect(closure.blockers).toEqual([]);
    },
  );
});

async function givenCatalogue(
  kit: PartialChangesTestKit,
  categoryIds: readonly string[],
  products: Readonly<Record<string, string>>,
): Promise<ChangesScenario> {
  return ChangesScenario.committed(kit, {
    [CATEGORIES]: {
      schema: categorySchema,
      rows: Object.fromEntries(
        categoryIds.map((rowId) => [rowId, { title: rowId }]),
      ),
    },
    [PRODUCTS]: {
      schema: productSchema,
      rows: Object.fromEntries(
        Object.entries(products).map(([rowId, categoryId]) => [
          rowId,
          { title: rowId, category: categoryId },
        ]),
      ),
    },
  });
}

async function givenProductMovedToCreatedCategory(
  kit: PartialChangesTestKit,
): Promise<ChangesScenario> {
  const draft = await givenCatalogue(kit, ['c1'], { p1: 'c1' });
  await draft.createRows(CATEGORIES, { c9: { title: 'c9' } });
  await draft.updateRow(PRODUCTS, 'p1', { title: 'p1', category: 'c9' });

  return draft;
}

async function givenProductMovedFromDeletedCategory(
  kit: PartialChangesTestKit,
): Promise<ChangesScenario> {
  const draft = await givenCatalogue(kit, ['c1', 'c2'], { p1: 'c1' });
  await draft.updateRow(PRODUCTS, 'p1', { title: 'p1', category: 'c2' });
  await draft.removeRow(CATEGORIES, 'c1');

  return draft;
}

async function givenRemovedProductWhoseCategoryBecameABrand(
  kit: PartialChangesTestKit,
): Promise<ChangesScenario> {
  const draft = await givenCatalogue(kit, ['c1'], { p1: 'c1' });
  await draft.createTable(BRANDS, categorySchema);
  await draft.createRows(BRANDS, { b1: { title: 'b1' } });
  await draft.removeRow(PRODUCTS, 'p1');
  await draft.updateTable(PRODUCTS, [
    replaceField('category', str({ foreignKey: BRANDS })),
  ]);

  return draft;
}

async function givenRenameChainUnderUnchangedReferrer(
  kit: PartialChangesTestKit,
): Promise<ChangesScenario> {
  const draft = await givenCatalogue(kit, ['c1', 'c2'], {
    p1: 'c1',
    q1: 'c2',
  });
  await draft.renameRow(CATEGORIES, 'c2', 'c9');
  await draft.renameRow(CATEGORIES, 'c1', 'c2');
  await draft.updateRow(PRODUCTS, 'q1', { title: 'q1', category: 'c2' });

  return draft;
}

async function givenRenamedCategoryAndReplacedProduct(
  kit: PartialChangesTestKit,
): Promise<ChangesScenario> {
  const draft = await givenCatalogue(kit, ['c1'], { p1: 'c1' });
  await draft.renameRow(CATEGORIES, 'c1', 'c2');
  await draft.createRows(CATEGORIES, { c1: { title: 'new c1' } });
  await draft.removeRow(PRODUCTS, 'p1');
  await draft.createRows(PRODUCTS, {
    p1: { title: 'new p1', category: 'c1' },
  });

  return draft;
}

async function givenShelfOfRenamedCategory(
  kit: PartialChangesTestKit,
  draftCategories: readonly string[],
): Promise<ChangesScenario> {
  const draft = await ChangesScenario.committed(kit, {
    [CATEGORIES]: { schema: categorySchema, rows: { c1: { title: 'c1' } } },
    [SHELVES]: {
      schema: shelfSchema,
      rows: { s1: { title: 's1', categories: ['c1'] } },
    },
  });
  await draft.renameRow(CATEGORIES, 'c1', 'c2');
  await draft.createRows(CATEGORIES, { c1: { title: 'new c1' } });
  await draft.updateRow(SHELVES, 's1', {
    title: 's1',
    categories: [...draftCategories],
  });

  return draft;
}

async function givenShiftedCategoriesUnderUnchangedReferrers(
  kit: PartialChangesTestKit,
): Promise<ChangesScenario> {
  const draft = await givenCatalogue(kit, ['c1', 'c2', 'c3', 'c4'], {
    q2: 'c2',
    q3: 'c3',
    q4: 'c4',
  });

  for (const index of [4, 3, 2, 1]) {
    await draft.renameRow(CATEGORIES, `c${index}`, `c${index + 1}`);
  }

  for (const index of [2, 3, 4]) {
    await draft.updateRow(PRODUCTS, `q${index}`, {
      title: `q${index}`,
      category: `c${index}`,
    });
  }

  return draft;
}

async function givenCategoriesDeletedUnderUnchangedReferrer(
  kit: PartialChangesTestKit,
  categoryIds: readonly string[],
): Promise<ChangesScenario> {
  const draft = await givenCatalogue(kit, categoryIds, { p1: 'c1' });
  await draft.removeReferencedRows(CATEGORIES, categoryIds);

  await expect(draft.row('draft', CATEGORIES, 'c1')).rejects.toThrow();
  await expect(draft.row('draft', PRODUCTS, 'p1')).resolves.toMatchObject({
    data: { category: 'c1' },
  });

  return draft;
}

function idsOf(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}${index + 1}`);
}

async function givenProductReferencingMissingCategory(
  kit: PartialChangesTestKit,
): Promise<ChangesScenario> {
  const draft = await givenCatalogue(kit, ['c1'], { p1: 'c1' });
  await draft.writeDanglingReference(PRODUCTS, 'p1', {
    title: 'p1',
    category: 'c404',
  });

  await expect(draft.row('draft', PRODUCTS, 'p1')).resolves.toMatchObject({
    data: { category: 'c404' },
  });

  return draft;
}

async function givenCategoryDeletedAfterItsKeyWasDropped(
  kit: PartialChangesTestKit,
): Promise<ChangesScenario> {
  const draft = await givenCatalogue(kit, ['c1'], { p1: 'c1' });
  await draft.updateTable(PRODUCTS, [replaceField('category', str())]);
  await draft.removeRow(CATEGORIES, 'c1');

  return draft;
}

async function givenCategoryCreatedForANewKey(
  kit: PartialChangesTestKit,
): Promise<ChangesScenario> {
  const draft = await ChangesScenario.committed(kit, {
    [CATEGORIES]: { schema: categorySchema, rows: { c1: { title: 'c1' } } },
    [PRODUCTS]: {
      schema: plainCategorySchema,
      rows: { p1: { title: 'p1', category: 'c9' } },
    },
  });
  await draft.createRows(CATEGORIES, { c9: { title: 'c9' } });
  await draft.updateTable(PRODUCTS, [
    replaceField('category', str({ foreignKey: CATEGORIES })),
  ]);

  return draft;
}

async function givenCreatedBrandOfCreatedCategory(
  kit: PartialChangesTestKit,
): Promise<ChangesScenario> {
  const draft = await givenCatalogue(kit, ['c1'], {});
  await draft.createRows(CATEGORIES, { c9: { title: 'c9' } });
  await draft.createTable(BRANDS, brandSchema);
  await draft.createRows(BRANDS, { b1: { title: 'b1', category: 'c9' } });

  return draft;
}

async function givenRemovedBrandOfDeletedCategory(
  kit: PartialChangesTestKit,
): Promise<ChangesScenario> {
  const draft = await ChangesScenario.committed(kit, {
    [CATEGORIES]: { schema: categorySchema, rows: { c1: { title: 'c1' } } },
    [BRANDS]: {
      schema: brandSchema,
      rows: { b1: { title: 'b1', category: 'c1' } },
    },
  });
  await draft.removeTable(BRANDS);
  await draft.removeRow(CATEGORIES, 'c1');

  return draft;
}

async function givenSwappedCategoryIds(
  kit: PartialChangesTestKit,
): Promise<ChangesScenario> {
  const draft = await givenCatalogue(kit, ['c1', 'c2'], {});
  await draft.renameRow(CATEGORIES, 'c1', 'swap');
  await draft.renameRow(CATEGORIES, 'c2', 'c1');
  await draft.renameRow(CATEGORIES, 'swap', 'c2');

  return draft;
}

async function givenRenameIntoDeletedCategoryId(
  kit: PartialChangesTestKit,
): Promise<ChangesScenario> {
  const draft = await givenCatalogue(kit, ['c1', 'c2'], {});
  await draft.removeRow(CATEGORIES, 'c1');
  await draft.renameRow(CATEGORIES, 'c2', 'c1');

  return draft;
}
