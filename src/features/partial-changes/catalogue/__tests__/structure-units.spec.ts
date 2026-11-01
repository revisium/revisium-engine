import { num, obj, str } from '@revisium/schema-toolkit/mocks';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import {
  addField,
  removeField,
} from 'src/features/share/ledger-replay/__tests__/support/ledger-steps';
import type { TableViewsData } from 'src/features/views/types';
import type { AddressedUnit } from '../../__tests__/support/catalogue-reading';
import { ChangesScenario } from '../../__tests__/support/changes-scenario';
import { expectEveryDifferenceOwnedOnce } from '../../__tests__/support/column-ownership';

const PRODUCTS = 'products';
const CATEGORIES = 'categories';
const GROUPS = 'groups';
const TAGS = 'tags';
const IMPORTS = 'imports';
const STAGING = 'staging';
const SWAPPING = 'swapping';
const TEMPORARY = 'tmp';

const productSchema = obj({ code: str(), price: num() });
const categorySchema = obj({ title: str() });
const tagSchema = obj({ label: str() });

const categoryViews: TableViewsData = {
  version: 1,
  defaultViewId: 'default',
  views: [{ id: 'default', name: 'All', columns: [{ field: 'data.title' }] }],
};

describe('ChangeCatalogue: structure units', () => {
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

  it.each<{
    change: string;
    edit: (draft: ChangesScenario) => Promise<void>;
    units: AddressedUnit[];
  }>([
    {
      change: 'a created table',
      edit: async (draft) => {
        await draft.createTable(TAGS, tagSchema);
        await draft.createRows(TAGS, { t1: { label: 'one' } });
      },
      units: [{ kind: 'structure', tableId: TAGS }],
    },
    {
      change: 'a removed table',
      edit: (draft) => draft.removeTable(CATEGORIES),
      units: [{ kind: 'structure', tableId: CATEGORIES }],
    },
    {
      change: 'a renamed table',
      edit: (draft) => draft.renameTable(CATEGORIES, GROUPS),
      units: [
        { kind: 'structure', tableId: GROUPS, previousTableId: CATEGORIES },
      ],
    },
    {
      change: 'a swap of two table ids through a temporary id',
      edit: async (draft) => {
        await draft.renameTable(PRODUCTS, SWAPPING);
        await draft.renameTable(CATEGORIES, PRODUCTS);
        await draft.renameTable(SWAPPING, CATEGORIES);
      },
      units: [
        { kind: 'structure', tableId: CATEGORIES, previousTableId: PRODUCTS },
        { kind: 'structure', tableId: PRODUCTS, previousTableId: CATEGORIES },
      ],
    },
    {
      change: 'a rename into the id of a removed table',
      edit: async (draft) => {
        await draft.removeTable(CATEGORIES);
        await draft.renameTable(PRODUCTS, CATEGORIES);
      },
      units: [
        { kind: 'structure', tableId: CATEGORIES, side: 'head' },
        { kind: 'structure', tableId: CATEGORIES, previousTableId: PRODUCTS },
      ],
    },
    {
      change: 'a schema change',
      edit: (draft) => draft.updateTable(PRODUCTS, [addField('color', str())]),
      units: [{ kind: 'structure', tableId: PRODUCTS }],
    },
    {
      change: 'a schema history change that leaves the schema as in Head',
      edit: async (draft) => {
        await draft.updateTable(PRODUCTS, [addField('color', str())]);
        await draft.updateTable(PRODUCTS, [removeField('color')]);
      },
      units: [{ kind: 'structure', tableId: PRODUCTS }],
    },
    {
      change: 'a removed table whose id was created again',
      edit: async (draft) => {
        await draft.removeTable(CATEGORIES);
        await draft.createTable(CATEGORIES, tagSchema);
      },
      units: [{ kind: 'structure', tableId: CATEGORIES }],
    },
    {
      change: 'a table created and removed inside the Draft',
      edit: async (draft) => {
        await draft.createTable(IMPORTS, tagSchema);
        await draft.removeTable(IMPORTS);
      },
      units: [{ kind: 'structure', tableId: IMPORTS }],
    },
    {
      change:
        'two tables created and removed inside the Draft that used one id',
      edit: async (draft) => {
        await draft.createTable(IMPORTS, tagSchema);
        await draft.renameTable(IMPORTS, STAGING);
        await draft.removeTable(STAGING);
        await draft.createTable(STAGING, categorySchema);
        await draft.removeTable(STAGING);
      },
      units: [{ kind: 'structure', tableId: IMPORTS }],
    },
    {
      change:
        'a table created and removed inside the Draft at the id a renamed table left',
      edit: async (draft) => {
        await draft.renameTable(CATEGORIES, GROUPS);
        await draft.createTable(CATEGORIES, tagSchema);
        await draft.removeTable(CATEGORIES);
      },
      units: [
        { kind: 'structure', tableId: GROUPS, previousTableId: CATEGORIES },
      ],
    },
    {
      change:
        'a table created and removed inside the Draft at an id a renamed table passed through',
      edit: async (draft) => {
        await draft.renameTable(CATEGORIES, TEMPORARY);
        await draft.renameTable(TEMPORARY, GROUPS);
        await draft.createTable(TEMPORARY, tagSchema);
        await draft.removeTable(TEMPORARY);
      },
      units: [
        { kind: 'structure', tableId: GROUPS, previousTableId: CATEGORIES },
      ],
    },
    {
      change:
        'a table created and removed inside the Draft at the id of a created table',
      edit: async (draft) => {
        await draft.createTable(TAGS, categorySchema);
        await draft.removeTable(TAGS);
        await draft.createTable(TAGS, tagSchema);
      },
      units: [{ kind: 'structure', tableId: TAGS }],
    },
  ])(
    'lists one structure unit per table identity for $change',
    async ({ edit, units }) => {
      const draft = await givenCommittedCatalog();
      await edit(draft);

      const catalogue = await draft.readCatalogue([PRODUCTS, CATEGORIES]);

      expect(catalogue.units()).toEqual(units);
      expect(catalogue.ledgerInconsistencies).toEqual([]);
      expectEveryDifferenceOwnedOnce(catalogue);
    },
  );

  it('records the schema rows, views rows and pending migrations its structure unit owns', async () => {
    const draft = await givenCommittedCatalog();
    await draft.updateViews(CATEGORIES, categoryViews);
    await draft.commit();
    await draft.renameTable(CATEGORIES, GROUPS);

    const catalogue = await draft.readCatalogue([]);

    expect(
      catalogue.systemRowsOf({
        kind: 'structure',
        tableId: GROUPS,
        previousTableId: CATEGORIES,
      }),
    ).toEqual([
      'migration rename categories to groups',
      'schema categories',
      'schema groups',
      'views categories',
      'views groups',
    ]);
  });

  it('records the migrations of a table created and removed at its former id in the structure unit of a renamed table', async () => {
    const draft = await givenCommittedCatalog();
    await draft.renameTable(CATEGORIES, GROUPS);
    await draft.createTable(CATEGORIES, tagSchema);
    await draft.removeTable(CATEGORIES);

    const catalogue = await draft.readCatalogue([]);

    expect(
      catalogue.systemRowsOf({
        kind: 'structure',
        tableId: GROUPS,
        previousTableId: CATEGORIES,
      }),
    ).toEqual([
      'migration init categories',
      'migration remove categories',
      'migration rename categories to groups',
      'schema categories',
      'schema groups',
    ]);
  });

  it('records the migrations of a table created and removed at an id a renamed table later passed through in the structure unit of the renamed table', async () => {
    const draft = await givenCommittedCatalog();
    await draft.createTable(TEMPORARY, tagSchema);
    await draft.removeTable(TEMPORARY);
    await draft.renameTable(CATEGORIES, TEMPORARY);
    await draft.renameTable(TEMPORARY, GROUPS);

    const catalogue = await draft.readCatalogue([]);

    expect(catalogue.units()).toEqual([
      { kind: 'structure', tableId: GROUPS, previousTableId: CATEGORIES },
    ]);
    expect(
      catalogue.systemRowsOf({
        kind: 'structure',
        tableId: GROUPS,
        previousTableId: CATEGORIES,
      }),
    ).toEqual([
      'migration init tmp',
      'migration remove tmp',
      'migration rename categories to tmp',
      'migration rename tmp to groups',
      'schema categories',
      'schema groups',
    ]);
  });

  function givenCommittedCatalog(): Promise<ChangesScenario> {
    return ChangesScenario.committed(kit, {
      [PRODUCTS]: {
        schema: productSchema,
        rows: { p1: { code: 'one', price: 1 } },
      },
      [CATEGORIES]: {
        schema: categorySchema,
        rows: { c1: { title: 'first' } },
      },
    });
  }
});
