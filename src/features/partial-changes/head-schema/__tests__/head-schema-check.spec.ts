import { num, obj, str } from '@revisium/schema-toolkit/mocks';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import type { RefusedTable } from 'src/features/partial-changes/head-schema/head-schema-check';
import {
  addField,
  moveField,
} from 'src/features/share/ledger-replay/__tests__/support/ledger-steps';
import { SystemTables } from 'src/features/share/system-tables.consts';
import type { AddressedUnit } from '../../__tests__/support/catalogue-reading';
import {
  ChangesScenario,
  type TableFixture,
} from '../../__tests__/support/changes-scenario';
import { expectEveryDifferenceOwnedOnce } from '../../__tests__/support/column-ownership';
import {
  completeAsyncMigrationInPlace,
  describedLedgerOf,
  recordLedgerRepair,
  replayedHeadLedgerOf,
  schemaRowOf,
} from '../../__tests__/support/head-schema-damage';

const CATEGORIES = 'categories';
const PRODUCTS = 'products';
const GOODS = 'goods';
const GROUPS = 'groups';
const TAGS = 'tags';
const COLOR = 'color';
const SHADE = 'shade';
const WEIGHT = 'weight';

const categorySchema = obj({ title: str() });
const productSchema = obj({
  code: str(),
  category: str({ foreignKey: CATEGORIES }),
});
const coloredProductSchema = obj({
  code: str(),
  category: str({ foreignKey: CATEGORIES }),
  color: str(),
});
const tagSchema = obj({ label: str() });

const categories: TableFixture = {
  schema: categorySchema,
  rows: { c1: { title: 'first' } },
};
const productRows = {
  p1: { code: 'one', category: 'c1' },
  p2: { code: 'two', category: 'c1' },
};
const products: TableFixture = { schema: productSchema, rows: productRows };

const addColor = [addField(COLOR, str())];

const categoryEdit: AddressedUnit = {
  kind: 'field',
  tableId: CATEGORIES,
  rowId: 'c1',
  path: '/title',
};
const productRename: AddressedUnit = {
  kind: 'rowRename',
  tableId: PRODUCTS,
  rowId: 'p9',
  previousRowId: 'p1',
};
const goodsRename: AddressedUnit = { ...productRename, tableId: GOODS };
const createdTags: AddressedUnit = { kind: 'structure', tableId: TAGS };
const createdProducts: AddressedUnit = { kind: 'structure', tableId: PRODUCTS };

interface RefusalCase {
  readonly damage: string;
  readonly given: () => Promise<ChangesScenario>;
  readonly refusal: RefusedTable;
  readonly edit: AddressedUnit;
}

interface AcceptedCase {
  readonly table: string;
  readonly given: () => Promise<ChangesScenario>;
  readonly edit: AddressedUnit;
}

describe('HeadSchemaCheck: refused tables', () => {
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

  const refusalCases: RefusalCase[] = [
    {
      damage: 'an async migration completed in place and not yet published',
      given: givenUnpublishedInPlaceMigration,
      refusal: { tableId: PRODUCTS, code: 'headSchemaInconsistent' },
      edit: productRename,
    },
    {
      damage: 'an async migration completed in place and published natively',
      given: givenPublishedInPlaceMigration,
      refusal: { tableId: PRODUCTS, code: 'headSchemaInconsistent' },
      edit: productRename,
    },
    {
      damage: 'an in-place migration whose repair is not yet published',
      given: givenUnpublishedRepair,
      refusal: { tableId: PRODUCTS, code: 'headSchemaInconsistent' },
      edit: productRename,
    },
    {
      damage: 'a published migration that builds on an unrecorded change',
      given: givenUnreplayableHeadLedger,
      refusal: { tableId: PRODUCTS, code: 'headSchemaInconsistent' },
      edit: productRename,
    },
    {
      damage: 'a Head ledger without the init of the table',
      given: givenHeadTableWithoutInit,
      refusal: { tableId: PRODUCTS, code: 'unledgeredTable' },
      edit: productRename,
    },
    {
      damage: 'a Draft ledger without the init of a table created in the Draft',
      given: givenDraftTableWithoutInit,
      refusal: { tableId: TAGS, code: 'unledgeredTable' },
      edit: createdTags,
    },
    {
      damage:
        'a Draft ledger that opens the id of a table created in the Draft a second time',
      given: givenDraftTableAtAnIdRemovedWithoutRecord,
      refusal: { tableId: PRODUCTS, code: 'unledgeredTable' },
      edit: createdProducts,
    },
  ];

  const projectWithoutMigrationTable: RefusalCase = {
    damage: 'a project without a migration table',
    given: givenProjectWithoutMigrationTable,
    refusal: { tableId: PRODUCTS, code: 'unledgeredTable' },
    edit: productRename,
  };

  describe('in a partial operation', () => {
    it.each(refusalCases)(
      'refuses the table left by $damage and keeps the units of other tables',
      async ({ given, refusal }) => {
        const draft = await given();
        await draft.updateRow(CATEGORIES, 'c1', { title: 'edited' });

        const catalogue = await draft.readCatalogue([
          refusal.tableId,
          CATEGORIES,
        ]);

        expect(catalogue.refusedTables).toEqual([refusal]);
        expect(catalogue.unitsOf(refusal.tableId)).toEqual([]);
        expect(catalogue.unitsOf(CATEGORIES)).toEqual([categoryEdit]);
      },
    );

    it('refuses every table of a project without a migration table', async () => {
      const draft = await projectWithoutMigrationTable.given();
      await draft.updateRow(CATEGORIES, 'c1', { title: 'edited' });

      const catalogue = await draft.readCatalogue([PRODUCTS, CATEGORIES]);

      expect(catalogue.refusedTables).toEqual([
        { tableId: CATEGORIES, code: 'unledgeredTable' },
        { tableId: PRODUCTS, code: 'unledgeredTable' },
      ]);
      expect(catalogue.units()).toEqual([]);
    });

    it.each<AcceptedCase>([
      {
        table: 'a table renamed through recorded migrations',
        given: givenTableRenamedThroughLedger,
        edit: goodsRename,
      },
      {
        table:
          'a table whose rows kept their schema hash when a referenced table was renamed',
        given: givenReferrerOfRenamedTable,
        edit: productRename,
      },
      {
        table: 'a table created in the Draft through its pending init',
        given: givenDraftTableWithInit,
        edit: createdTags,
      },
    ])('does not refuse $table', async ({ given, edit }) => {
      const draft = await given();

      const catalogue = await draft.readCatalogue([edit.tableId]);

      expect(catalogue.refusedTables).toEqual([]);
      expect(catalogue.unitsOf(edit.tableId)).toEqual([edit]);
      expectEveryDifferenceOwnedOnce(catalogue);
    });

    it('does not refuse a table whose Draft-owned schema row an async migration rewrote, and finds its Draft structure unrecorded', async () => {
      const draft = await givenDraftOnlyDamage();

      const catalogue = await draft.readCatalogue([PRODUCTS]);

      expect(catalogue.refusedTables).toEqual([]);
      expect(catalogue.unitsOf(PRODUCTS)).toEqual([
        { kind: 'structure', tableId: PRODUCTS },
      ]);
      expect(catalogue.structureOf(PRODUCTS).recorded).toBe(false);
    });
  });

  describe('for exactly { all: true }', () => {
    it.each([...refusalCases, projectWithoutMigrationTable])(
      'refuses nothing and lists the units of the table left by $damage',
      async ({ given, refusal, edit }) => {
        const draft = await given();

        const catalogue = await draft.readWholeDraftCatalogue();

        expect(catalogue.refusedTables).toEqual([]);
        expect(catalogue.unitsOf(refusal.tableId)).toContainEqual(edit);
        expectEveryDifferenceOwnedOnce(catalogue);
      },
    );

    it.each([
      {
        draft: 'an unrepaired Draft',
        baseline: 'its Head schema row',
        given: givenUnpublishedInPlaceMigration,
      },
      {
        draft: 'a repaired Draft',
        baseline: 'the schema replayed from its Head ledger',
        given: givenUnpublishedRepair,
      },
    ])(
      'records the structure of a damaged table in $draft from $baseline',
      async ({ given }) => {
        const draft = await given();

        const catalogue = await draft.readWholeDraftCatalogue();

        expect(catalogue.structureOf(PRODUCTS).recorded).toBe(true);
      },
    );
  });

  function givenCommittedCatalog(): Promise<ChangesScenario> {
    return ChangesScenario.committed(kit, {
      [CATEGORIES]: categories,
      [PRODUCTS]: products,
    });
  }

  async function givenUnpublishedInPlaceMigration(): Promise<ChangesScenario> {
    const draft = await givenCommittedCatalog();
    await completeAsyncMigrationInPlace(kit, draft, PRODUCTS, addColor);
    await expectHeadRowsBehindTheirRewrittenSchemaRow(draft);
    await draft.renameRow(PRODUCTS, 'p1', 'p9');

    return draft;
  }

  async function givenPublishedInPlaceMigration(): Promise<ChangesScenario> {
    const draft = await givenCommittedCatalog();
    await completeAsyncMigrationInPlace(kit, draft, PRODUCTS, addColor);
    await draft.commit();
    await expectOnlyTheHeadLedgerBehindTheSchemaRow(draft);
    await draft.renameRow(PRODUCTS, 'p1', 'p9');

    return draft;
  }

  async function givenUnpublishedRepair(): Promise<ChangesScenario> {
    const draft = await givenUnpublishedInPlaceMigration();
    await recordLedgerRepair(draft, PRODUCTS, addColor);
    await expectHeadRowsBehindTheirRewrittenSchemaRow(draft);
    expect(await describedLedgerOf(draft, 'draft')).toEqual([
      'init categories',
      'init products',
      'update products',
    ]);

    return draft;
  }

  async function givenUnreplayableHeadLedger(): Promise<ChangesScenario> {
    const draft = await givenCommittedCatalog();
    await completeAsyncMigrationInPlace(kit, draft, PRODUCTS, addColor);
    await draft.commit();
    await draft.updateTable(PRODUCTS, [moveField(COLOR, SHADE)]);
    await draft.commit();
    await expectUnreplayableInHeadLedger(draft, PRODUCTS);
    await draft.renameRow(PRODUCTS, 'p1', 'p9');

    return draft;
  }

  async function givenHeadTableWithoutInit(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [CATEGORIES]: categories,
    });
    await draft.createTable(PRODUCTS, productSchema);
    await draft.createRows(PRODUCTS, productRows);
    await draft.dropFromDraftLedger('init', PRODUCTS);
    await draft.commit();
    expect(await describedLedgerOf(draft, 'head')).toEqual(['init categories']);
    await draft.renameRow(PRODUCTS, 'p1', 'p9');

    return draft;
  }

  async function givenDraftTableWithoutInit(): Promise<ChangesScenario> {
    const draft = await givenCommittedCatalog();
    await draft.createTable(TAGS, tagSchema);
    await draft.dropFromDraftLedger('init', TAGS);
    expect(await describedLedgerOf(draft, 'draft')).toEqual([
      'init categories',
      'init products',
    ]);

    return draft;
  }

  async function givenDraftTableAtAnIdRemovedWithoutRecord(): Promise<ChangesScenario> {
    const draft = await givenCommittedCatalog();
    await draft.removeTable(PRODUCTS);
    await draft.dropFromDraftLedger('remove', PRODUCTS);
    await draft.commit();
    await draft.createTable(PRODUCTS, productSchema);
    expect(await draft.hasTable('head', PRODUCTS)).toBe(false);
    expect(await describedLedgerOf(draft, 'draft')).toEqual([
      'init categories',
      'init products',
      'init products',
    ]);

    return draft;
  }

  async function givenProjectWithoutMigrationTable(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committedWithoutLedger(kit, {
      [CATEGORIES]: categories,
      [PRODUCTS]: products,
    });
    expect(await draft.hasTable('head', SystemTables.Migration)).toBe(false);
    await draft.renameRow(PRODUCTS, 'p1', 'p9');

    return draft;
  }

  async function givenTableRenamedThroughLedger(): Promise<ChangesScenario> {
    const draft = await givenCommittedCatalog();
    await draft.renameTable(PRODUCTS, GOODS);
    await draft.commit();
    expect(await describedLedgerOf(draft, 'head')).toEqual([
      'init categories',
      'init products',
      'rename products to goods',
    ]);
    await draft.renameRow(GOODS, 'p1', 'p9');

    return draft;
  }

  async function givenReferrerOfRenamedTable(): Promise<ChangesScenario> {
    const draft = await givenCommittedCatalog();
    await draft.renameTable(CATEGORIES, GROUPS);
    await draft.commit();
    await expectHeadRowsWithAnotherSchemaHash(draft, PRODUCTS);
    await draft.renameRow(PRODUCTS, 'p1', 'p9');

    return draft;
  }

  async function givenDraftTableWithInit(): Promise<ChangesScenario> {
    const draft = await givenCommittedCatalog();
    await draft.createTable(TAGS, tagSchema);

    return draft;
  }

  async function givenDraftOnlyDamage(): Promise<ChangesScenario> {
    const draft = await givenCommittedCatalog();
    await draft.updateTable(PRODUCTS, [addField(WEIGHT, num())]);
    await completeAsyncMigrationInPlace(kit, draft, PRODUCTS, addColor);
    await expectOnlyTheDraftSchemaRowRewritten(draft);

    return draft;
  }

  async function expectHeadRowsBehindTheirRewrittenSchemaRow(
    draft: ChangesScenario,
  ): Promise<void> {
    expect(await schemaRowOf(draft, 'head', PRODUCTS)).toEqual(
      coloredProductSchema,
    );
    expect((await replayedHeadLedgerOf(draft)).schemas.get(PRODUCTS)).toEqual(
      productSchema,
    );
    expect((await draft.row('head', PRODUCTS, 'p2')).data).toEqual({
      code: 'two',
      category: 'c1',
    });
  }

  async function expectOnlyTheHeadLedgerBehindTheSchemaRow(
    draft: ChangesScenario,
  ): Promise<void> {
    expect(await schemaRowOf(draft, 'head', PRODUCTS)).toEqual(
      coloredProductSchema,
    );
    expect((await replayedHeadLedgerOf(draft)).schemas.get(PRODUCTS)).toEqual(
      productSchema,
    );
    expect((await draft.row('head', PRODUCTS, 'p2')).data).toEqual({
      code: 'two',
      category: 'c1',
      color: '',
    });
  }

  async function expectUnreplayableInHeadLedger(
    draft: ChangesScenario,
    tableId: string,
  ): Promise<void> {
    const replayed = await replayedHeadLedgerOf(draft);

    expect([...replayed.unreplayable.keys()]).toEqual([tableId]);
  }

  async function expectHeadRowsWithAnotherSchemaHash(
    draft: ChangesScenario,
    tableId: string,
  ): Promise<void> {
    const schemaRow = await draft.row('head', SystemTables.Schema, tableId);
    const row = await draft.row('head', tableId, 'p1');

    expect(row.schemaHash).not.toBe(schemaRow.hash);
  }

  async function expectOnlyTheDraftSchemaRowRewritten(
    draft: ChangesScenario,
  ): Promise<void> {
    expect(await schemaRowOf(draft, 'head', PRODUCTS)).toEqual(productSchema);
    expect(await schemaRowOf(draft, 'draft', PRODUCTS)).toEqual(
      obj({
        code: str(),
        category: str({ foreignKey: CATEGORIES }),
        weight: num(),
        color: str(),
      }),
    );
    expect(await describedLedgerOf(draft, 'draft')).toEqual([
      'init categories',
      'init products',
      'update products',
    ]);
  }
});
