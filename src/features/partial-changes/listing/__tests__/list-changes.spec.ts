import { arr, num, obj, str } from '@revisium/schema-toolkit/mocks';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import {
  UNIT_KINDS,
  type Unit,
  type UnitKind,
} from 'src/features/partial-changes/catalogue/unit';
import { ListingValidationError } from 'src/features/partial-changes/listing/listing-validation-error';
import type { ListedUnit } from 'src/features/partial-changes/queries/impl/list-draft-changes.query';
import { addField } from 'src/features/share/ledger-replay/__tests__/support/ledger-steps';
import type { TableViewsData } from 'src/features/views/types';
import {
  addressedUnitOfListed,
  unitsOfPages,
} from '../../__tests__/support/change-listing';
import { ChangesScenario } from '../../__tests__/support/changes-scenario';

const ADDRESS = 'address';
const CATEGORIES = 'categories';
const MEMOS = 'memos';
const NOTES = 'notes';
const ORDERS = 'orders';
const PURCHASES = 'purchases';
const PRODUCTS = 'products';
const SCRATCH = 'scratch';
const TAGS = 'tags';
const MIXED_CASE = 'Zebra';
const UNDERSCORED = '_mixed';
const LOWER_CASE = 'apple';

const NATIVE_IDS_IN_CODE_POINT_ORDER = ['-x', '9', 'A', 'B', '_x', 'a', 'b'];
const NON_ASCII_IDS_IN_CODE_POINT_ORDER = ['é', 'ё', '～', '😀'];
const FULL_PAGE = 5_000;
const UNITS_OF_EVERY_KIND = 22;

const categorySchema = obj({ title: str() });
const labelSchema = obj({ label: str() });
const productSchema = obj({ title: str(), price: num(), labels: arr(str()) });
const addressSchema = obj({ city: str() });
const productViews: TableViewsData = {
  version: 1,
  defaultViewId: 'default',
  views: [
    { id: 'default', name: 'Prices', columns: [{ field: 'data.price' }] },
  ],
};

const categoriesStructure: Unit = { kind: 'structure', tableId: CATEGORIES };
const notesStructure: Unit = {
  kind: 'structure',
  tableId: NOTES,
  previousTableId: MEMOS,
};
const purchasesStructure: Unit = {
  kind: 'structure',
  tableId: PURCHASES,
  previousTableId: ORDERS,
};

describe('listChanges', () => {
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

  describe('units', () => {
    it('lists every unit kind in listing order with public ids, the Head side of taken-over ids and the structure of the same table', async () => {
      const draft = await givenDraftWithEveryUnitKind();

      const page = await draft.listChanges();

      expect(page.units.map(withoutSelector)).toEqual([
        { kind: 'sharedSchema', tableId: ADDRESS },
        categoriesStructure,
        {
          kind: 'field',
          tableId: CATEGORIES,
          rowId: 'c1',
          path: '/title',
          structure: categoriesStructure,
        },
        {
          kind: 'rowCreate',
          tableId: CATEGORIES,
          rowId: 'c3',
          structure: categoriesStructure,
        },
        { kind: 'structure', tableId: NOTES, side: 'head' },
        notesStructure,
        {
          kind: 'field',
          tableId: NOTES,
          rowId: 'm1',
          path: '/label',
          structure: notesStructure,
        },
        { kind: 'views', tableId: PRODUCTS },
        { kind: 'field', tableId: PRODUCTS, rowId: 'p1', path: '/title' },
        { kind: 'field', tableId: PRODUCTS, rowId: 'p2', path: '/labels' },
        { kind: 'field', tableId: PRODUCTS, rowId: 'p30', path: '/price' },
        {
          kind: 'rowRename',
          tableId: PRODUCTS,
          rowId: 'p30',
          previousRowId: 'p3',
        },
        { kind: 'rowDelete', tableId: PRODUCTS, rowId: 'p4', side: 'head' },
        {
          kind: 'rowRename',
          tableId: PRODUCTS,
          rowId: 'p4',
          previousRowId: 'p5',
        },
        { kind: 'rowReplace', tableId: PRODUCTS, rowId: 'p6' },
        { kind: 'rowCreate', tableId: PRODUCTS, rowId: 'p7' },
        { kind: 'rowDelete', tableId: PRODUCTS, rowId: 'p8' },
        {
          kind: 'rowColumns',
          tableId: PRODUCTS,
          rowId: 'p9',
          columns: ['meta'],
        },
        purchasesStructure,
        {
          kind: 'field',
          tableId: PURCHASES,
          rowId: 'o1',
          path: '/label',
          structure: purchasesStructure,
        },
        { kind: 'structure', tableId: SCRATCH },
        { kind: 'structure', tableId: TAGS },
      ]);
      expect(page.nextCursor).toBeNull();
    });

    it('gives every unit the selector of its kind', async () => {
      const draft = await givenDraftWithEveryUnitKind();

      const page = await draft.listChanges();

      expect(page.units.map(({ selector }) => selector)).toEqual([
        { sharedSchemas: [ADDRESS] },
        { tables: [CATEGORIES] },
        { fields: [{ tableId: CATEGORIES, rowId: 'c1', path: '/title' }] },
        { rows: [{ tableId: CATEGORIES, rowId: 'c3' }] },
        { tables: [{ tableId: NOTES, side: 'head' }] },
        { tables: [NOTES] },
        { fields: [{ tableId: NOTES, rowId: 'm1', path: '/label' }] },
        { views: [PRODUCTS] },
        { fields: [{ tableId: PRODUCTS, rowId: 'p1', path: '/title' }] },
        { fields: [{ tableId: PRODUCTS, rowId: 'p2', path: '/labels' }] },
        { fields: [{ tableId: PRODUCTS, rowId: 'p30', path: '/price' }] },
        { renames: [{ tableId: PRODUCTS, rowId: 'p30' }] },
        { rows: [{ tableId: PRODUCTS, rowId: 'p4', side: 'head' }] },
        { renames: [{ tableId: PRODUCTS, rowId: 'p4' }] },
        { rows: [{ tableId: PRODUCTS, rowId: 'p6' }] },
        { rows: [{ tableId: PRODUCTS, rowId: 'p7' }] },
        { rows: [{ tableId: PRODUCTS, rowId: 'p8' }] },
        { rowColumns: [{ tableId: PRODUCTS, rowId: 'p9' }] },
        { tables: [PURCHASES] },
        { fields: [{ tableId: PURCHASES, rowId: 'o1', path: '/label' }] },
        { tables: [SCRATCH] },
        { tables: [TAGS] },
      ]);
    });

    it('lists selectors that each resolve to exactly their unit, with no required unit, blocker or unmatched selector', async () => {
      const draft = await givenDraftWithEveryUnitKind();

      const { units } = await draft.listChanges();

      expect(kindsOf(units)).toEqual(new Set(UNIT_KINDS));

      for (const unit of units) {
        await expect(draft.resolveSelection(unit.selector)).resolves.toEqual({
          selected: [addressedUnitOfListed(unit)],
          excluded: [],
          required: [],
          blockers: [],
          unmatched: {},
        });
      }
    });

    it('lists the units of a Draft whose ledger is inconsistent, with no status', async () => {
      const draft = await ChangesScenario.committed(kit, {
        [PRODUCTS]: { schema: categorySchema, rows: { p1: { title: 'one' } } },
      });
      await draft.rewriteSchemaHistory(PRODUCTS, []);

      const page = await draft.listChanges();

      expect(page).toEqual({
        headRevisionId: await draft.revisionId('head'),
        draftRevisionId: await draft.revisionId('draft'),
        units: [
          {
            kind: 'structure',
            tableId: PRODUCTS,
            selector: { tables: [PRODUCTS] },
          },
        ],
        nextCursor: null,
        refusedTables: [],
      });
    });
  });

  describe('paging', () => {
    it.each([1, 2, 7])(
      'returns with pages of %i units the units of one full page',
      async (pageSize) => {
        const draft = await givenDraftWithEveryUnitKind();
        const fullPage = await draft.listChanges({ pageSize: FULL_PAGE });

        const pages = await draft.listEveryPage({ pageSize });

        expect(fullPage.units).toHaveLength(UNITS_OF_EVERY_KIND);
        expect(unitsOfPages(pages)).toEqual(fullPage.units);
        expect(pages.every(({ units }) => units.length <= pageSize)).toBe(true);
      },
    );

    it.each([1, FULL_PAGE])(
      'orders table and row ids by code point, in SQL keysets as in the listing comparator, with pages of %i units',
      async (pageSize) => {
        const draft = await givenTablesAndRowsWithMixedIds();

        const units = unitsOfPages(await draft.listEveryPage({ pageSize }));

        expect(units.map(({ tableId, rowId }) => [tableId, rowId])).toEqual([
          [MIXED_CASE, 'z1'],
          [UNDERSCORED, 'u1'],
          ...[
            ...NATIVE_IDS_IN_CODE_POINT_ORDER,
            ...NON_ASCII_IDS_IN_CODE_POINT_ORDER,
          ].map((rowId) => [LOWER_CASE, rowId]),
        ]);
      },
    );

    it('continues a row whose units do not fit on the next page', async () => {
      const draft = await givenRowWithMoreUnitsThanAPage();

      const pages = await draft.listEveryPage({ pageSize: 4 });

      expect(pages.map(({ units }) => units.map(describeUnit))).toEqual([
        ['p0 field /a', 'p0 field /b', 'p0 field /c', 'p0 field /d'],
        ['p0 rowColumns', 'p0 rowRename', 'p2 field /a'],
      ]);
    });

    it('returns every refused table on every page and lists none of its units', async () => {
      const draft = await givenUnledgeredProductsNextToEditedCategories();

      const pages = await draft.listEveryPage({ pageSize: 1 });

      expect(pages.map(({ refusedTables }) => refusedTables)).toEqual([
        [{ tableId: PRODUCTS, code: 'unledgeredTable' }],
        [{ tableId: PRODUCTS, code: 'unledgeredTable' }],
      ]);
      expect(unitsOfPages(pages).map(describeUnit)).toEqual([
        'c1 field /title',
      ]);
    });
  });

  describe('tableId', () => {
    it('lists only the units of the table with that Draft id', async () => {
      const draft = await givenDraftWithEveryUnitKind();

      const page = await draft.listChanges({ tableId: CATEGORIES });

      expect(page.units.map(describeUnit)).toEqual([
        'categories structure',
        'c1 field /title',
        'c3 rowCreate',
      ]);
    });

    it('lists the units of a renamed table by its Head id', async () => {
      const draft = await givenDraftWithEveryUnitKind();

      const page = await draft.listChanges({ tableId: ORDERS });

      expect(page.units.map(withoutSelector)).toEqual([
        purchasesStructure,
        {
          kind: 'field',
          tableId: PURCHASES,
          rowId: 'o1',
          path: '/label',
          structure: purchasesStructure,
        },
      ]);
    });

    it('refuses an id that names no Head or Draft table', async () => {
      const draft = await givenOneEditedCategory();

      await expect(draft.listChanges({ tableId: 'missing' })).rejects.toThrow(
        ListingValidationError,
      );
    });
  });

  describe('input', () => {
    it.each([0, 5_001, 1.5])('refuses pageSize %s', async (pageSize) => {
      const draft = await givenOneEditedCategory();

      await expect(draft.listChanges({ pageSize })).rejects.toThrow(
        ListingValidationError,
      );
    });

    it.each(['not a cursor', '', 'eyJ2Ijo'])(
      'refuses the malformed cursor %p',
      async (cursor) => {
        const draft = await givenOneEditedCategory();

        await expect(draft.listChanges({ cursor })).rejects.toThrow(
          ListingValidationError,
        );
      },
    );
  });

  async function givenDraftWithEveryUnitKind(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [CATEGORIES]: {
        schema: categorySchema,
        rows: { c1: { title: 'one' }, c2: { title: 'two' } },
      },
      [MEMOS]: { schema: labelSchema, rows: { m1: { label: 'one' } } },
      [NOTES]: { schema: labelSchema, rows: { n1: { label: 'one' } } },
      [ORDERS]: { schema: labelSchema, rows: { o1: { label: 'one' } } },
      [PRODUCTS]: { schema: productSchema, rows: productRows() },
    });
    await draft.updateTable(CATEGORIES, [addField('color', str())]);
    await draft.updateRow(CATEGORIES, 'c1', { title: 'edited', color: 'red' });
    await draft.createRows(CATEGORIES, {
      c3: { title: 'three', color: 'blue' },
    });
    await draft.removeTable(NOTES);
    await draft.renameTable(MEMOS, NOTES);
    await draft.updateRow(NOTES, 'm1', { label: 'edited' });
    await draft.renameTable(ORDERS, PURCHASES);
    await draft.updateRow(PURCHASES, 'o1', { label: 'edited' });
    await draft.createTable(TAGS, labelSchema);
    await draft.createRows(TAGS, { t1: { label: 'one' } });
    await draft.createTable(SCRATCH, labelSchema);
    await draft.removeTable(SCRATCH);
    await draft.createSharedSchema(ADDRESS, addressSchema);
    await draft.updateViews(PRODUCTS, productViews);
    await editEveryRowOfProducts(draft);

    return draft;
  }

  async function editEveryRowOfProducts(draft: ChangesScenario): Promise<void> {
    await draft.updateRow(PRODUCTS, 'p1', product('edited'));
    await draft.updateRow(PRODUCTS, 'p2', product('p2', 1, ['edited']));
    await draft.renameRow(PRODUCTS, 'p3', 'p30');
    await draft.updateRow(PRODUCTS, 'p30', product('p3', 30));
    await draft.removeRow(PRODUCTS, 'p4');
    await draft.renameRow(PRODUCTS, 'p5', 'p4');
    await draft.removeRow(PRODUCTS, 'p6');
    await draft.createRows(PRODUCTS, { p6: product('reused') });
    await draft.createRows(PRODUCTS, { p7: product('p7') });
    await draft.removeRow(PRODUCTS, 'p8');
    await draft.writeRowColumns(PRODUCTS, 'p9', { meta: { note: 'checked' } });
  }

  async function givenTablesAndRowsWithMixedIds(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [LOWER_CASE]: { schema: labelSchema },
      [UNDERSCORED]: { schema: labelSchema, rows: { u1: { label: 'one' } } },
      [MIXED_CASE]: { schema: labelSchema, rows: { z1: { label: 'one' } } },
    });
    await draft.updateRow(UNDERSCORED, 'u1', { label: 'edited' });
    await draft.updateRow(MIXED_CASE, 'z1', { label: 'edited' });
    await draft.createRows(
      LOWER_CASE,
      labelRows(NATIVE_IDS_IN_CODE_POINT_ORDER),
    );
    await givenRowsWithNonAsciiIds(draft);

    return draft;
  }

  async function givenRowsWithNonAsciiIds(
    draft: ChangesScenario,
  ): Promise<void> {
    const renames = NON_ASCII_IDS_IN_CODE_POINT_ORDER.map((rowId, index) => ({
      createdId: `created-${index}`,
      rowId,
    }));
    await draft.createRows(
      LOWER_CASE,
      labelRows(renames.map(({ createdId }) => createdId)),
    );

    for (const { createdId, rowId } of renames) {
      await draft.renameDraftRowBelowNativeValidation(
        LOWER_CASE,
        createdId,
        rowId,
      );
    }
  }

  async function givenRowWithMoreUnitsThanAPage(): Promise<ChangesScenario> {
    const letters = { a: 'one', b: 'one', c: 'one', d: 'one' };
    const draft = await ChangesScenario.committed(kit, {
      [PRODUCTS]: {
        schema: obj({ a: str(), b: str(), c: str(), d: str() }),
        rows: { p1: letters, p2: letters },
      },
    });
    await draft.updateRow(PRODUCTS, 'p1', { a: 'x', b: 'x', c: 'x', d: 'x' });
    await draft.renameRow(PRODUCTS, 'p1', 'p0');
    await draft.writeRowColumns(PRODUCTS, 'p0', { meta: { note: 'checked' } });
    await draft.updateRow(PRODUCTS, 'p2', { ...letters, a: 'x' });

    return draft;
  }

  async function givenUnledgeredProductsNextToEditedCategories(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [CATEGORIES]: { schema: categorySchema, rows: { c1: { title: 'one' } } },
    });
    await draft.createTable(PRODUCTS, categorySchema);
    await draft.createRows(PRODUCTS, { p1: { title: 'one' } });
    await draft.dropFromDraftLedger('init', PRODUCTS);
    await draft.commit();
    await draft.updateRow(PRODUCTS, 'p1', { title: 'edited' });
    await draft.updateRow(CATEGORIES, 'c1', { title: 'edited' });

    return draft;
  }

  async function givenOneEditedCategory(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [CATEGORIES]: { schema: categorySchema, rows: { c1: { title: 'one' } } },
    });
    await draft.updateRow(CATEGORIES, 'c1', { title: 'edited' });

    return draft;
  }
});

function withoutSelector(listed: ListedUnit): Omit<ListedUnit, 'selector'> {
  const { structure } = listed;

  if (structure === undefined) {
    return addressedUnitOfListed(listed);
  }

  return { ...addressedUnitOfListed(listed), structure };
}

function describeUnit({ kind, tableId, rowId, path }: ListedUnit): string {
  return [rowId ?? tableId, kind, path].filter(Boolean).join(' ');
}

function kindsOf(units: readonly ListedUnit[]): Set<UnitKind> {
  return new Set(units.map(({ kind }) => kind));
}

function productRows() {
  return Object.fromEntries(
    ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p8', 'p9'].map((rowId) => [
      rowId,
      product(rowId),
    ]),
  );
}

function product(title: string, price = 1, labels: string[] = []) {
  return { title, price, labels };
}

function labelRows(rowIds: readonly string[]) {
  return Object.fromEntries(rowIds.map((rowId) => [rowId, { label: rowId }]));
}
