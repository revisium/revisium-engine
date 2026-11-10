import { num, obj, str } from '@revisium/schema-toolkit/mocks';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import {
  addField,
  removeField,
  replaceField,
} from 'src/__tests__/fixtures/ledger-steps';
import type { RowColumnsEdit } from 'src/__tests__/fixtures/branch-scenario';
import {
  describeMigration,
  pendingMigrationIds,
  storedLedgerOf,
} from 'src/__tests__/fixtures/stored-ledger';
import { ListingValidationError } from 'src/features/partial-changes/listing/listing-validation-error';
import type {
  DraftTableItem,
  DraftTablePage,
  TableSelection,
} from 'src/features/partial-changes/queries/impl/get-draft-table-changes.query';
import {
  ChangeType,
  JsonPatchOp,
  MigrationType,
  type ViewsChangeDetail,
} from 'src/features/revision-changes/types';
import type { TableViewsData } from 'src/features/views/types';
import { transactionModeOfSnapshotRead } from '../../__tests__/support/change-preview';
import { ChangesScenario } from '../../__tests__/support/changes-scenario';
import { readTablePageWhileDraftChanges } from '../../__tests__/support/draft-read-races';
import {
  draftReadQueriesDuring,
  tableItemsOf,
} from '../../__tests__/support/draft-reading';
import { describedStructureRef } from '../../__tests__/support/expected-unit-refs';

const PRODUCTS = 'products';
const ORDERS = 'orders';
const PURCHASES = 'purchases';
const NOTES = 'notes';
const MEMOS = 'memos';
const TAGS = 'tags';

const productSchema = obj({ title: str(), price: num() });
const labelSchema = obj({ label: str() });
const orderViews = viewsNamed('Labels');

const NO_VIEWS_CHANGE: ViewsChangeDetail = {
  hasChanges: false,
  changes: [],
  addedCount: 0,
  modifiedCount: 0,
  removedCount: 0,
  renamedCount: 0,
};

describe('draft table changes', () => {
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

  describe('selection', () => {
    it('gives a table with edited rows the table data selector and the number of rows it selects', async () => {
      const draft = await givenCommittedTables();
      await draft.updateRow(PRODUCTS, 'p1', { title: 'edited', price: 1 });

      expect(selectionsOf(await readTableItems(draft))).toEqual([
        [
          PRODUCTS,
          ChangeType.Modified,
          {
            state: 'selectable',
            tableData: { selector: { tableData: [PRODUCTS] }, rows: 1 },
          },
        ],
      ]);
    });

    it('gives a renamed table its structure unit under the Draft id', async () => {
      const draft = await givenCommittedTables();
      await draft.renameTable(ORDERS, PURCHASES);

      expect(selectionsOf(await readTableItems(draft))).toEqual([
        [
          PURCHASES,
          ChangeType.Renamed,
          {
            state: 'selectable',
            structure: describedStructureRef(
              { table: 'changed', fields: [] },
              PURCHASES,
              ORDERS,
            ),
          },
        ],
      ]);
    });

    it('gives both items of a removed and re-created table id their one replaced structure unit, the removed table first', async () => {
      const draft = await givenCommittedTables();
      await draft.removeTable(NOTES);
      await draft.createTable(NOTES, labelSchema);
      const replaced = {
        state: 'selectable',
        structure: describedStructureRef(
          { table: 'replaced', fields: [] },
          NOTES,
        ),
      };

      const items = await readTableItems(draft);

      expect(selectionsOf(items)).toEqual([
        [NOTES, ChangeType.Removed, replaced],
        [NOTES, ChangeType.Added, replaced],
      ]);
      expect(items.map(({ replaced }) => replaced)).toEqual([true, true]);
    });

    it('gives a created and a removed table their structure units', async () => {
      const draft = await givenCommittedTables();
      await draft.removeTable(NOTES);
      await draft.createTable(TAGS, labelSchema);

      expect(selectionsOf(await readTableItems(draft))).toEqual([
        [
          NOTES,
          ChangeType.Removed,
          {
            state: 'selectable',
            structure: describedStructureRef(
              { table: 'removed', fields: [] },
              NOTES,
            ),
          },
        ],
        [
          TAGS,
          ChangeType.Added,
          {
            state: 'selectable',
            structure: describedStructureRef(
              { table: 'created', fields: [] },
              TAGS,
            ),
          },
        ],
      ]);
    });

    it('says a table whose changed row versions are all content-equal has nothing to select', async () => {
      const draft = await givenCommittedTables();
      await draft.updateRow(PRODUCTS, 'p1', { title: 'one', price: 1 });

      expect(selectionsOf(await readTableItems(draft))).toEqual([
        [PRODUCTS, ChangeType.Modified, { state: 'contentEqual' }],
      ]);
    });

    it('refuses the tables of a project without a migration table and returns them on the page', async () => {
      const draft = await ChangesScenario.committedWithoutLedger(kit, {
        [TAGS]: { schema: labelSchema, rows: { t1: { label: 'one' } } },
      });
      await draft.updateRow(TAGS, 't1', { label: 'edited' });

      const page = await draft.readDraftTableChanges({ first: 10 });

      expect(page.refusedTables).toEqual([
        { tableId: TAGS, code: 'unledgeredTable' },
      ]);
      expect(selectionsOf(nodesOf(page))).toEqual([
        [
          TAGS,
          ChangeType.Modified,
          { state: 'refused', code: 'unledgeredTable' },
        ],
      ]);
    });

    it('says both tables of a replaced id of a project without a migration table are replaced and refused', async () => {
      const draft = await ChangesScenario.committedWithoutLedger(kit, {
        [TAGS]: { schema: labelSchema, rows: { t1: { label: 'one' } } },
      });
      await draft.removeTable(TAGS);
      await draft.createTable(TAGS, labelSchema);

      const items = await readTableItems(draft);
      const summary = await draft.readDraftChangesSummary();

      expect(
        items.map(({ changeType, replaced, selection }) => ({
          changeType,
          replaced,
          selection,
        })),
      ).toEqual([
        {
          changeType: ChangeType.Removed,
          replaced: true,
          selection: { state: 'refused', code: 'unledgeredTable' },
        },
        {
          changeType: ChangeType.Added,
          replaced: true,
          selection: { state: 'refused', code: 'unledgeredTable' },
        },
      ]);
      expect(summary.tablesSummary).toMatchObject({ total: 2, replaced: 1 });
    });
  });

  describe('ids', () => {
    it('addresses created, removed, renamed, replaced and modified tables by their Draft id, else their Head id', async () => {
      const draft = await givenCommittedTables();
      await draft.updateRow(PRODUCTS, 'p1', { title: 'edited', price: 1 });
      await draft.renameTable(ORDERS, PURCHASES);
      await draft.removeTable(NOTES);
      await draft.createTable(NOTES, labelSchema);
      await draft.createTable(TAGS, labelSchema);

      const items = await readTableItems(draft);

      expect(items.map(idsOf)).toEqual([
        { tableId: NOTES, changeType: ChangeType.Removed },
        { tableId: NOTES, changeType: ChangeType.Added },
        { tableId: PRODUCTS, changeType: ChangeType.Modified },
        {
          tableId: PURCHASES,
          previousTableId: ORDERS,
          changeType: ChangeType.Renamed,
        },
        { tableId: TAGS, changeType: ChangeType.Added },
      ]);
      expect(items.filter((item) => 'previousTableId' in item)).toHaveLength(1);
    });

    it('lists a removed table before the renamed table that took over its id, neither of them replaced', async () => {
      const draft = await givenCommittedTables();
      await draft.removeTable(NOTES);
      await draft.renameTable(ORDERS, NOTES);

      const pages = await draft.readEveryDraftTablePage({ first: 1 });
      const items = tableItemsOf(pages);

      expect(items.map(idsOf)).toEqual([
        { tableId: NOTES, changeType: ChangeType.Removed },
        {
          tableId: NOTES,
          previousTableId: ORDERS,
          changeType: ChangeType.Renamed,
        },
      ]);
      expect(items.map(({ replaced }) => replaced)).toEqual([false, false]);
      expect(items[0]?.selection).toMatchObject({
        structure: {
          selector: { structures: [{ tableId: NOTES, side: 'head' }] },
        },
      });
    });
  });

  describe('change types', () => {
    it('reads a table that was only renamed as RENAMED, where the native diff says RENAMED_AND_MODIFIED', async () => {
      const draft = await givenCommittedTables();
      await draft.renameTable(ORDERS, PURCHASES);

      const items = await readTableItems(draft);
      const native = await draft.readNativeTableChanges();

      expect(items.map(({ changeType }) => changeType)).toEqual([
        ChangeType.Renamed,
      ]);
      expect(native.map(({ changeType }) => changeType)).toEqual([
        ChangeType.RenamedAndModified,
      ]);
    });

    it.each<{
      change: string;
      edit: (draft: ChangesScenario) => Promise<void>;
    }>([
      {
        change: 'a field added',
        edit: (draft) =>
          draft.updateTable(PURCHASES, [addField('color', str())]),
      },
      {
        change: 'a row edited',
        edit: (draft) => draft.updateRow(PURCHASES, 'o1', { label: 'edited' }),
      },
      {
        change: 'a views edit',
        edit: (draft) => draft.updateViews(PURCHASES, orderViews),
      },
    ])(
      'reads a renamed table with $change as RENAMED_AND_MODIFIED',
      async ({ edit }) => {
        const draft = await givenCommittedTables();
        await draft.renameTable(ORDERS, PURCHASES);
        await edit(draft);

        const [item] = await readTableItems(draft);

        expect(item?.changeType).toBe(ChangeType.RenamedAndModified);
      },
    );

    it.each<{
      change: string;
      edit: (draft: ChangesScenario) => Promise<void>;
    }>([
      {
        change: 'a field added and removed again',
        edit: async (draft) => {
          await draft.updateTable(PURCHASES, [addField('color', str())]);
          await draft.updateTable(PURCHASES, [removeField('color')]);
        },
      },
      {
        change: 'a description',
        edit: (draft) =>
          draft.updateTable(PURCHASES, [
            replaceField('label', { ...str(), description: 'Shown in lists' }),
          ]),
      },
    ])(
      'reads an empty renamed table with $change as RENAMED_AND_MODIFIED by its structure alone',
      async ({ edit }) => {
        const draft = await ChangesScenario.committed(kit, {
          [ORDERS]: { schema: labelSchema, rows: {} },
        });
        await draft.renameTable(ORDERS, PURCHASES);
        await edit(draft);

        const [item] = await readTableItems(draft);

        expect(item).toMatchObject({
          tableId: PURCHASES,
          changeType: ChangeType.RenamedAndModified,
          rowsSummary: { total: 0 },
        });
      },
    );

    it('reads a renamed table of a project without a migration table as RENAMED_AND_MODIFIED, as it does not analyse it', async () => {
      const draft = await ChangesScenario.committedWithoutLedger(kit, {
        [ORDERS]: { schema: labelSchema, rows: {} },
      });
      await draft.renameTable(ORDERS, PURCHASES);

      const [item] = await readTableItems(draft);

      expect(item).toMatchObject({
        tableId: PURCHASES,
        changeType: ChangeType.RenamedAndModified,
        selection: { state: 'refused', code: 'unledgeredTable' },
      });
    });

    it('agrees with the native table changes in change type and row counts, except a table that was only renamed', async () => {
      const draft = await givenCommittedTables();
      await draft.updateRow(PRODUCTS, 'p1', { title: 'edited', price: 1 });
      await draft.createRows(PRODUCTS, { p2: { title: 'two', price: 2 } });
      await draft.renameTable(ORDERS, PURCHASES);
      await draft.updateRow(PURCHASES, 'o1', { label: 'edited' });
      await draft.removeTable(NOTES);
      await draft.createTable(TAGS, labelSchema);
      await draft.createRows(TAGS, { t1: { label: 'one' } });

      const items = await readTableItems(draft);
      const native = await draft.readNativeTableChanges();

      expect(items.map(nativeViewOfItem).sort(byTableId)).toEqual(
        native.map(nativeViewOfChange).sort(byTableId),
      );
    });
  });

  describe('change type filter', () => {
    it.each([
      {
        changeType: ChangeType.Renamed,
        tables: [`${NOTES} → ${MEMOS}`, `${ORDERS} → ${PURCHASES}`],
      },
      {
        changeType: ChangeType.Modified,
        tables: [`${NOTES} → ${MEMOS}`, PRODUCTS],
      },
      {
        changeType: ChangeType.RenamedAndModified,
        tables: [`${NOTES} → ${MEMOS}`],
      },
    ])(
      'lists for $changeType the tables of that change type, a renamed and modified table among them, before paging',
      async ({ changeType, tables }) => {
        const draft = await givenModifiedRenamedAndRenamedModifiedTables();

        const pages = await draft.readEveryDraftTablePage({
          first: 1,
          filters: { changeTypes: [changeType] },
        });

        expect(pages.map(tableNamesOfPage)).toEqual(
          tables.map((table, index) => ({
            tables: [table],
            totalCount: tables.length,
            hasNextPage: index < tables.length - 1,
          })),
        );
      },
    );

    it.each<{
      filter: string;
      changeTypes?: ChangeType[];
      totalCount: number;
      reads: Record<string, number>;
    }>([
      {
        filter: 'no filter',
        totalCount: 3,
        reads: { [MEMOS]: 1, [PRODUCTS]: 0, [PURCHASES]: 0 },
      },
      {
        filter: 'ADDED, which no renamed table can match',
        changeTypes: [ChangeType.Added],
        totalCount: 0,
        reads: { [MEMOS]: 0, [PRODUCTS]: 0, [PURCHASES]: 0 },
      },
      {
        filter: 'RENAMED, which every renamed table matches',
        changeTypes: [ChangeType.Renamed],
        totalCount: 2,
        reads: { [MEMOS]: 1, [PRODUCTS]: 0, [PURCHASES]: 0 },
      },
      {
        filter: 'MODIFIED, which needs the change type of every renamed table',
        changeTypes: [ChangeType.Modified],
        totalCount: 2,
        reads: { [MEMOS]: 1, [PRODUCTS]: 0, [PURCHASES]: 1 },
      },
    ])(
      'reads with $filter the row counts of the page and of an off-page renamed table only when the filter needs its change type',
      async ({ changeTypes, totalCount, reads }) => {
        const draft = await givenModifiedRenamedAndRenamedModifiedTables();

        const { result, linkSetReads } = await draftReadQueriesDuring(
          kit,
          await draft.linkSetsOf([MEMOS, PRODUCTS, PURCHASES]),
          () =>
            draft.readDraftTableChanges({ first: 1, filters: { changeTypes } }),
        );

        expect(result.totalCount).toBe(totalCount);
        expect(linkSetReads).toEqual(reads);
      },
    );

    it('matches no table with an empty list of change types', async () => {
      const draft = await givenModifiedRenamedAndRenamedModifiedTables();

      const page = await draft.readDraftTableChanges({
        first: 10,
        filters: { changeTypes: [] },
      });

      expect(page.totalCount).toBe(0);
    });

    async function givenModifiedRenamedAndRenamedModifiedTables(): Promise<ChangesScenario> {
      const draft = await givenCommittedTables();
      await draft.updateRow(PRODUCTS, 'p1', { title: 'edited', price: 1 });
      await draft.renameTable(ORDERS, PURCHASES);
      await draft.renameTable(NOTES, MEMOS);
      await draft.updateRow(MEMOS, 'n1', { label: 'edited' });

      return draft;
    }
  });

  describe('search', () => {
    it.each([
      ['its Draft id, ignoring case', 'PURCH', [PURCHASES]],
      ['the Head id of a renamed table', 'ord', [PURCHASES]],
      ['the Head id of a removed table', 'note', [NOTES]],
      ['an underscore as a plain character', '_', []],
      ['no table id', 'missing', []],
    ])(
      'lists the tables whose id contains the search term: %s',
      async (_match, search, tableIds) => {
        const draft = await givenEditedRenamedAndRemovedTables();

        const page = await draft.readDraftTableChanges({
          first: 10,
          filters: { search },
        });

        expect(nodesOf(page).map(({ tableId }) => tableId)).toEqual(tableIds);
        expect(page.totalCount).toBe(tableIds.length);
      },
    );

    it('searches before paging, so the total and the next page count only the matching tables', async () => {
      const draft = await givenEditedRenamedAndRemovedTables();

      const pages = await draft.readEveryDraftTablePage({
        first: 1,
        filters: { search: 'r' },
      });

      expect(pages.map(tableNamesOfPage)).toEqual([
        { tables: [PRODUCTS], totalCount: 2, hasNextPage: true },
        {
          tables: [`${ORDERS} → ${PURCHASES}`],
          totalCount: 2,
          hasNextPage: false,
        },
      ]);
    });

    async function givenEditedRenamedAndRemovedTables(): Promise<ChangesScenario> {
      const draft = await givenCommittedTables();
      await draft.updateRow(PRODUCTS, 'p1', { title: 'edited', price: 1 });
      await draft.renameTable(ORDERS, PURCHASES);
      await draft.removeTable(NOTES);

      return draft;
    }
  });

  describe('views of a table', () => {
    it('compares the views of a renamed table under its Head id with those under its Draft id, so unchanged views have no change', async () => {
      const draft = await givenCommittedTablesWithViews();
      await draft.renameTable(ORDERS, PURCHASES);

      const [item] = await readTableItems(draft);

      expect(item?.viewsChanges).toEqual(NO_VIEWS_CHANGE);
    });

    it('compares the views of a renamed table under its Head id with those under its Draft id, so a renamed view is renamed', async () => {
      const draft = await givenCommittedTablesWithViews();
      await draft.renameTable(ORDERS, PURCHASES);
      await draft.updateViews(PURCHASES, viewsNamed('Purchases'));

      const [item] = await readTableItems(draft);

      expect(item?.viewsChanges).toEqual({
        ...NO_VIEWS_CHANGE,
        hasChanges: true,
        changes: [
          {
            viewId: 'default',
            viewName: 'Purchases',
            oldViewName: 'Labels',
            changeType: ChangeType.Renamed,
          },
        ],
        renamedCount: 1,
      });
    });

    it('gives each table of a replaced id its own views: the removed table removes its views and the created one adds its own', async () => {
      const draft = await givenCommittedTablesWithViews();
      await draft.removeTable(ORDERS);
      await draft.createTable(ORDERS, labelSchema);
      await draft.updateViews(ORDERS, viewsNamed('Orders'));

      const items = await readTableItems(draft);

      expect(
        items.map(({ changeType, viewsChanges }) => [changeType, viewsChanges]),
      ).toEqual([
        [
          ChangeType.Removed,
          {
            ...NO_VIEWS_CHANGE,
            hasChanges: true,
            changes: [
              {
                viewId: 'default',
                viewName: 'Labels',
                changeType: ChangeType.Removed,
              },
            ],
            removedCount: 1,
          },
        ],
        [
          ChangeType.Added,
          {
            ...NO_VIEWS_CHANGE,
            hasChanges: true,
            changes: [
              {
                viewId: 'default',
                viewName: 'Orders',
                changeType: ChangeType.Added,
              },
            ],
            addedCount: 1,
          },
        ],
      ]);
    });

    async function givenCommittedTablesWithViews(): Promise<ChangesScenario> {
      const draft = await givenCommittedTables();
      await draft.updateViews(ORDERS, orderViews);
      await draft.commit();

      return draft;
    }
  });

  describe('migrations of a table', () => {
    it.each<{
      change: string;
      edit: (draft: ChangesScenario) => Promise<void>;
      migrations: string[];
    }>([
      {
        change: 'a rename',
        edit: (draft) => draft.renameTable(ORDERS, PURCHASES),
        migrations: [`rename ${ORDERS} to ${PURCHASES}`],
      },
      {
        change: 'a rename and an update after it',
        edit: async (draft) => {
          await draft.renameTable(ORDERS, PURCHASES);
          await draft.updateTable(PURCHASES, [addField('color', str())]);
        },
        migrations: [`rename ${ORDERS} to ${PURCHASES}`, `update ${PURCHASES}`],
      },
      {
        change: 'an update and a rename after it',
        edit: async (draft) => {
          await draft.updateTable(ORDERS, [addField('color', str())]);
          await draft.renameTable(ORDERS, PURCHASES);
        },
        migrations: [`update ${ORDERS}`, `rename ${ORDERS} to ${PURCHASES}`],
      },
    ])(
      'lists the pending migrations of a renamed table with $change, in ledger order',
      async ({ edit, migrations }) => {
        const draft = await givenCommittedTables();
        await edit(draft);

        const [item] = await readTableItems(draft);

        expect(await describedMigrationsOf(draft, item)).toEqual(migrations);
      },
    );

    it('gives each pending migration in the native detail shape', async () => {
      const draft = await givenCommittedTables();
      await draft.renameTable(ORDERS, PURCHASES);
      await draft.updateTable(PURCHASES, [addField('color', str())]);

      const [item] = await readTableItems(draft);

      expect(item?.schemaMigrations).toEqual([
        {
          migrationType: MigrationType.Rename,
          migrationId: expect.any(String),
          oldTableId: ORDERS,
          newTableId: PURCHASES,
        },
        {
          migrationType: MigrationType.Update,
          migrationId: expect.any(String),
          patches: [
            {
              op: JsonPatchOp.Add,
              path: '/properties/color',
              value: str(),
              from: undefined,
            },
          ],
        },
      ]);
    });

    it('gives each table of a replaced id its own migrations: the removed table its removal, the created one its creation', async () => {
      const draft = await givenCommittedTables();
      await draft.removeTable(NOTES);
      await draft.createTable(NOTES, labelSchema);

      const [removed, created] = await readTableItems(draft);

      expect(await describedMigrationsOf(draft, removed)).toEqual([
        `remove ${NOTES}`,
      ]);
      expect(await describedMigrationsOf(draft, created)).toEqual([
        `init ${NOTES}`,
      ]);
    });

    it('lists for a table created at the id of a table created and removed inside the Draft only its own creation', async () => {
      const draft = await givenCommittedTables();
      await draft.createTable(TAGS, labelSchema);
      await draft.removeTable(TAGS);
      await draft.createTable(TAGS, labelSchema);
      const pending = await pendingMigrationIds(draft);

      const [item] = await readTableItems(draft);

      expect(await describedMigrationsOf(draft, item)).toEqual([
        `init ${TAGS}`,
      ]);
      expect(migrationIdsOf(item)).toEqual(pending.slice(-1));
    });

    it('lists no migration of a table whose rows alone changed', async () => {
      const draft = await givenCommittedTables();
      await draft.updateRow(PRODUCTS, 'p1', { title: 'edited', price: 1 });

      const [item] = await readTableItems(draft);

      expect(item?.schemaMigrations).toEqual([]);
    });
  });

  describe('rows of a table', () => {
    it('counts the reported rows by change type, a renamed and edited row as renamed and as modified', async () => {
      const draft = await givenCommittedProductRows();
      await draft.updateRow(PRODUCTS, 'p1', { title: 'edited', price: 1 });
      await draft.renameRow(PRODUCTS, 'p2', 'p20');
      await draft.updateRow(PRODUCTS, 'p20', { title: 'edited', price: 2 });
      await draft.removeRow(PRODUCTS, 'p3');
      await draft.createRows(PRODUCTS, { p4: { title: 'four', price: 4 } });

      const [item] = await readTableItems(draft);

      expect(item?.rowsSummary).toEqual({
        total: 4,
        added: 1,
        modified: 2,
        removed: 1,
        renamed: 1,
      });
    });

    it('counts a row that differs only in its row columns', async () => {
      const draft = await givenCommittedProductRows();
      await draft.writeRowColumns(PRODUCTS, 'p1', {
        meta: { note: 'checked' },
      });

      const [item] = await readTableItems(draft);

      expect(item?.rowsSummary).toMatchObject({ total: 1, modified: 1 });
    });

    it.each<{ column: string; columns: RowColumnsEdit }>([
      {
        column: 'publishedAt',
        columns: { publishedAt: '2026-01-01T00:00:00.000Z' },
      },
      { column: 'schemaHash', columns: { schemaHash: 'other' } },
    ])(
      'counts a row that differs only in $column under an unchanged structure as modified',
      async ({ columns }) => {
        const draft = await givenCommittedProductRows();
        await draft.writeRowColumns(PRODUCTS, 'p1', columns);

        const [item] = await readTableItems(draft);

        expect(item?.rowsSummary).toEqual({
          total: 1,
          added: 0,
          modified: 1,
          removed: 0,
          renamed: 0,
        });
      },
    );

    it('counts each edited row once in the table data, however many of its fields changed', async () => {
      const draft = await givenCommittedProductRows();
      await draft.updateRow(PRODUCTS, 'p1', { title: 'edited', price: 10 });
      await draft.updateRow(PRODUCTS, 'p2', { title: 'edited', price: 2 });

      expect(await tableDataRowsOf(draft)).toBe(2);
    });

    it('counts a renamed and edited row once in the table data', async () => {
      const draft = await givenCommittedProductRows();
      await draft.renameRow(PRODUCTS, 'p1', 'p10');
      await draft.updateRow(PRODUCTS, 'p10', { title: 'edited', price: 1 });

      expect(await tableDataRowsOf(draft)).toBe(1);
    });

    it('counts the deleted and the created row of a replaced row, which share one selector, once in the table data', async () => {
      const draft = await givenCommittedProductRows();
      await draft.removeRow(PRODUCTS, 'p1');
      await draft.createRows(PRODUCTS, { p1: { title: 'reused', price: 1 } });

      expect(await tableDataRowsOf(draft)).toBe(1);
    });

    it('counts a deleted row and the rename that took over its id as two rows in the table data', async () => {
      const draft = await givenCommittedProductRows();
      await draft.removeRow(PRODUCTS, 'p1');
      await draft.renameRow(PRODUCTS, 'p2', 'p1');

      expect(await tableDataRowsOf(draft)).toBe(2);
    });

    it('does not count in the table data the rows that only go with the structure', async () => {
      const draft = await givenCommittedProductRows();
      await draft.updateTable(PRODUCTS, [addField('color', str())]);
      await draft.updateRow(PRODUCTS, 'p1', {
        title: 'edited',
        price: 1,
        color: '',
      });

      const [item] = await readTableItems(draft);

      expect(item?.rowsSummary.total).toBe(3);
      expect(item?.selection).toMatchObject({
        tableData: { selector: { tableData: [PRODUCTS] }, rows: 1 },
      });
    });

    it('gives a table without row units no table data', async () => {
      const draft = await givenCommittedProductRows();
      await draft.updateTable(PRODUCTS, [addField('color', str())]);

      const [item] = await readTableItems(draft);

      expect(item?.selection).toMatchObject({ state: 'selectable' });
      expect(item?.selection).not.toHaveProperty('tableData');
    });

    it('gives the rows of a created and a removed table no table data, as they go with the structure', async () => {
      const draft = await givenCommittedProductRows();
      await draft.removeTable(PRODUCTS);
      await draft.createTable(TAGS, labelSchema);
      await draft.createRows(TAGS, { t1: { label: 'one' } });

      const items = await readTableItems(draft);

      expect(
        items.map(({ tableId, rowsSummary, selection }) => ({
          tableId,
          total: rowsSummary.total,
          tableData: 'tableData' in selection,
        })),
      ).toEqual([
        { tableId: PRODUCTS, total: 3, tableData: false },
        { tableId: TAGS, total: 1, tableData: false },
      ]);
    });

    function givenCommittedProductRows(): Promise<ChangesScenario> {
      return ChangesScenario.committed(kit, {
        [PRODUCTS]: {
          schema: productSchema,
          rows: {
            p1: { title: 'one', price: 1 },
            p2: { title: 'two', price: 2 },
            p3: { title: 'three', price: 3 },
          },
        },
      });
    }

    async function tableDataRowsOf(
      draft: ChangesScenario,
    ): Promise<number | undefined> {
      const [item] = await readTableItems(draft);

      return item?.selection.state === 'selectable'
        ? item.selection.tableData?.rows
        : undefined;
    }
  });

  describe('paging', () => {
    it('orders the tables by Draft id, else Head id, by code point, and pages them like one large page', async () => {
      const draft = await ChangesScenario.committed(kit, {
        a: { schema: labelSchema, rows: { r: { label: 'one' } } },
        B: { schema: labelSchema, rows: { r: { label: 'one' } } },
        _x: { schema: labelSchema, rows: { r: { label: 'one' } } },
        Zz: { schema: labelSchema, rows: { r: { label: 'one' } } },
      });

      for (const tableId of ['a', 'B', '_x', 'Zz']) {
        await draft.updateRow(tableId, 'r', { label: 'edited' });
      }

      const onePage = await draft.readDraftTableChanges({ first: 10 });
      const pages = await draft.readEveryDraftTablePage({ first: 1 });

      expect(nodesOf(onePage).map(({ tableId }) => tableId)).toEqual([
        'B',
        'Zz',
        '_x',
        'a',
      ]);
      expect(tableItemsOf(pages)).toEqual(nodesOf(onePage));
      expect(pages.map(({ totalCount }) => totalCount)).toEqual([4, 4, 4, 4]);
      expect(pages.at(-1)?.pageInfo).toEqual({
        hasNextPage: false,
        endCursor: onePage.pageInfo.endCursor,
      });
    });

    it('pages the two items of a replaced table id apart, the removed table first', async () => {
      const draft = await givenCommittedTables();
      await draft.removeTable(NOTES);
      await draft.createTable(NOTES, labelSchema);

      const pages = await draft.readEveryDraftTablePage({ first: 1 });

      expect(pages.map(tableNamesOfPage)).toEqual([
        { tables: [NOTES], totalCount: 2, hasNextPage: true },
        { tables: [NOTES], totalCount: 2, hasNextPage: false },
      ]);
      expect(tableItemsOf(pages).map(({ changeType }) => changeType)).toEqual([
        ChangeType.Removed,
        ChangeType.Added,
      ]);
    });

    it('returns an empty page without a cursor when nothing changed', async () => {
      const draft = await givenCommittedTables();

      const page = await draft.readDraftTableChanges({ first: 10 });

      expect(page).toMatchObject({
        edges: [],
        totalCount: 0,
        pageInfo: { hasNextPage: false, endCursor: null },
      });
    });
  });

  describe('validation', () => {
    it.each<[string, Record<string, unknown>]>([
      ['first of 0', { first: 0 }],
      ['first of 5,001', { first: 5_001 }],
      ['first of 1.5', { first: 1.5 }],
      ['a first that is not a number', { first: '10' }],
      ['an offset cursor', { first: 10, after: '10' }],
      [
        'a cursor naming a row',
        { first: 10, after: cursorOf({ v: 1, tableId: 'a', rowId: 'r' }) },
      ],
      [
        'a cursor of another version',
        { first: 10, after: cursorOf({ v: 2, tableId: 'a', headOnly: false }) },
      ],
      ['an after that is not a string', { first: 10, after: 1 }],
      ['filters that are not an object', { first: 10, filters: [] }],
      [
        'an unknown change type',
        { first: 10, filters: { changeTypes: ['CHANGED'] } },
      ],
      [
        'change types that are not an array',
        { first: 10, filters: { changeTypes: ChangeType.Added } },
      ],
      ['a search that is not a string', { first: 10, filters: { search: 1 } }],
    ])('refuses %s before reading the snapshot', async (_input, options) => {
      const draft = await givenCommittedTables();
      const readSnapshot = jest.spyOn(kit.snapshotReader, 'readSnapshot');

      try {
        await expect(
          draft.readDraftTableChanges(options as { first: number }),
        ).rejects.toThrow(ListingValidationError);
        expect(readSnapshot).not.toHaveBeenCalled();
      } finally {
        readSnapshot.mockRestore();
      }
    });

    it('treats null for every optional input as absent', async () => {
      const draft = await givenCommittedTables();
      await draft.updateRow(PRODUCTS, 'p1', { title: 'edited', price: 1 });

      const withNulls = await draft.readDraftTableChanges({
        first: 10,
        after: null,
        filters: { changeTypes: null, search: null },
      });
      const withNullFilters = await draft.readDraftTableChanges({
        first: 10,
        filters: null,
      });

      expect(withNulls).toEqual(
        await draft.readDraftTableChanges({ first: 10 }),
      );
      expect(withNullFilters).toEqual(withNulls);
    });

    it('raises the native not-found error for an unknown branch', async () => {
      const draft = await givenCommittedTables();

      await expect(
        kit.partialChangesApi.draftTableChanges({
          branch: { ...draft.branch, branchName: 'missing' },
          first: 10,
        }),
      ).rejects.toThrow(
        'A branch with this name does not exist in the project',
      );
    });
  });

  describe('snapshot and cost', () => {
    it('returns the Head and Draft it read, in a read-only repeatable-read transaction', async () => {
      const draft = await givenCommittedTables();
      await draft.updateRow(PRODUCTS, 'p1', { title: 'edited', price: 1 });

      const mode = await transactionModeOfSnapshotRead(kit, () =>
        draft.readDraftTableChanges({ first: 10 }),
      );
      const page = await draft.readDraftTableChanges({ first: 10 });

      expect(mode).toEqual({ readOnly: 'on', isolation: 'repeatable read' });
      expect(page).toMatchObject({
        headRevisionId: await draft.revisionId('head'),
        draftRevisionId: await draft.revisionId('draft'),
        refusedTables: [],
        totalCount: 1,
      });
    });

    it('describes the snapshot it listed when the Draft changes before it reads the details of its tables', async () => {
      const draft = await givenCommittedTables();
      await draft.updateRow(PRODUCTS, 'p1', { title: 'edited', price: 1 });
      await draft.renameTable(ORDERS, PURCHASES);
      const before = await draft.readDraftTableChanges({ first: 10 });

      const page = await readTablePageWhileDraftChanges(
        kit,
        () => draft.readDraftTableChanges({ first: 10 }),
        async () => {
          await draft.createRows(PRODUCTS, { p2: { title: 'two', price: 2 } });
          await draft.updateTable(PURCHASES, [addField('color', str())]);
        },
      );

      expect(page).toEqual(before);
      expect(await draft.readDraftTableChanges({ first: 10 })).not.toEqual(
        before,
      );
    });

    it('reads the row links of each table on the page once, of no table off the page, and no native diff', async () => {
      const draft = await givenCommittedTables();
      await draft.updateRow(ORDERS, 'o1', { label: 'edited' });
      await draft.updateRow(PRODUCTS, 'p1', { title: 'edited', price: 1 });

      const { result, linkSetReads, nativeDiffReads } =
        await draftReadQueriesDuring(
          kit,
          await draft.linkSetsOf([ORDERS, PRODUCTS]),
          () => draft.readDraftTableChanges({ first: 1 }),
        );

      expect(nodesOf(result).map(({ tableId }) => tableId)).toEqual([ORDERS]);
      expect(result.totalCount).toBe(2);
      expect(linkSetReads).toEqual({ [ORDERS]: 1, [PRODUCTS]: 0 });
      expect(nativeDiffReads).toEqual([]);
    });
  });

  async function readTableItems(
    draft: ChangesScenario,
  ): Promise<DraftTableItem[]> {
    return nodesOf(await draft.readDraftTableChanges({ first: 100 }));
  }

  function givenCommittedTables(): Promise<ChangesScenario> {
    return ChangesScenario.committed(kit, {
      [PRODUCTS]: {
        schema: productSchema,
        rows: { p1: { title: 'one', price: 1 } },
      },
      [ORDERS]: { schema: labelSchema, rows: { o1: { label: 'one' } } },
      [NOTES]: { schema: labelSchema, rows: { n1: { label: 'one' } } },
    });
  }
});

type TableSelectionView = [string, ChangeType, TableSelection];

interface IdsView {
  readonly tableId: string;
  readonly previousTableId?: string;
  readonly changeType: ChangeType;
}

interface NativeView {
  readonly tableId: string;
  readonly changeType: ChangeType;
  readonly rows: readonly number[];
}

interface TablePageView {
  readonly tables: readonly string[];
  readonly totalCount: number;
  readonly hasNextPage: boolean;
}

function viewsNamed(name: string): TableViewsData {
  return {
    version: 1,
    defaultViewId: 'default',
    views: [{ id: 'default', name, columns: [{ field: 'data.label' }] }],
  };
}

function nodesOf({ edges }: DraftTablePage): DraftTableItem[] {
  return edges.map(({ node }) => node);
}

function selectionsOf(items: readonly DraftTableItem[]): TableSelectionView[] {
  return items.map(({ tableId, changeType, selection }) => [
    tableId,
    changeType,
    selection,
  ]);
}

function idsOf({
  tableId,
  previousTableId,
  changeType,
}: DraftTableItem): IdsView {
  if (previousTableId === undefined) {
    return { tableId, changeType };
  }

  return { tableId, previousTableId, changeType };
}

function nameOf({ tableId, previousTableId }: DraftTableItem): string {
  if (previousTableId === undefined) {
    return tableId;
  }

  return `${previousTableId} → ${tableId}`;
}

function tableNamesOfPage(page: DraftTablePage): TablePageView {
  return {
    tables: nodesOf(page).map(nameOf),
    totalCount: page.totalCount,
    hasNextPage: page.pageInfo.hasNextPage,
  };
}

function nativeViewOfItem({
  tableId,
  previousTableId,
  changeType,
  rowsSummary,
}: DraftTableItem): NativeView {
  return {
    tableId: previousTableId ?? tableId,
    changeType,
    rows: [
      rowsSummary.total,
      rowsSummary.added,
      rowsSummary.modified,
      rowsSummary.removed,
      rowsSummary.renamed,
    ],
  };
}

function nativeViewOfChange(change: {
  readonly tableId: string;
  readonly changeType: ChangeType;
  readonly rowChangesCount: number;
  readonly addedRowsCount: number;
  readonly modifiedRowsCount: number;
  readonly removedRowsCount: number;
  readonly renamedRowsCount: number;
}): NativeView {
  return {
    tableId: change.tableId,
    changeType: change.changeType,
    rows: [
      change.rowChangesCount,
      change.addedRowsCount,
      change.modifiedRowsCount,
      change.removedRowsCount,
      change.renamedRowsCount,
    ],
  };
}

function byTableId(left: NativeView, right: NativeView): number {
  return left.tableId < right.tableId ? -1 : 1;
}

function cursorOf(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

// Described from the Draft's own ledger rows, so the expectation does not depend on how the reads find them.
async function describedMigrationsOf(
  draft: ChangesScenario,
  item: DraftTableItem | undefined,
): Promise<string[]> {
  const ledger = await storedLedgerOf(draft, 'draft');
  const migrations = new Map(
    ledger.map((migration) => [migration.id, migration]),
  );

  return migrationIdsOf(item).map((migrationId) => {
    const migration = migrations.get(migrationId);

    return migration ? describeMigration(migration) : `unknown ${migrationId}`;
  });
}

function migrationIdsOf(item: DraftTableItem | undefined): string[] {
  return (item?.schemaMigrations ?? []).map(({ migrationId }) => migrationId);
}
