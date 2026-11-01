import { num, obj, str } from '@revisium/schema-toolkit/mocks';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import type { Selection } from 'src/features/partial-changes/selection/selection';
import type { TableViewsData } from 'src/features/views/types';
import type { AddressedUnit } from '../../__tests__/support/catalogue-reading';
import { ChangesScenario } from '../../__tests__/support/changes-scenario';
import type { ResolutionView } from '../../__tests__/support/selection-resolving';

const PRODUCTS = 'products';
const CATEGORIES = 'categories';
const GROUPS = 'groups';
const TAGS = 'tags';
const IMPORTS = 'imports';
const ADDRESS = 'address';

const productSchema = obj({ code: str(), price: num() });
const categorySchema = obj({ title: str() });
const tagSchema = obj({ label: str() });
const addressSchema = obj({ city: str() });

const categoryViews: TableViewsData = {
  version: 1,
  defaultViewId: 'default',
  views: [{ id: 'default', name: 'All', columns: [{ field: 'data.title' }] }],
};

const deletedP2: AddressedUnit = {
  kind: 'rowDelete',
  tableId: PRODUCTS,
  rowId: 'p2',
};
const createdP3: AddressedUnit = {
  kind: 'rowCreate',
  tableId: PRODUCTS,
  rowId: 'p3',
};
const codeOfP9: AddressedUnit = {
  kind: 'field',
  tableId: PRODUCTS,
  rowId: 'p9',
  path: '/code',
};
const metaOfP9: AddressedUnit = {
  kind: 'rowColumns',
  tableId: PRODUCTS,
  rowId: 'p9',
  columns: ['meta'],
};
const renameOfP1: AddressedUnit = {
  kind: 'rowRename',
  tableId: PRODUCTS,
  rowId: 'p9',
  previousRowId: 'p1',
};
const createdTags: AddressedUnit = { kind: 'structure', tableId: TAGS };
const categoryViewsEdit: AddressedUnit = { kind: 'views', tableId: CATEGORIES };
const addressSchemaEdit: AddressedUnit = {
  kind: 'sharedSchema',
  tableId: ADDRESS,
};

describe('SelectionResolver: selection fields and id resolution', () => {
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

  it.each<{ field: string; selection: Selection; units: AddressedUnit[] }>([
    {
      field: 'tables',
      selection: { tables: [TAGS] },
      units: [createdTags],
    },
    {
      field: 'tableData',
      selection: { tableData: [PRODUCTS] },
      units: [deletedP2, createdP3, codeOfP9, metaOfP9, renameOfP1],
    },
    {
      field: 'views',
      selection: { views: [CATEGORIES] },
      units: [categoryViewsEdit],
    },
    {
      field: 'sharedSchemas',
      selection: { sharedSchemas: [ADDRESS] },
      units: [addressSchemaEdit],
    },
    {
      field: 'rows',
      selection: { rows: [{ tableId: PRODUCTS, rowId: 'p9' }] },
      units: [codeOfP9, metaOfP9, renameOfP1],
    },
    {
      field: 'renames',
      selection: { renames: [{ tableId: PRODUCTS, rowId: 'p9' }] },
      units: [renameOfP1],
    },
    {
      field: 'rowColumns',
      selection: { rowColumns: [{ tableId: PRODUCTS, rowId: 'p9' }] },
      units: [metaOfP9],
    },
    {
      field: 'fields',
      selection: {
        fields: [{ tableId: PRODUCTS, rowId: 'p9', path: '/code' }],
      },
      units: [codeOfP9],
    },
    {
      field: 'all',
      selection: { all: true },
      units: [
        addressSchemaEdit,
        categoryViewsEdit,
        deletedP2,
        createdP3,
        codeOfP9,
        metaOfP9,
        renameOfP1,
        createdTags,
      ],
    },
  ])(
    'selects through $field exactly its units',
    async ({ selection, units }) => {
      const draft = await givenDraftWithEveryUnitKind();

      const resolution = await draft.resolveSelection(selection);

      expectSelectedAlone(resolution, units);
    },
  );

  it.each<{
    rowId: string;
    edit: (draft: ChangesScenario) => Promise<void>;
    selection: Selection;
    units: AddressedUnit[];
  }>([
    {
      rowId: 'the Head id of a renamed row',
      edit: (draft) => draft.renameRow(PRODUCTS, 'p1', 'p9'),
      selection: { rows: [{ tableId: PRODUCTS, rowId: 'p1' }] },
      units: [renameOfP1],
    },
    {
      rowId: 'an id a rename took over, as the Draft row',
      edit: takeOverIdOfDeletedRow,
      selection: { rows: [{ tableId: PRODUCTS, rowId: 'p1' }] },
      units: [
        {
          kind: 'rowRename',
          tableId: PRODUCTS,
          rowId: 'p1',
          previousRowId: 'p2',
        },
      ],
    },
    {
      rowId: "an id a rename took over, with side: 'head' as the deleted row",
      edit: takeOverIdOfDeletedRow,
      selection: { rows: [{ tableId: PRODUCTS, rowId: 'p1', side: 'head' }] },
      units: [
        { kind: 'rowDelete', tableId: PRODUCTS, rowId: 'p1', side: 'head' },
      ],
    },
  ])('resolves $rowId', async ({ edit, selection, units }) => {
    const draft = await givenCommittedCatalog();
    await edit(draft);

    const resolution = await draft.resolveSelection(selection);

    expectSelectedAlone(resolution, units);
  });

  it.each<{
    tableId: string;
    edit: (draft: ChangesScenario) => Promise<void>;
    selection: Selection;
    units: AddressedUnit[];
  }>([
    {
      tableId: 'the Draft id of a renamed table',
      edit: (draft) => draft.renameTable(CATEGORIES, GROUPS),
      selection: { tables: [GROUPS] },
      units: [
        { kind: 'structure', tableId: GROUPS, previousTableId: CATEGORIES },
      ],
    },
    {
      tableId: 'the Head id of a renamed table',
      edit: (draft) => draft.renameTable(CATEGORIES, GROUPS),
      selection: { tables: [CATEGORIES] },
      units: [
        { kind: 'structure', tableId: GROUPS, previousTableId: CATEGORIES },
      ],
    },
    {
      tableId: 'an id a rename took over, as the Draft table',
      edit: takeOverIdOfRemovedTable,
      selection: { tables: [CATEGORIES] },
      units: [
        { kind: 'structure', tableId: CATEGORIES, previousTableId: PRODUCTS },
      ],
    },
    {
      tableId:
        "an id a rename took over, with side: 'head' as the removed table",
      edit: takeOverIdOfRemovedTable,
      selection: { tables: [{ tableId: CATEGORIES, side: 'head' }] },
      units: [{ kind: 'structure', tableId: CATEGORIES, side: 'head' }],
    },
    {
      tableId: 'the id of a table created and removed inside the Draft',
      edit: async (draft) => {
        await draft.createTable(IMPORTS, tagSchema);
        await draft.removeTable(IMPORTS);
      },
      selection: { tables: [IMPORTS] },
      units: [{ kind: 'structure', tableId: IMPORTS }],
    },
  ])('resolves $tableId', async ({ edit, selection, units }) => {
    const draft = await givenCommittedCatalog();
    await edit(draft);

    const resolution = await draft.resolveSelection(selection);

    expectSelectedAlone(resolution, units);
  });

  function expectSelectedAlone(
    resolution: ResolutionView,
    units: AddressedUnit[],
  ): void {
    expect(resolution).toEqual({
      selected: units,
      excluded: [],
      required: [],
      blockers: [],
      unmatched: {},
    });
  }

  function givenCommittedCatalog(): Promise<ChangesScenario> {
    return ChangesScenario.committed(kit, {
      [PRODUCTS]: {
        schema: productSchema,
        rows: { p1: product('one'), p2: product('two') },
      },
      [CATEGORIES]: {
        schema: categorySchema,
        rows: { c1: { title: 'first' } },
      },
    });
  }

  async function givenDraftWithEveryUnitKind(): Promise<ChangesScenario> {
    const draft = await givenCommittedCatalog();
    await draft.renameRow(PRODUCTS, 'p1', 'p9');
    await draft.updateRow(PRODUCTS, 'p9', product('edited'));
    await draft.writeRowColumns(PRODUCTS, 'p9', { meta: { note: 'checked' } });
    await draft.removeRow(PRODUCTS, 'p2');
    await draft.createRows(PRODUCTS, { p3: product('three') });
    await draft.updateViews(CATEGORIES, categoryViews);
    await draft.createTable(TAGS, tagSchema);
    await draft.createSharedSchema(ADDRESS, addressSchema);

    return draft;
  }

  async function takeOverIdOfDeletedRow(draft: ChangesScenario): Promise<void> {
    await draft.removeRow(PRODUCTS, 'p1');
    await draft.renameRow(PRODUCTS, 'p2', 'p1');
  }

  async function takeOverIdOfRemovedTable(
    draft: ChangesScenario,
  ): Promise<void> {
    await draft.removeTable(CATEGORIES);
    await draft.renameTable(PRODUCTS, CATEGORIES);
  }
});

function product(code: string) {
  return { code, price: 1 };
}
