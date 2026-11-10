import { arr, obj, str } from '@revisium/schema-toolkit/mocks';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import type { InputJsonValue } from 'src/engine-prisma-types';
import type { RefusalCode } from 'src/features/partial-changes/head-schema/head-schema-check';
import type { ChangeOperation } from 'src/features/partial-changes/plan/change-operation';
import type {
  FieldRef,
  RowRef,
  Selection,
} from 'src/features/partial-changes/selection/selection';
import { completeAsyncMigrationInPlace } from 'src/__tests__/fixtures/head-schema-damage';
import {
  addField,
  moveField,
  replaceField,
} from 'src/__tests__/fixtures/ledger-steps';
import { ChangesScenario } from '../../__tests__/support/changes-scenario';
import { withSelectorsOf } from '../../__tests__/support/dependency-closing';

const CATEGORIES = 'categories';
const KINDS = 'kinds';
const PRODUCTS = 'products';
const BRANDS = 'brands';
const SHELVES = 'shelves';
const RACKS = 'racks';
const GOODS = 'goods';

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

const rackSchema = obj({
  title: str(),
  slots: arr(obj({ category: str({ foreignKey: CATEGORIES }) })),
});

const brandSchema = obj({
  title: str(),
  category: str({ foreignKey: CATEGORIES }),
});

const category = (rowId: string): RowRef => ({ tableId: CATEGORIES, rowId });
const productsStructure = {
  kind: 'structure',
  tableId: PRODUCTS,
  selector: { structures: [{ tableId: PRODUCTS }] },
};
const brandsStructure = {
  kind: 'structure',
  tableId: BRANDS,
  selector: { structures: [{ tableId: BRANDS }] },
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

const categoryRow = (kind: 'rowCreate' | 'rowDelete', rowId: string) => ({
  kind,
  tableId: CATEGORIES,
  rowId,
  selector: { rows: [category(rowId)] },
});
const categoryRename = (rowId: string, previousRowId: string) => ({
  kind: 'rowRename',
  tableId: CATEGORIES,
  rowId,
  previousRowId,
  selector: { rowRenames: [category(rowId)] },
});
const categoryOfProduct = (rowId: string) => ({
  kind: 'field',
  ...categoryOf(rowId),
  selector: { fields: [categoryOf(rowId)] },
});
const referringField = (tableId: string, rowId: string, path: string) => ({
  kind: 'row',
  tableId,
  rowId,
  path,
});
const referencedCategory = (rowId: string) => ({
  kind: 'row',
  tableId: CATEGORIES,
  rowId,
});

type Given = (kit: PartialChangesTestKit) => Promise<ChangesScenario>;

interface RefusedProducts {
  readonly damage: string;
  readonly code: RefusalCode;
  readonly message: string;
  readonly committed: Given;
  readonly product: (title: string, categoryId: string) => InputJsonValue;
}

type ProductOf = RefusedProducts['product'];

interface ReferrerChange {
  readonly operation: ChangeOperation;
  readonly lost: string;
  readonly selection: Selection;
  readonly edit: (draft: ChangesScenario, product: ProductOf) => Promise<void>;
}

const REFERRER_CHANGES: ReferrerChange[] = [
  {
    operation: 'commit',
    lost: 'a category deletion while the Draft repoints the referrer',
    selection: { rows: [category('c1')] },
    edit: repointProductsAcrossCategories,
  },
  {
    operation: 'revert',
    lost: 'a category creation that the Draft referrer references',
    selection: { rows: [category('c3')] },
    edit: repointProductsAcrossCategories,
  },
  {
    operation: 'commit',
    lost: 'a category deletion while the Draft drops the foreign key of the referrer',
    selection: { rows: [category('c1')] },
    edit: async (draft) => {
      await draft.updateTable(PRODUCTS, [replaceField('category', str())]);
      await draft.removeRow(CATEGORIES, 'c1');
    },
  },
  {
    operation: 'commit',
    lost: 'a category deletion while the Draft removes the referrer',
    selection: { rows: [category('c1')] },
    edit: async (draft) => {
      await draft.removeTable(PRODUCTS);
      await draft.removeRow(CATEGORIES, 'c1');
    },
  },
];

interface DanglingReferrer {
  readonly draft: string;
  readonly edit: (draft: ChangesScenario, product: ProductOf) => Promise<void>;
}

const DANGLING_REFERRERS: DanglingReferrer[] = [
  { draft: 'where the referrer is unchanged', edit: () => Promise.resolve() },
  {
    draft: 'next to a product created in the Draft',
    edit: (draft, product) =>
      draft.createRows(PRODUCTS, { p2: product('p2', 'c2') }),
  },
  {
    draft: 'under a foreign key the Draft moved to another field',
    edit: (draft) =>
      draft.updateTable(PRODUCTS, [moveField('category', 'cat')]),
  },
];

const REFUSED_PRODUCTS: RefusedProducts[] = [
  {
    damage: 'a Head ledger without its init',
    code: 'unledgeredTable',
    message: 'products is refused: it has no intact ledger lineage',
    committed: committedProductsWithoutInit,
    product: (title, category) => ({ title, category }),
  },
  {
    damage: 'an async migration completed in place and published natively',
    code: 'headSchemaInconsistent',
    message:
      'products is refused: its Head schema does not match its Head ledger',
    committed: committedProductsMigratedInPlace,
    product: (title, category) => ({ title, category, color: '' }),
  },
];

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
            because:
              'products/p1/category references categories/c9, which exists only in the Draft',
            site: referringField(PRODUCTS, 'p1', '/category'),
            references: referencedCategory('c9'),
            cause: { unit: categoryOfProduct('p1'), role: 'referrer' },
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
            because:
              'products/p1/category references categories/c1, which exists only in Head',
            site: referringField(PRODUCTS, 'p1', '/category'),
            references: referencedCategory('c1'),
            cause: { unit: categoryOfProduct('p1'), role: 'referrer' },
          },
        },
      ]);
      expect(closure.blockers).toEqual([]);
    });
  });

  it('names the site and the referenced row by the public ids units carry, also for a renamed referrer (AS-84)', async () => {
    const draft = await givenRenamedProductMovedToCreatedCategory(kit);

    const closure = await draft.closeDependencies('commit', {
      fields: [categoryOf('p1x')],
    });

    expect(closure.required).toEqual([
      {
        unit: categoryRow('rowCreate', 'c9'),
        reason: {
          code: 'referencedRowMissing',
          because:
            'products/p1x/category references categories/c9, which exists only in the Draft',
          site: referringField(PRODUCTS, 'p1x', '/category'),
          references: referencedCategory('c9'),
          cause: { unit: categoryOfProduct('p1x'), role: 'referrer' },
        },
      },
    ]);
    expect(closure.blockers).toEqual([]);
  });

  it('names the referring table by the Draft id a rename that stays out gives it (AS-84)', async () => {
    const draft = await givenProductMovedToCreatedCategory(kit);
    await draft.renameTable(PRODUCTS, GOODS);
    const categoryOfGoods = { ...categoryOf('p1'), tableId: GOODS };

    const closure = await draft.closeDependencies('commit', {
      fields: [categoryOfGoods],
    });

    expect(closure.required).toEqual([
      {
        unit: categoryRow('rowCreate', 'c9'),
        reason: {
          code: 'referencedRowMissing',
          because:
            'goods/p1/category references categories/c9, which exists only in the Draft',
          site: referringField(GOODS, 'p1', '/category'),
          references: referencedCategory('c9'),
          cause: {
            unit: {
              kind: 'field',
              ...categoryOfGoods,
              selector: { fields: [categoryOfGoods] },
            },
            role: 'referrer',
          },
        },
      },
    ]);
    expect(closure.blockers).toEqual([]);
  });

  it('places a reference inside an array of objects at the array, which is one field (AS-84)', async () => {
    const draft = await givenRackOfDeletedCategory(kit);
    const slotsOfR1 = { tableId: RACKS, rowId: 'r1', path: '/slots' };

    const closure = await draft.closeDependencies('commit', {
      rows: [category('c1')],
    });

    expect(closure.required).toEqual([
      {
        unit: {
          kind: 'field',
          ...slotsOfR1,
          selector: { fields: [slotsOfR1] },
        },
        reason: {
          code: 'referrerStillReferences',
          because:
            'racks/r1/slots references categories/c1, which the new Head no longer contains',
          site: referringField(RACKS, 'r1', '/slots'),
          references: referencedCategory('c1'),
          cause: { unit: categoryRow('rowDelete', 'c1'), role: 'remover' },
        },
      },
    ]);
    expect(closure.blockers).toEqual([]);
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
          selector: { structures: [{ tableId: PRODUCTS }] },
        },
        reason: {
          code: 'structureBoundData',
          site: referringField(PRODUCTS, 'p1', '/category'),
          references: { kind: 'row', tableId: BRANDS, rowId: 'c1' },
          cause: {
            unit: { kind: 'rowDelete', tableId: PRODUCTS, rowId: 'p1' },
            role: 'referrer',
          },
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
      lost: string;
      because: string;
      remover: Record<string, unknown>;
    }>([
      {
        operation: 'revert',
        given: givenProductMovedToCreatedCategory,
        selection: { rows: [category('c9')] },
        lost: 'c9',
        because:
          'products/p1/category references categories/c9, which the reverted Draft no longer contains',
        remover: categoryRow('rowCreate', 'c9'),
      },
      {
        operation: 'commit',
        given: givenProductMovedFromDeletedCategory,
        selection: { rows: [category('c1')] },
        lost: 'c1',
        because:
          'products/p1/category references categories/c1, which the new Head no longer contains',
        remover: categoryRow('rowDelete', 'c1'),
      },
    ])(
      'requires the edit of the referrer kept on the base side in a $operation',
      async ({ operation, given, selection, lost, because, remover }) => {
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
              because,
              site: referringField(PRODUCTS, 'p1', '/category'),
              references: referencedCategory(lost),
              cause: { unit: remover, role: 'remover' },
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
      remover: Record<string, unknown>;
      side: string;
    }>([
      {
        operation: 'commit',
        selection: {
          rowRenames: [category('c2')],
          exclude: { rows: [product('p1')] },
        },
        provider: categoryRow('rowCreate', 'c1'),
        remover: categoryRename('c2', 'c1'),
        side: 'the Draft',
      },
      {
        operation: 'revert',
        selection: {
          rows: [category('c1')],
          exclude: { rows: [product('p1')] },
        },
        provider: categoryRename('c2', 'c1'),
        remover: categoryRow('rowCreate', 'c1'),
        side: 'Head',
      },
    ])(
      'requires the row the reference needs, not the excluded replacement that references it as well, in a $operation',
      async ({ operation, selection, provider, remover, side }) => {
        const draft = await givenRenamedCategoryAndReplacedProduct(kit);

        const closure = await draft.closeDependencies(operation, selection);

        expect(closure.required).toEqual([
          {
            unit: provider,
            reason: {
              code: 'referencedRowMissing',
              because: `products/p1/category references categories/c1, which exists only in ${side}`,
              site: referringField(PRODUCTS, 'p1', '/category'),
              references: referencedCategory('c1'),
              cause: { unit: remover, role: 'remover' },
            },
          },
        ]);
        expect(closure.blockers).toEqual([]);
      },
    );

    it('requires the referenced row, not the excluded atomic array whose other side holds it as well', async () => {
      const draft = await givenShelfOfRenamedCategory(kit, ['c2', 'c1']);

      const closure = await draft.closeDependencies('commit', {
        rowRenames: [category('c2')],
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
            because:
              'shelves/s1/categories references categories/c1, which exists only in the Draft',
            site: referringField(SHELVES, 's1', '/categories'),
            references: referencedCategory('c1'),
            cause: { unit: categoryRename('c2', 'c1'), role: 'remover' },
          },
        },
      ]);
      expect(closure.blockers).toEqual([]);
    });

    it('requires the atomic array whose other side drops the reference', async () => {
      const draft = await givenShelfOfRenamedCategory(kit, ['c2']);

      const closure = await draft.closeDependencies('commit', {
        rowRenames: [category('c2')],
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
            because:
              'shelves/s1/categories references categories/c1, which the new Head no longer contains',
            site: referringField(SHELVES, 's1', '/categories'),
            references: referencedCategory('c1'),
            cause: { unit: categoryRename('c2', 'c1'), role: 'remover' },
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
        rowRenames: [category('c5')],
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
        rowRenames: [category('c9')],
      });

      expect(closure.required).toEqual([
        {
          unit: {
            kind: 'rowRename',
            tableId: CATEGORIES,
            rowId: 'c2',
            previousRowId: 'c1',
            selector: { rowRenames: [category('c2')] },
          },
          reason: {
            code: 'referencedRowMissing',
            because:
              'products/q1/category references categories/c2, which the new Head loses',
            site: referringField(PRODUCTS, 'q1', '/category'),
            references: referencedCategory('c2'),
            cause: { unit: categoryRename('c9', 'c2'), role: 'remover' },
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
            because:
              'products/p1/category references categories/c1, which the new Head no longer contains',
            site: referringField(PRODUCTS, 'p1', '/category'),
            references: referencedCategory('c1'),
            cause: { unit: categoryRename('c2', 'c1'), role: 'remover' },
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
            path: '/category',
            message:
              'No unit can restore consistency: products/p1/category references categories/c1, which the new Head loses',
            unit: categoryRow('rowDelete', 'c1'),
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
      lost: string;
      because: string;
      remover: Record<string, unknown>;
    }>([
      {
        operation: 'commit',
        given: givenCategoryDeletedAfterItsKeyWasDropped,
        selection: { rows: [category('c1')] },
        lost: 'c1',
        because:
          'products/p1/category references categories/c1, which the new Head loses; the value follows the structure of products',
        remover: categoryRow('rowDelete', 'c1'),
      },
      {
        operation: 'revert',
        given: givenCategoryCreatedForANewKey,
        selection: { rows: [category('c9')] },
        lost: 'c9',
        because:
          'products/p1/category references categories/c9, which the reverted Draft loses; the value follows the structure of products',
        remover: categoryRow('rowCreate', 'c9'),
      },
    ])(
      'requires the structure that owns the key in a $operation',
      async ({ operation, given, selection, lost, because, remover }) => {
        const draft = await given(kit);

        const closure = await draft.closeDependencies(operation, selection);

        expect(closure.required).toEqual([
          {
            unit: productsStructure,
            reason: {
              code: 'structureBoundData',
              because,
              site: referringField(PRODUCTS, 'p1', '/category'),
              references: referencedCategory(lost),
              cause: { unit: remover, role: 'remover' },
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
        exclude: { structures: [{ tableId: PRODUCTS }] },
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
            because:
              'products/p1/category references categories/c1, which the new Head loses; the value follows the structure of products',
            site: referringField(PRODUCTS, 'p1', '/category'),
            references: referencedCategory('c1'),
            cause: { unit: categoryRow('rowDelete', 'c1'), role: 'remover' },
          },
        },
      ]);
    });
  });

  describe('a row of a refused table that references an id the target loses', () => {
    it.each(
      REFUSED_PRODUCTS.flatMap((refused) =>
        REFERRER_CHANGES.map((change) => ({ ...refused, ...change })),
      ),
    )(
      'blocks a $operation of $lost with the code of the referrer left by $damage, since only a change of it could drop the reference',
      async ({ operation, selection, code, message, edit, ...refused }) => {
        const draft = await refused.committed(kit);
        await edit(draft, refused.product);

        const closure = await draft.closeDependencies(operation, selection);

        expect(closure.required).toEqual([]);
        expect(closure.blockers).toEqual([
          { code, tableId: PRODUCTS, message },
        ]);
      },
    );

    it.each(
      REFUSED_PRODUCTS.flatMap((refused) =>
        DANGLING_REFERRERS.map((dangling) => ({ ...refused, ...dangling })),
      ),
    )(
      'blocks a commit as danglingInSource when the referrer left by $damage references the lost id in the Draft too, $draft',
      async ({ committed, product, edit }) => {
        const draft = await committed(kit);
        await edit(draft, product);
        await draft.removeReferencedRows(CATEGORIES, ['c1']);

        const closure = await draft.closeDependencies('commit', {
          rows: [category('c1')],
        });

        expect(closure.required).toEqual([]);
        expect(closure.blockers).toEqual([
          {
            code: 'danglingInSource',
            tableId: PRODUCTS,
            rowId: 'p1',
            path: '/category',
            message:
              'No unit can restore consistency: products/p1/category references categories/c1, which the new Head loses',
            unit: categoryRow('rowDelete', 'c1'),
          },
        ]);
      },
    );

    it.each(REFUSED_PRODUCTS)(
      'blocks a commit as danglingInSource when the referrer left by $damage references the lost id in the Draft too, under the id the Draft gives the referenced table',
      async ({ committed }) => {
        const draft = await committed(kit);
        await draft.renameTable(CATEGORIES, KINDS);
        await draft.removeReferencedRows(KINDS, ['c1']);

        const closure = await draft.closeDependencies('commit', {
          rows: [{ tableId: KINDS, rowId: 'c1' }],
        });

        expect(closure.required).toEqual([]);
        expect(closure.blockers).toEqual([
          {
            code: 'danglingInSource',
            tableId: PRODUCTS,
            rowId: 'p1',
            path: '/category',
            message:
              'No unit can restore consistency: products/p1/category references kinds/c1, which the new Head loses',
            unit: {
              kind: 'rowDelete',
              tableId: KINDS,
              rowId: 'c1',
              selector: { rows: [{ tableId: KINDS, rowId: 'c1' }] },
            },
          },
        ]);
      },
    );

    it('reads an unchanged refused referrer once, sharing the read of the lost ids', async () => {
      const draft = await committedProductsWithoutInit(kit, {
        p1: 'c1',
        p2: 'c2',
      });
      await draft.removeReferencedRows(CATEGORIES, ['c1', 'c2']);
      const referrerReads = jest.spyOn(
        kit.snapshotReader,
        'readFirstReferrers',
      );

      const closure = await draft.closeDependencies('commit', {
        rows: [category('c1'), category('c2')],
      });

      expect(closure.blockers).toMatchObject([
        { code: 'danglingInSource', rowId: 'p1' },
        { code: 'danglingInSource', rowId: 'p2' },
      ]);
      expect(referrerReads).toHaveBeenCalledTimes(1);
    });

    it('reads the Draft references of a refused referrer once for all its lost ids', async () => {
      const draft = await committedProductsWithoutInit(kit, {
        p1: 'c1',
        p2: 'c2',
      });
      await draft.createRows(CATEGORIES, { c3: { title: 'c3' } });
      await draft.updateRow(PRODUCTS, 'p1', { title: 'p1', category: 'c3' });
      await draft.updateRow(PRODUCTS, 'p2', { title: 'p2', category: 'c3' });
      await draft.removeRow(CATEGORIES, 'c1');
      await draft.removeRow(CATEGORIES, 'c2');
      const referrerReads = jest.spyOn(
        kit.snapshotReader,
        'readFirstReferrers',
      );

      const closure = await draft.closeDependencies('commit', {
        rows: [category('c1'), category('c2')],
      });

      expect(closure.blockers).toEqual([
        {
          code: 'unledgeredTable',
          tableId: PRODUCTS,
          message: 'products is refused: it has no intact ledger lineage',
        },
      ]);
      expect(referrerReads).toHaveBeenCalledTimes(2);
    });
  });

  describe('a row of a table on one side only that references an id the target loses', () => {
    it.each<{
      operation: ChangeOperation;
      given: Given;
      selection: Selection;
      lost: string;
      because: string;
      remover: Record<string, unknown>;
    }>([
      {
        operation: 'revert',
        given: givenCreatedBrandOfCreatedCategory,
        selection: { rows: [category('c9')] },
        lost: 'c9',
        because:
          'brands/b1/category references categories/c9, which the reverted Draft loses; the value follows the structure of brands',
        remover: categoryRow('rowCreate', 'c9'),
      },
      {
        operation: 'commit',
        given: givenRemovedBrandOfDeletedCategory,
        selection: { rows: [category('c1')] },
        lost: 'c1',
        because:
          'brands/b1/category references categories/c1, which the new Head loses; the value follows the structure of brands',
        remover: categoryRow('rowDelete', 'c1'),
      },
    ])(
      'requires the structure of that table in a $operation',
      async ({ operation, given, selection, lost, because, remover }) => {
        const draft = await given(kit);

        const closure = await draft.closeDependencies(operation, selection);

        expect(closure.required).toEqual([
          {
            unit: brandsStructure,
            reason: {
              code: 'structureBoundData',
              because,
              site: referringField(BRANDS, 'b1', '/category'),
              references: referencedCategory(lost),
              cause: { unit: remover, role: 'remover' },
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
          rowRenames: [category('c2')],
        });

        expect(closure.required).toEqual([
          {
            unit: {
              kind: 'rowRename',
              tableId: CATEGORIES,
              rowId: 'c1',
              previousRowId: 'c2',
              selector: { rowRenames: [category('c1')] },
            },
            reason: {
              code: 'idOccupied',
              because: `categories/${rowId} would be held by two rows in the ${target}`,
              site: { kind: 'rowId', tableId: CATEGORIES, rowId },
              cause: { unit: categoryRename('c2', 'c1'), role: 'taker' },
            },
          },
        ]);
        expect(closure.blockers).toEqual([]);
      },
    );

    it('requires the deletion that vacated the id a committed rename takes, addressed on the Head side', async () => {
      const draft = await givenRenameIntoDeletedCategoryId(kit);

      const closure = await draft.closeDependencies('commit', {
        rowRenames: [category('c1')],
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
            because: 'categories/c1 would be held by two rows in the new Head',
            site: { kind: 'rowId', tableId: CATEGORIES, rowId: 'c1' },
            cause: { unit: categoryRename('c1', 'c2'), role: 'taker' },
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
          because:
            'products/p1/category references categories/c9, which exists only in the Draft',
          site: referringField(PRODUCTS, 'p1', '/category'),
          references: referencedCategory('c9'),
          cause: { unit: categoryOfProduct('p1'), role: 'referrer' },
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
      selection: { rowRenames: [category('c9')] },
    },
    {
      name: 'a Head-side deletion',
      operation: 'commit',
      given: givenRenameIntoDeletedCategoryId,
      selection: { rowRenames: [category('c1')] },
    },
    {
      name: 'the other half of a swap',
      operation: 'revert',
      given: givenSwappedCategoryIds,
      selection: { rowRenames: [category('c2')] },
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

async function givenRackOfDeletedCategory(
  kit: PartialChangesTestKit,
): Promise<ChangesScenario> {
  const draft = await ChangesScenario.committed(kit, {
    [CATEGORIES]: {
      schema: categorySchema,
      rows: { c1: { title: 'c1' }, c2: { title: 'c2' } },
    },
    [RACKS]: {
      schema: rackSchema,
      rows: {
        r1: { title: 'r1', slots: [{ category: 'c2' }, { category: 'c1' }] },
      },
    },
  });
  await draft.updateRow(RACKS, 'r1', {
    title: 'r1',
    slots: [{ category: 'c2' }],
  });
  await draft.removeRow(CATEGORIES, 'c1');

  return draft;
}

async function givenRenamedProductMovedToCreatedCategory(
  kit: PartialChangesTestKit,
): Promise<ChangesScenario> {
  const draft = await givenCatalogue(kit, ['c1'], { p1: 'c1' });
  await draft.createRows(CATEGORIES, { c9: { title: 'c9' } });
  await draft.renameRow(PRODUCTS, 'p1', 'p1x');
  await draft.updateRow(PRODUCTS, 'p1x', { title: 'p1', category: 'c9' });

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

async function repointProductsAcrossCategories(
  draft: ChangesScenario,
  product: ProductOf,
): Promise<void> {
  await draft.updateRow(PRODUCTS, 'p1', product('p1', 'c2'));
  await draft.removeRow(CATEGORIES, 'c1');
  await draft.createRows(CATEGORIES, { c3: { title: 'c3' } });
  await draft.createRows(PRODUCTS, { p2: product('p2', 'c3') });
}

async function committedProductsWithoutInit(
  kit: PartialChangesTestKit,
  products: Readonly<Record<string, string>> = { p1: 'c1' },
): Promise<ChangesScenario> {
  const draft = await ChangesScenario.committed(kit, {
    [CATEGORIES]: {
      schema: categorySchema,
      rows: { c1: { title: 'c1' }, c2: { title: 'c2' } },
    },
  });
  await draft.createTable(PRODUCTS, productSchema);
  await draft.createRows(
    PRODUCTS,
    Object.fromEntries(
      Object.entries(products).map(([rowId, categoryId]) => [
        rowId,
        { title: rowId, category: categoryId },
      ]),
    ),
  );
  await draft.dropFromDraftLedger('init', PRODUCTS);
  await draft.commit();

  return draft;
}

async function committedProductsMigratedInPlace(
  kit: PartialChangesTestKit,
): Promise<ChangesScenario> {
  const draft = await givenCatalogue(kit, ['c1', 'c2'], { p1: 'c1' });
  await completeAsyncMigrationInPlace(kit, draft, PRODUCTS, [
    addField('color', str()),
  ]);
  await draft.commit();

  return draft;
}
