import { num, numFormula, obj, str } from '@revisium/schema-toolkit/mocks';
import type { JsonSchema, Migration } from '@revisium/schema-toolkit/types';
import objectHash from 'object-hash';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import type { JsonValue, Row } from 'src/engine-prisma-types';
import { expectStrictlyAscending } from 'src/features/migration/__tests__/support/ledger-repair-planning';
import type {
  CommitChangesResult,
  CommittedDraft,
} from 'src/features/partial-changes/commands/impl/commit-draft-changes.command';
import type {
  FieldRef,
  RowRef,
  Selection,
} from 'src/features/partial-changes/selection/selection';
import {
  addField,
  moveField,
  replaceField,
} from 'src/features/share/ledger-replay/__tests__/support/ledger-steps';
import { SystemTables } from 'src/features/share/system-tables.consts';
import type { TableViewsData } from 'src/features/views/types';
import { ChangesScenario } from '../../__tests__/support/changes-scenario';
import { describedLedgerOf } from '../../__tests__/support/head-schema-damage';
import {
  DraftSyncedReplica,
  expectPendingMigrationsAfterPublished,
  HeadSyncedReplica,
} from '../../__tests__/support/ledger-replicas';
import {
  replayedSchemasOf,
  schemasOf,
} from '../../__tests__/support/ledger-replaying';
import type { RevisionSide } from '../../__tests__/support/snapshot-reading';

const PRODUCTS = 'products';
const ORDERS = 'orders';
const CATEGORIES = 'categories';
const GROUPS = 'groups';
const BRANDS = 'brands';
const TAGS = 'tags';
const DRAFTS = 'drafts';

const productSchema = obj({ title: str(), price: num() });
const colouredProductSchema = obj({ title: str(), price: num(), color: str() });
const orderSchema = obj({ price: num(), quantity: num() });
const categorySchema = obj({ title: str() });
const categorisedProductSchema = obj({
  title: str(),
  category: str({ foreignKey: CATEGORIES }),
});
const tagSchema = obj({ label: str() });
const brandSchema = obj({ name: str() });

const priceOf = (rowId: string): FieldRef => ({
  tableId: PRODUCTS,
  rowId,
  path: '/price',
});
const rowOf = (tableId: string, rowId: string): RowRef => ({ tableId, rowId });
const structureOf = (tableId: string) => ({
  kind: 'structure',
  tableId,
  selector: { tables: [tableId] },
});

describe('commitChanges of structure units', () => {
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

  describe('fields and values of a structure', () => {
    it('commits prices alone while products gets a new field, then the new field with its values (AS-10)', async () => {
      const draft = await givenProductsGettingColorWhilePricesChange();

      await expectApplied(
        draft.commitChanges({
          selection: { fields: [priceOf('p1'), priceOf('p2')] },
        }),
      );

      expect(await schemaOf(draft, 'head', PRODUCTS)).toEqual(productSchema);
      await expectRows(draft, 'head', PRODUCTS, {
        p1: { title: 'one', price: 10 },
        p2: { title: 'two', price: 20 },
      });

      await expectApplied(
        draft.commitChanges({ selection: { tables: [PRODUCTS] } }),
      );

      expect(await schemaOf(draft, 'head', PRODUCTS)).toEqual(
        colouredProductSchema,
      );
      await expectRows(draft, 'head', PRODUCTS, {
        p1: { title: 'one', price: 10, color: 'red' },
        p2: { title: 'two', price: 20, color: 'blue' },
      });
      expect(await draft.listEveryUnit()).toEqual([]);
      expect(await draft.hasChanges()).toBe(false);
      await expectBothLedgersToReplayToTheirSchemas(draft);
    });

    it('keeps the edits of unchanged fields in the Draft when the structure is committed without them, and tableData commits only them (AS-11)', async () => {
      const draft = await givenCommittedProducts();
      await draft.updateTable(PRODUCTS, [addField('color', str())]);
      await draft.updateRow(PRODUCTS, 'p1', {
        title: 'uno',
        price: 1,
        color: 'red',
      });

      await expectApplied(
        draft.commitChanges({ selection: { tables: [PRODUCTS] } }),
      );

      await expectRows(draft, 'head', PRODUCTS, {
        p1: { title: 'one', price: 1, color: 'red' },
        p2: { title: 'two', price: 2, color: '' },
      });
      expect(unitsOf(await draft.listEveryUnit())).toEqual([
        { kind: 'field', rowId: 'p1', path: '/title' },
      ]);

      await expectApplied(
        draft.commitChanges({ selection: { tableData: [PRODUCTS] } }),
      );

      await expectRows(draft, 'head', PRODUCTS, {
        p1: { title: 'uno', price: 1, color: 'red' },
        p2: { title: 'two', price: 2, color: '' },
      });
      expect(await draft.listEveryUnit()).toEqual([]);
    });

    it('requires the structure for a value of a changed field selected alone, and commits them together (AS-12)', async () => {
      const draft = await givenProductsGettingColorWhilePricesChange();
      const selection: Selection = {
        fields: [{ tableId: PRODUCTS, rowId: 'p1', path: '/color' }],
      };

      const preview = await draft.previewChanges({
        operation: 'commit',
        selection,
      });
      const result = await draft.commitChanges({
        selection,
        includeRequired: true,
        expected: preview.fingerprint,
      });

      expect(preview).toMatchObject({
        status: 'required',
        required: [
          {
            unit: structureOf(PRODUCTS),
            reason: { code: 'structureBoundData', path: '/color' },
          },
        ],
      });
      expect(result).toMatchObject({
        status: 'applied',
        applied: { selected: 0, required: 1 },
      });
      await expectRows(draft, 'head', PRODUCTS, {
        p1: { title: 'one', price: 1, color: 'red' },
        p2: { title: 'two', price: 2, color: 'blue' },
      });
    });

    it('defers nothing when a created row is committed with its structure (AS-13)', async () => {
      const draft = await givenCommittedProducts();
      await draft.updateTable(PRODUCTS, [addField('color', str())]);
      await draft.createRows(PRODUCTS, {
        p3: { title: 'three', price: 3, color: 'green' },
      });
      const selection: Selection = {
        tables: [PRODUCTS],
        rows: [rowOf(PRODUCTS, 'p3')],
      };

      const preview = await draft.previewChanges({
        operation: 'commit',
        selection,
      });
      await expectApplied(draft.commitChanges({ selection }));

      expect(preview).toMatchObject({ status: 'ready', deferred: [] });
      await expectRow(draft, 'head', PRODUCTS, 'p3', {
        title: 'three',
        price: 3,
        color: 'green',
      });
    });

    it('migrates a Head row whose deletion stays in the Draft into the committed structure, and computes formulas with that structure (AS-15)', async () => {
      const draft = await ChangesScenario.committed(kit, {
        [ORDERS]: {
          schema: orderSchema,
          rows: {
            o1: { price: 2, quantity: 3 },
            o2: { price: 4, quantity: 5 },
          },
        },
      });
      await draft.updateTable(ORDERS, [
        addField('total', numFormula('price * quantity')),
      ]);
      await draft.updateRow(ORDERS, 'o1', { price: 2, quantity: 10, total: 0 });
      await draft.removeRow(ORDERS, 'o2');

      await expectApplied(
        draft.commitChanges({ selection: { tables: [ORDERS] } }),
      );

      await expectRows(draft, 'head', ORDERS, {
        o1: { price: 2, quantity: 3, total: 6 },
        o2: { price: 4, quantity: 5, total: 20 },
      });
      await expectRows(draft, 'draft', ORDERS, {
        o1: { price: 2, quantity: 10, total: 20 },
      });
      await expectBothLedgersToReplayToTheirSchemas(draft);
    });

    it('requires the structure and the creation for a foreign key value of a created row in a changed field, and commits them together (AS-35)', async () => {
      const draft = await ChangesScenario.committed(kit, {
        [CATEGORIES]: {
          schema: categorySchema,
          rows: { c1: { title: 'one' } },
        },
        [PRODUCTS]: {
          schema: obj({ title: str(), brand: str() }),
          rows: { p1: { title: 'one', brand: 'c1' } },
        },
      });
      await draft.updateTable(PRODUCTS, [
        replaceField('brand', str({ foreignKey: CATEGORIES })),
      ]);
      await draft.createRows(PRODUCTS, { p3: { title: 'three', brand: 'c1' } });
      const selection: Selection = {
        fields: [{ tableId: PRODUCTS, rowId: 'p3', path: '/brand' }],
      };

      const preview = await draft.previewChanges({
        operation: 'commit',
        selection,
      });
      const result = await draft.commitChanges({
        selection,
        includeRequired: true,
        expected: preview.fingerprint,
      });

      expect(requiredOf(preview)).toEqual([
        { kind: 'structure', code: 'structureBoundData' },
        { kind: 'rowCreate', code: 'wholeRowUnit' },
      ]);
      expect(result).toMatchObject({ status: 'applied' });
      await expectRow(draft, 'head', PRODUCTS, 'p3', {
        title: 'three',
        brand: 'c1',
      });
    });

    it('requires the structure that dropped the key of a referrer for a committed deletion of the row it referenced', async () => {
      const draft = await givenCommittedCatalogue();
      await draft.updateTable(PRODUCTS, [replaceField('category', str())]);
      await draft.removeRow(CATEGORIES, 'c1');
      const selection: Selection = { rows: [rowOf(CATEGORIES, 'c1')] };

      const preview = await draft.previewChanges({
        operation: 'commit',
        selection,
      });
      const result = await draft.commitChanges({
        selection,
        includeRequired: true,
        expected: preview.fingerprint,
      });

      expect(preview).toMatchObject({
        status: 'required',
        required: [
          {
            unit: structureOf(PRODUCTS),
            reason: { code: 'structureBoundData', path: '/category' },
          },
        ],
      });
      expect(result).toMatchObject({ status: 'applied' });
      expect(await draft.rowIds('head', CATEGORIES)).toEqual([]);
      expect(await schemaOf(draft, 'head', PRODUCTS)).toEqual(
        obj({ title: str(), category: str() }),
      );
    });
  });

  describe('created, removed and transient tables', () => {
    it('commits a created table whole with its rows and keeps the other edits in the Draft (AS-14)', async () => {
      const draft = await givenEditedProducts();
      await draft.createTable(TAGS, tagSchema);
      await draft.createRows(TAGS, {
        t1: { label: 'one' },
        t2: { label: 'two' },
      });

      await expectApplied(
        draft.commitChanges({ selection: { tables: [TAGS] } }),
      );

      await expectRows(draft, 'head', TAGS, {
        t1: { label: 'one' },
        t2: { label: 'two' },
      });
      await expectRow(draft, 'head', PRODUCTS, 'p1', {
        title: 'one',
        price: 1,
      });
      expect(unitsOf(await draft.listEveryUnit())).toEqual([
        { kind: 'field', rowId: 'p1', path: '/title' },
      ]);
      await expectBothLedgersToReplayToTheirSchemas(draft);
    });

    it('requires the structure of a created table for a selector of one of its rows (AS-14)', async () => {
      const draft = await givenEditedProducts();
      await draft.createTable(TAGS, tagSchema);
      await draft.createRows(TAGS, { t1: { label: 'one' } });

      const result = await draft.commitChanges({
        selection: { rows: [rowOf(TAGS, 't1')] },
      });

      expect(result).toMatchObject({
        status: 'required',
        required: [
          {
            unit: structureOf(TAGS),
            reason: { code: 'structureBoundData', tableId: TAGS },
          },
        ],
      });
    });

    it('commits a removed and re-created table id as one structure unit (AS-16)', async () => {
      const draft = await givenEditedProductsNextToTags();
      await draft.removeTable(TAGS);
      await draft.createTable(TAGS, brandSchema);
      await draft.createRows(TAGS, { b1: { name: 'one' } });

      expect(
        unitsOf((await draft.listChanges({ tableId: TAGS })).units),
      ).toEqual([{ kind: 'structure' }]);
      await expectApplied(
        draft.commitChanges({ selection: { tables: [TAGS] } }),
      );

      expect(await schemaOf(draft, 'head', TAGS)).toEqual(brandSchema);
      await expectRows(draft, 'head', TAGS, { b1: { name: 'one' } });
      await expectBothLedgersToReplayToTheirSchemas(draft);
    });

    it('commits a table created and removed inside the Draft alone, and a Head-synced replica follows it (AS-16)', async () => {
      const draft = await givenEditedProducts();
      const replica = await givenHeadSyncedReplicaOf(draft);
      await draft.createTable(DRAFTS, tagSchema);
      await draft.removeTable(DRAFTS);

      await expectApplied(
        draft.commitChanges({ selection: { tables: [DRAFTS] } }),
      );

      expect(await describedLedgerOf(draft, 'head')).toEqual([
        `init ${PRODUCTS}`,
        `init ${DRAFTS}`,
        `remove ${DRAFTS}`,
      ]);
      expect(await draft.hasTable('head', DRAFTS)).toBe(false);
      await expectRow(draft, 'head', PRODUCTS, 'p1', {
        title: 'one',
        price: 1,
      });
      await replica.syncWith(draft);
      await replica.expectSchemasOf(draft);
    });
  });

  describe('references between structures', () => {
    it.each([
      { committed: GROUPS, required: PRODUCTS },
      { committed: PRODUCTS, required: GROUPS },
    ])(
      'requires the structure of $required with the structure of $committed after a rename of the referenced table, and a Head-synced replica follows them (AS-43)',
      async ({ committed, required }) => {
        const draft = await givenCommittedCatalogue();
        const replica = await givenHeadSyncedReplicaOf(draft);
        await draft.renameTable(CATEGORIES, GROUPS);
        const selection: Selection = { tables: [committed] };

        const preview = await draft.previewChanges({
          operation: 'commit',
          selection,
        });
        const result = await draft.commitChanges({
          selection,
          includeRequired: true,
          expected: preview.fingerprint,
        });

        expect(preview).toMatchObject({
          status: 'required',
          required: [{ unit: structureOf(required) }],
        });
        expect(result).toMatchObject({ status: 'applied' });
        expect(await draft.hasTable('head', GROUPS)).toBe(true);
        await expectBothLedgersToReplayToTheirSchemas(draft);
        await replica.syncWith(draft);
        await replica.expectSchemasOf(draft);
      },
    );

    it('requires a created table that a committed schema references by a foreign key (AS-43)', async () => {
      const draft = await ChangesScenario.committed(kit, {
        [PRODUCTS]: { schema: productSchema },
      });
      await draft.createTable(BRANDS, brandSchema);
      await draft.updateTable(PRODUCTS, [
        addField('brand', str({ foreignKey: BRANDS })),
      ]);

      const result = await draft.commitChanges({
        selection: { tables: [PRODUCTS] },
      });

      expect(result).toMatchObject({
        status: 'required',
        required: [
          {
            unit: structureOf(BRANDS),
            reason: { code: 'referencedTableMissing' },
          },
        ],
      });
    });
  });

  describe('views', () => {
    it('commits the views migration that follows a committed structure, which is no unit of its own (AS-19)', async () => {
      const draft = await givenCommittedProductsWithViews();
      await draft.updateTable(PRODUCTS, [moveField('price', 'cost')]);
      const migratedViews = await viewsOf(draft, 'draft');

      expect(unitsOf(await draft.listEveryUnit())).toEqual([
        { kind: 'structure' },
      ]);
      await expectApplied(
        draft.commitChanges({ selection: { tables: [PRODUCTS] } }),
      );

      expect(migratedViews).toEqual(productViews('All', ['title', 'cost']));
      expect(await viewsOf(draft, 'head')).toEqual(migratedViews);
    });

    it('requires the structure for committed views of a new field, and commits them together (AS-45)', async () => {
      const draft = await givenCommittedProductsWithViews();
      await draft.updateTable(PRODUCTS, [addField('color', str())]);
      await draft.updateViews(
        PRODUCTS,
        productViews('All', ['title', 'price', 'color']),
      );
      const selection: Selection = { views: [PRODUCTS] };

      const preview = await draft.previewChanges({
        operation: 'commit',
        selection,
      });
      const result = await draft.commitChanges({
        selection,
        includeRequired: true,
        expected: preview.fingerprint,
      });

      expect(preview).toMatchObject({
        status: 'required',
        required: [
          {
            unit: structureOf(PRODUCTS),
            reason: { code: 'viewsDoNotFitStructure' },
          },
        ],
      });
      expect(result).toMatchObject({ status: 'applied' });
      expect(await viewsOf(draft, 'head')).toEqual(
        productViews('All', ['title', 'price', 'color']),
      );
    });

    it('migrates the Head views with a committed structure while a views edit stays in the Draft (AS-45)', async () => {
      const draft = await givenCommittedProductsWithViews();
      await draft.updateTable(PRODUCTS, [moveField('price', 'cost')]);
      await draft.updateViews(PRODUCTS, productViews('Renamed', ['cost']));

      await expectApplied(
        draft.commitChanges({ selection: { tables: [PRODUCTS] } }),
      );

      expect(await viewsOf(draft, 'head')).toEqual(
        productViews('All', ['title', 'cost']),
      );
      expect(await viewsOf(draft, 'draft')).toEqual(
        productViews('Renamed', ['cost']),
      );
      expect(unitsOf(await draft.listEveryUnit())).toEqual([{ kind: 'views' }]);
    });
  });

  describe('renumbering the remaining migrations', () => {
    it('renumbers the migration of a structure that stays in the Draft after a later one committed first, and a Head-synced replica accepts this commit and the next (AS-40)', async () => {
      const draft = await givenProductsAndOrdersTwice();
      const replica = await givenHeadSyncedReplicaOf(draft);
      const [productsMigration, ordersMigration] =
        await draft.pendingMigrationIds();

      const result = await draft.commitChanges({
        selection: { tables: [ORDERS] },
      });

      const [renumbered] = renumberedOf(result);
      expect(renumberedOf(result)).toEqual([
        { from: productsMigration, to: expect.any(String) },
      ]);
      expect(await draft.ledgerIds('head')).toContain(ordersMigration);
      expect(await draft.pendingMigrationIds()).toEqual([renumbered?.to]);
      await expectPendingMigrationsAfterPublished(draft);
      await expectBothLedgersToReplayToTheirSchemas(draft);
      await replica.syncWith(draft);
      await replica.expectSchemasOf(draft);

      const next = await draft.commitChanges({
        selection: { tables: [PRODUCTS] },
      });

      expect(renumberedOf(next)).toEqual([]);
      expect(await draft.pendingMigrationIds()).toEqual([]);
      await replica.syncWith(draft);
      await replica.expectSchemasOf(draft);
    });

    it('renumbers every remaining migration in its order after the last committed one', async () => {
      const draft = await givenProductsAndOrdersTwice();
      await draft.updateTable(PRODUCTS, [addField('size', num())]);
      const [colorMigration, ordersMigration, sizeMigration] =
        await draft.pendingMigrationIds();

      const result = await draft.commitChanges({
        selection: { tables: [ORDERS] },
      });

      const renumbered = renumberedOf(result);
      expect(renumbered.map(({ from }) => from)).toEqual([
        colorMigration,
        sizeMigration,
      ]);
      expect(await draft.pendingMigrationIds()).toEqual(
        renumbered.map(({ to }) => to),
      );
      expectStrictlyAscending([
        ordersMigration,
        ...renumbered.map(({ to }) => to),
      ]);
      await expectBothLedgersToReplayToTheirSchemas(draft);
    });

    it('writes each renumbered migration as a new Draft row with its id, data id, publishedAt and hash changed together and the other columns of its source', async () => {
      const draft = await givenProductsAndOrdersTwice();
      const [productsMigration] = await draft.pendingMigrationIds();
      const source = await migrationRowOf(draft, productsMigration);

      const result = await draft.commitChanges({
        selection: { tables: [ORDERS] },
      });

      const [renumbered] = renumberedOf(result);
      const written = await migrationRowOf(draft, renumbered?.to);
      const data = { ...(source.data as unknown as Migration), id: written.id };
      expect(written).toMatchObject({
        createdId: source.createdId,
        createdAt: source.createdAt,
        meta: source.meta,
        schemaHash: source.schemaHash,
        readonly: false,
        data,
        hash: objectHash(data),
        publishedAt: new Date(written.id),
      });
      expect(written.versionId).not.toBe(source.versionId);
    });

    it('renumbers nothing when the committed structure holds the earlier migration (AS-40)', async () => {
      const draft = await givenProductsAndOrdersTwice();
      const [, ordersMigration] = await draft.pendingMigrationIds();

      const result = await draft.commitChanges({
        selection: { tables: [PRODUCTS] },
      });

      expect(renumberedOf(result)).toEqual([]);
      expect(await draft.pendingMigrationIds()).toEqual([ordersMigration]);
      await expectBothLedgersToReplayToTheirSchemas(draft);
    });

    it('leaves a replica synced from Draft exports failing on a renumbered migration, which is not supported (AS-42)', async () => {
      const draft = await givenProductsAndOrdersTwice();
      const replica = await DraftSyncedReplica.of(kit);
      expect(statusesOf(await replica.syncWith(draft))).not.toContain('failed');

      const [renumbered] = renumberedOf(
        await draft.commitChanges({ selection: { tables: [ORDERS] } }),
      );

      expect(await replica.syncWith(draft)).toEqual([
        { id: renumbered?.to, status: 'failed', error: expect.any(String) },
      ]);
    });
  });

  async function expectApplied(
    committing: Promise<CommitChangesResult>,
  ): Promise<void> {
    await expect(committing).resolves.toMatchObject({ status: 'applied' });
  }

  async function expectRow(
    draft: ChangesScenario,
    side: RevisionSide,
    tableId: string,
    rowId: string,
    data: JsonValue,
  ): Promise<void> {
    const row = await draft.row(side, tableId, rowId);

    expect(row.data).toEqual(data);
    expect(row.hash).toBe(objectHash(data));
  }

  async function expectRows(
    draft: ChangesScenario,
    side: RevisionSide,
    tableId: string,
    rows: Readonly<Record<string, JsonValue>>,
  ): Promise<void> {
    expect(await draft.rowIds(side, tableId)).toEqual(Object.keys(rows));

    for (const [rowId, data] of Object.entries(rows)) {
      await expectRow(draft, side, tableId, rowId, data);
    }
  }

  async function expectBothLedgersToReplayToTheirSchemas(
    draft: ChangesScenario,
  ): Promise<void> {
    expect(await replayedSchemasOf(draft, 'head')).toEqual(
      await schemasOf(draft, 'head'),
    );
    expect(await replayedSchemasOf(draft, 'draft')).toEqual(
      await schemasOf(draft, 'draft'),
    );
  }

  async function givenHeadSyncedReplicaOf(
    draft: ChangesScenario,
  ): Promise<HeadSyncedReplica> {
    const replica = await HeadSyncedReplica.of(kit);
    await replica.syncWith(draft);

    return replica;
  }

  async function schemaOf(
    draft: ChangesScenario,
    side: RevisionSide,
    tableId: string,
  ): Promise<JsonSchema> {
    const row = await draft.row(side, SystemTables.Schema, tableId);

    return row.data as unknown as JsonSchema;
  }

  async function viewsOf(
    draft: ChangesScenario,
    side: RevisionSide,
  ): Promise<JsonValue> {
    const row = await draft.row(side, SystemTables.Views, PRODUCTS);

    return row.data;
  }

  async function migrationRowOf(
    draft: ChangesScenario,
    migrationId: string | undefined,
  ): Promise<Row> {
    if (migrationId === undefined) {
      throw new Error('No migration id to read');
    }

    return draft.row('draft', SystemTables.Migration, migrationId);
  }

  function givenCommittedProducts(): Promise<ChangesScenario> {
    return ChangesScenario.committed(kit, {
      [PRODUCTS]: {
        schema: productSchema,
        rows: {
          p1: { title: 'one', price: 1 },
          p2: { title: 'two', price: 2 },
        },
      },
    });
  }

  async function givenEditedProducts(): Promise<ChangesScenario> {
    const draft = await givenCommittedProducts();
    await draft.updateRow(PRODUCTS, 'p1', { title: 'uno', price: 1 });

    return draft;
  }

  async function givenEditedProductsNextToTags(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [PRODUCTS]: {
        schema: productSchema,
        rows: { p1: { title: 'one', price: 1 } },
      },
      [TAGS]: { schema: tagSchema, rows: { t1: { label: 'one' } } },
    });
    await draft.updateRow(PRODUCTS, 'p1', { title: 'uno', price: 1 });

    return draft;
  }

  async function givenProductsGettingColorWhilePricesChange(): Promise<ChangesScenario> {
    const draft = await givenCommittedProducts();
    await draft.updateTable(PRODUCTS, [addField('color', str())]);
    await draft.updateRow(PRODUCTS, 'p1', {
      title: 'one',
      price: 10,
      color: 'red',
    });
    await draft.updateRow(PRODUCTS, 'p2', {
      title: 'two',
      price: 20,
      color: 'blue',
    });

    return draft;
  }

  function givenCommittedCatalogue(): Promise<ChangesScenario> {
    return ChangesScenario.committed(kit, {
      [CATEGORIES]: { schema: categorySchema, rows: { c1: { title: 'one' } } },
      [PRODUCTS]: {
        schema: categorisedProductSchema,
        rows: { p1: { title: 'one', category: 'c1' } },
      },
    });
  }

  async function givenCommittedProductsWithViews(): Promise<ChangesScenario> {
    const draft = await givenCommittedProducts();
    await draft.updateViews(PRODUCTS, productViews('All', ['title', 'price']));
    await draft.commit();

    return draft;
  }

  async function givenProductsAndOrdersTwice(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [PRODUCTS]: {
        schema: productSchema,
        rows: { p1: { title: 'one', price: 1 } },
      },
      [ORDERS]: {
        schema: orderSchema,
        rows: { o1: { price: 2, quantity: 3 } },
      },
    });
    await draft.updateTable(PRODUCTS, [addField('color', str())]);
    await draft.updateTable(ORDERS, [addField('note', str())]);

    return draft;
  }
});

function unitsOf(
  units: readonly { kind: string; rowId?: string; path?: string }[],
) {
  return units.map(({ kind, rowId, path }) => ({ kind, rowId, path }));
}

function requiredOf({
  required,
}: {
  required: readonly { unit: { kind: string }; reason: { code: string } }[];
}) {
  return required.map(({ unit, reason }) => ({
    kind: unit.kind,
    code: reason.code,
  }));
}

function renumberedOf(
  result: CommitChangesResult,
): CommittedDraft['renumbered'] {
  if (result.status !== 'applied') {
    throw new Error(`The commit was not applied: ${JSON.stringify(result)}`);
  }

  return result.renumbered;
}

function statusesOf(results: readonly { status: string }[]): string[] {
  return results.map(({ status }) => status);
}

function productViews(name: string, fields: readonly string[]): TableViewsData {
  return {
    version: 1,
    defaultViewId: 'default',
    views: [
      {
        id: 'default',
        name,
        columns: fields.map((field) => ({ field: `data.${field}` })),
      },
    ],
  };
}
