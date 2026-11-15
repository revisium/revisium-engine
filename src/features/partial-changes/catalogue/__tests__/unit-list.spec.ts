import { arr, num, obj, str } from '@revisium/schema-toolkit/mocks';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import {
  type SelectorSide,
  UNIT_KINDS,
  type Unit,
  type UnitKind,
} from 'src/features/partial-changes/catalogue/unit';
import type { DescribedUnitRef } from 'src/features/partial-changes/selection/unit-refs';
import { addField } from 'src/__tests__/fixtures/ledger-steps';
import type { TableViewsData } from 'src/features/views/types';
import { addressedUnitOfListed } from '../../__tests__/support/change-listing';
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

describe('units of the change catalogue', () => {
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

  it('holds every unit kind in unit order with exactly the public fields of its kind and the Head side of taken-over ids (AS-80)', async () => {
    const draft = await givenDraftWithEveryUnitKind();

    const { units } = await draft.readUnitList();

    expect(units.map(withoutSelector)).toStrictEqual([
      { kind: 'sharedSchema', sharedSchemaId: ADDRESS },
      { kind: 'structure', tableId: CATEGORIES },
      { kind: 'field', tableId: CATEGORIES, rowId: 'c1', path: '/title' },
      { kind: 'rowCreate', tableId: CATEGORIES, rowId: 'c3' },
      { kind: 'structure', tableId: NOTES, side: 'head' },
      { kind: 'structure', tableId: NOTES, previousTableId: MEMOS },
      { kind: 'field', tableId: NOTES, rowId: 'm1', path: '/label' },
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
      { kind: 'structure', tableId: PURCHASES, previousTableId: ORDERS },
      { kind: 'field', tableId: PURCHASES, rowId: 'o1', path: '/label' },
      { kind: 'structure', tableId: SCRATCH },
      { kind: 'structure', tableId: TAGS },
    ]);
  });

  it('gives every unit the selector of its kind', async () => {
    const draft = await givenDraftWithEveryUnitKind();

    const { units } = await draft.readUnitList();

    expect(units.map(({ selector }) => selector)).toEqual([
      { sharedSchemas: [ADDRESS] },
      { structures: [{ tableId: CATEGORIES }] },
      { fields: [{ tableId: CATEGORIES, rowId: 'c1', path: '/title' }] },
      { rows: [{ tableId: CATEGORIES, rowId: 'c3' }] },
      { structures: [{ tableId: NOTES, side: 'head' }] },
      { structures: [{ tableId: NOTES }] },
      { fields: [{ tableId: NOTES, rowId: 'm1', path: '/label' }] },
      { views: [PRODUCTS] },
      { fields: [{ tableId: PRODUCTS, rowId: 'p1', path: '/title' }] },
      { fields: [{ tableId: PRODUCTS, rowId: 'p2', path: '/labels' }] },
      { fields: [{ tableId: PRODUCTS, rowId: 'p30', path: '/price' }] },
      { rowRenames: [{ tableId: PRODUCTS, rowId: 'p30' }] },
      { rows: [{ tableId: PRODUCTS, rowId: 'p4', side: 'head' }] },
      { rowRenames: [{ tableId: PRODUCTS, rowId: 'p4' }] },
      { rows: [{ tableId: PRODUCTS, rowId: 'p6' }] },
      { rows: [{ tableId: PRODUCTS, rowId: 'p7' }] },
      { rows: [{ tableId: PRODUCTS, rowId: 'p8' }] },
      { rowColumns: [{ tableId: PRODUCTS, rowId: 'p9' }] },
      { structures: [{ tableId: PURCHASES }] },
      { fields: [{ tableId: PURCHASES, rowId: 'o1', path: '/label' }] },
      { structures: [{ tableId: SCRATCH }] },
      { structures: [{ tableId: TAGS }] },
    ]);
  });

  it('gives selectors that each resolve to exactly their unit, with no required unit, blocker or unmatched selector', async () => {
    const draft = await givenDraftWithEveryUnitKind();

    const { units } = await draft.readUnitList();

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

  it('orders table and row ids by code point', async () => {
    const draft = await givenTablesAndRowsWithMixedIds();

    const { units } = await draft.readUnitList();

    expect(
      units
        .map(addressedUnitOfListed)
        .map(({ tableId, rowId }) => [tableId, rowId]),
    ).toEqual([
      [MIXED_CASE, 'z1'],
      [UNDERSCORED, 'u1'],
      ...[
        ...NATIVE_IDS_IN_CODE_POINT_ORDER,
        ...NON_ASCII_IDS_IN_CODE_POINT_ORDER,
      ].map((rowId) => [LOWER_CASE, rowId]),
    ]);
  });

  it('holds the units of a Draft whose ledger is inconsistent', async () => {
    const draft = await ChangesScenario.committed(kit, {
      [PRODUCTS]: { schema: categorySchema, rows: { p1: { title: 'one' } } },
    });
    await draft.rewriteSchemaHistory(PRODUCTS, []);

    const unitList = await draft.readUnitList();

    expect(unitList).toEqual({
      headRevisionId: await draft.revisionId('head'),
      draftRevisionId: await draft.revisionId('draft'),
      units: [
        {
          kind: 'structure',
          tableId: PRODUCTS,
          selector: { structures: [{ tableId: PRODUCTS }] },
          structureChange: { table: 'changed', fields: [], views: false },
        },
      ],
      refusedTables: [],
    });
  });

  it('holds no unit of a refused table, and names the table', async () => {
    const draft = await givenUnledgeredProductsNextToEditedCategories();

    const unitList = await draft.readUnitList();

    expect(unitList.refusedTables).toEqual([
      { tableId: PRODUCTS, code: 'unledgeredTable' },
    ]);
    expect(unitList.units.map(describeUnit)).toEqual(['c1 field /title']);
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
});

type SidedUnit = Unit & { readonly side?: SelectorSide };

function withoutSelector({
  selector: _selector,
  structureChange: _structureChange,
  ...unit
}: DescribedUnitRef): SidedUnit {
  return unit;
}

function describeUnit(unit: DescribedUnitRef): string {
  const { kind } = unit;
  const { tableId, rowId, path } = addressedUnitOfListed(unit);

  return [rowId ?? tableId, kind, path].filter(Boolean).join(' ');
}

function kindsOf(units: readonly DescribedUnitRef[]): Set<UnitKind> {
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
