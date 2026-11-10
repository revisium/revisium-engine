import { num, obj, str } from '@revisium/schema-toolkit/mocks';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import { addField, replaceField } from 'src/__tests__/fixtures/ledger-steps';
import { ListingValidationError } from 'src/features/partial-changes/listing/listing-validation-error';
import type { DraftTableChangesFilters } from 'src/features/partial-changes/queries/impl/draft-reads';
import type { DraftChangesSummary } from 'src/features/partial-changes/queries/impl/get-draft-changes-summary.query';
import { ChangeType } from 'src/features/revision-changes/types';
import type { TableViewsData } from 'src/features/views/types';
import { transactionModeOfSnapshotRead } from '../../__tests__/support/change-preview';
import { readSummaryWhileDraftChanges } from '../../__tests__/support/draft-read-races';
import { ChangesScenario } from '../../__tests__/support/changes-scenario';
import {
  draftReadQueriesDuring,
  tableItemsOf,
} from '../../__tests__/support/draft-reading';
import {
  describedStructureRef,
  sharedSchemaRef,
  viewsRef,
} from '../../__tests__/support/expected-unit-refs';

const PRODUCTS = 'products';
const GOODS = 'goods';
const NOTES = 'notes';
const SCRATCH = 'scratch';
const TAGS = 'tags';
const ADDRESS = 'address';
const CONTACT = 'contact';
const PHONE = 'phone';

const productSchema = obj({ title: str() });
const pricedSchema = obj({ title: str(), price: num() });
const addressSchema = obj({ city: str() });
const productViews: TableViewsData = {
  version: 1,
  defaultViewId: 'default',
  views: [
    { id: 'default', name: 'Titles', columns: [{ field: 'data.title' }] },
  ],
};

const EVERY_SUMMARY_ITEM = [
  `transient ${SCRATCH}`,
  `views ${PRODUCTS}`,
  `shared ${ADDRESS}`,
  `shared ${CONTACT}`,
  `shared ${PHONE}`,
];

describe('draft changes summary', () => {
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

  describe('counts', () => {
    it('returns the Head and Draft it read and counts the rows that differ only in row columns', async () => {
      const draft = await givenCommittedProducts();
      await draft.writeRowColumns(PRODUCTS, 'p1', {
        meta: { note: 'checked' },
      });

      const summary = await draft.readDraftChangesSummary();

      expect(summary).toMatchObject({
        headRevisionId: await draft.revisionId('head'),
        draftRevisionId: await draft.revisionId('draft'),
        refusedTables: [],
        rowsSummary: {
          total: 1,
          added: 0,
          modified: 1,
          removed: 0,
          renamed: 0,
        },
        rowsWithUnits: 1,
      });
    });

    it('does not count the rows that a description-only schema update only rewrote with its schema hash', async () => {
      const draft = await givenCommittedProducts();
      await draft.updateTable(PRODUCTS, [
        replaceField('title', { ...str(), description: 'Shown in lists' }),
      ]);

      const summary = await draft.readDraftChangesSummary();

      expect(summary.rowsSummary.total).toBe(0);
      expect(summary.tablesSummary.total).toBe(1);
    });

    it('counts a table that was only renamed as renamed and not as modified', async () => {
      const draft = await givenCommittedProducts();
      await draft.renameTable(PRODUCTS, GOODS);

      const summary = await draft.readDraftChangesSummary();

      expect(summary.tablesSummary).toEqual({
        total: 1,
        added: 0,
        modified: 0,
        removed: 0,
        renamed: 1,
        replaced: 0,
      });
    });

    it('counts a replaced table id once and its two tables as added and removed', async () => {
      const draft = await givenCommittedProducts();
      await draft.removeTable(PRODUCTS);
      await draft.createTable(PRODUCTS, productSchema);

      const summary = await draft.readDraftChangesSummary();

      expect(summary.tablesSummary).toEqual({
        total: 2,
        added: 1,
        modified: 0,
        removed: 1,
        renamed: 0,
        replaced: 1,
      });
    });

    it('counts as rows with units the sum of the table data rows of the tables', async () => {
      const draft = await ChangesScenario.committed(kit, {
        [PRODUCTS]: {
          schema: pricedSchema,
          rows: {
            p1: { title: 'one', price: 1 },
            p2: { title: 'two', price: 2 },
          },
        },
        [NOTES]: { schema: productSchema, rows: { n1: { title: 'one' } } },
      });
      await draft.updateRow(PRODUCTS, 'p1', { title: 'edited', price: 1 });
      await draft.removeRow(PRODUCTS, 'p2');
      await draft.createRows(PRODUCTS, { p2: { title: 'again', price: 2 } });
      await draft.updateTable(NOTES, [addField('color', str())]);
      await draft.updateRow(NOTES, 'n1', { title: 'edited', color: '' });

      const summary = await draft.readDraftChangesSummary();
      const items = tableItemsOf(
        await draft.readEveryDraftTablePage({ first: 1 }),
      );

      expect(summary.rowsWithUnits).toBe(3);
      expect(
        items.map(({ selection }) =>
          selection.state === 'selectable' ? selection.tableData?.rows : 0,
        ),
      ).toEqual([1, 2]);
    });

    it('agrees with the native summary in its counts', async () => {
      const draft = await ChangesScenario.committed(kit, {
        [PRODUCTS]: {
          schema: pricedSchema,
          rows: { p1: { title: 'one', price: 1 } },
        },
        [NOTES]: { schema: productSchema, rows: { n1: { title: 'one' } } },
        [GOODS]: { schema: productSchema, rows: { g1: { title: 'one' } } },
      });
      await draft.updateRow(PRODUCTS, 'p1', { title: 'edited', price: 1 });
      await draft.createRows(PRODUCTS, { p2: { title: 'two', price: 2 } });
      await draft.removeTable(NOTES);
      await draft.renameTable(GOODS, TAGS);
      await draft.updateRow(TAGS, 'g1', { title: 'edited' });

      const summary = await draft.readDraftChangesSummary();
      const native = await draft.readNativeSummary();

      expect(summary.rowsSummary).toEqual(native.rowsSummary);
      expect(summary.tablesSummary).toEqual({
        ...native.tablesSummary,
        replaced: 0,
      });
    });

    it('counts the tables of each change type as the table filter of that change type lists them', async () => {
      const draft = await ChangesScenario.committed(kit, {
        [PRODUCTS]: { schema: productSchema, rows: { p1: { title: 'one' } } },
        [NOTES]: { schema: productSchema, rows: { n1: { title: 'one' } } },
        [GOODS]: { schema: productSchema, rows: { g1: { title: 'one' } } },
        [SCRATCH]: { schema: productSchema, rows: {} },
        [ADDRESS]: { schema: productSchema, rows: {} },
      });
      await draft.updateRow(PRODUCTS, 'p1', { title: 'edited' });
      await draft.renameTable(NOTES, PHONE);
      await draft.renameTable(GOODS, CONTACT);
      await draft.updateRow(CONTACT, 'g1', { title: 'edited' });
      await draft.removeTable(SCRATCH);
      await draft.removeTable(ADDRESS);
      await draft.createTable(ADDRESS, productSchema);
      await draft.createTable(TAGS, productSchema);

      const summary = await draft.readDraftChangesSummary();
      const totals = await tableTotalsByChangeType(draft);

      expect(summary.tablesSummary).toEqual({
        total: 7,
        added: 2,
        modified: 2,
        removed: 2,
        renamed: 2,
        replaced: 1,
      });
      expect(totals).toEqual({
        [ChangeType.Added]: 2,
        [ChangeType.Modified]: 2,
        [ChangeType.Removed]: 2,
        [ChangeType.Renamed]: 2,
        [ChangeType.RenamedAndModified]: 1,
      });
    });
  });

  describe('items', () => {
    it('lists a table created and removed inside the Draft with its transient structure unit as ADDED', async () => {
      const draft = await givenCommittedProducts();
      await draft.createTable(SCRATCH, productSchema);
      await draft.removeTable(SCRATCH);

      const summary = await draft.readDraftChangesSummary();

      expect(summary.tablesSummary.total).toBe(0);
      expect(summary.transientTables).toEqual([
        {
          tableId: SCRATCH,
          changeType: ChangeType.Added,
          structure: describedStructureRef(
            { table: 'transient', fields: [], views: false },
            SCRATCH,
          ),
        },
      ]);
    });

    it('lists added, modified and removed shared schemas with their units', async () => {
      const draft = await givenCommittedProducts();
      await givenSharedSchemasOfEveryChange(draft);

      const summary = await draft.readDraftChangesSummary();

      expect(summary.sharedSchemas).toEqual([
        {
          sharedSchemaId: ADDRESS,
          changeType: ChangeType.Modified,
          unit: sharedSchemaRef(ADDRESS),
        },
        {
          sharedSchemaId: CONTACT,
          changeType: ChangeType.Added,
          unit: sharedSchemaRef(CONTACT),
        },
        {
          sharedSchemaId: PHONE,
          changeType: ChangeType.Removed,
          unit: sharedSchemaRef(PHONE),
        },
      ]);
    });

    it('lists a table whose only change is a views edit with its views unit as MODIFIED', async () => {
      const draft = await givenCommittedProducts();
      await draft.updateViews(PRODUCTS, productViews);

      const summary = await draft.readDraftChangesSummary();

      expect(summary.tablesSummary.total).toBe(0);
      expect(summary.viewsOnlyTables).toEqual([
        {
          tableId: PRODUCTS,
          changeType: ChangeType.Modified,
          views: viewsRef(PRODUCTS),
        },
      ]);
    });

    it('returns every refused table', async () => {
      const draft = await ChangesScenario.committedWithoutLedger(kit, {
        [TAGS]: { schema: productSchema, rows: { t1: { title: 'one' } } },
      });
      await draft.updateRow(TAGS, 't1', { title: 'edited' });

      const summary = await draft.readDraftChangesSummary();

      expect(summary).toMatchObject({
        refusedTables: [{ tableId: TAGS, code: 'unledgeredTable' }],
        rowsSummary: { total: 1, modified: 1 },
        rowsWithUnits: 0,
      });
    });
  });

  describe('filters and input', () => {
    it.each<{ filters: DraftTableChangesFilters; items: string[] }>([
      {
        filters: { changeTypes: [ChangeType.Added] },
        items: [`transient ${SCRATCH}`, `shared ${CONTACT}`],
      },
      {
        filters: { changeTypes: [ChangeType.Removed] },
        items: [`shared ${PHONE}`],
      },
      {
        filters: { changeTypes: [ChangeType.Modified] },
        items: [`views ${PRODUCTS}`, `shared ${ADDRESS}`],
      },
      { filters: { changeTypes: [ChangeType.Renamed] }, items: [] },
      { filters: { changeTypes: [] }, items: [] },
      { filters: { changeTypes: [ChangeType.RenamedAndModified] }, items: [] },
      {
        filters: { changeTypes: [ChangeType.Added, ChangeType.Removed] },
        items: [`transient ${SCRATCH}`, `shared ${CONTACT}`, `shared ${PHONE}`],
      },
      { filters: { search: 'SCR' }, items: [`transient ${SCRATCH}`] },
      {
        filters: { search: 'o' },
        items: [`views ${PRODUCTS}`, `shared ${CONTACT}`, `shared ${PHONE}`],
      },
      {
        filters: { changeTypes: [ChangeType.Modified], search: 'add' },
        items: [`shared ${ADDRESS}`],
      },
      {
        filters: { changeTypes: null, search: null },
        items: EVERY_SUMMARY_ITEM,
      },
    ])(
      'lists with $filters the items whose change type and id the table filters match',
      async ({ filters, items }) => {
        const draft = await givenEveryKindOfSummaryItem();

        const summary = await draft.readDraftChangesSummary({ filters });

        expect(summaryItemsOf(summary)).toEqual(items);
      },
    );

    it('keeps every count whatever the filters, each count of the tables the total of the table filter of its change type', async () => {
      const draft = await givenEveryKindOfSummaryItem();

      const summary = await draft.readDraftChangesSummary();
      const filtered = await draft.readDraftChangesSummary({
        filters: { changeTypes: [ChangeType.Removed], search: 'phone' },
      });
      const totals = await tableTotalsByChangeType(draft);

      expect(summaryItemsOf(filtered)).toEqual([`shared ${PHONE}`]);
      expect(countsOf(filtered)).toEqual(countsOf(summary));
      expect(countsOf(summary)).toMatchObject({
        sharedSchemasCount: 3,
        transientTablesCount: 1,
        viewsOnlyTablesCount: 1,
      });
      expect(summary.tablesSummary).toEqual({
        total: 1,
        added: totals[ChangeType.Added],
        modified: totals[ChangeType.Modified],
        removed: totals[ChangeType.Removed],
        renamed: totals[ChangeType.Renamed],
        replaced: 0,
      });
    });

    it('treats null filters as absent', async () => {
      const draft = await givenEveryKindOfSummaryItem();

      expect(await draft.readDraftChangesSummary({ filters: null })).toEqual(
        await draft.readDraftChangesSummary(),
      );
    });

    it('raises the native not-found error for an unknown branch', async () => {
      const draft = await givenCommittedProducts();

      await expect(
        kit.partialChangesApi.draftChangesSummary({
          branch: { ...draft.branch, branchName: 'missing' },
        }),
      ).rejects.toThrow(
        'A branch with this name does not exist in the project',
      );
    });

    it.each<[string, Record<string, unknown>]>([
      ['filters that are not an object', { filters: 'all' }],
      ['an unknown change type', { filters: { changeTypes: ['CHANGED'] } }],
      ['a search that is not a string', { filters: { search: true } }],
    ])('refuses %s before reading the snapshot', async (_input, options) => {
      const draft = await givenCommittedProducts();
      const readSnapshot = jest.spyOn(kit.snapshotReader, 'readSnapshot');

      try {
        await expect(
          draft.readDraftChangesSummary(
            options as { filters?: DraftTableChangesFilters },
          ),
        ).rejects.toThrow(ListingValidationError);
        expect(readSnapshot).not.toHaveBeenCalled();
      } finally {
        readSnapshot.mockRestore();
      }
    });
  });

  describe('snapshot and cost', () => {
    it('reads one snapshot in a read-only repeatable-read transaction', async () => {
      const draft = await givenCommittedProducts();

      const mode = await transactionModeOfSnapshotRead(kit, () =>
        draft.readDraftChangesSummary(),
      );

      expect(mode).toEqual({ readOnly: 'on', isolation: 'repeatable read' });
    });

    it('describes the snapshot it read when the Draft changes before it counts the rows of its tables', async () => {
      const draft = await givenCommittedProducts();
      await draft.updateRow(PRODUCTS, 'p1', { title: 'edited' });
      const before = await draft.readDraftChangesSummary();

      const summary = await readSummaryWhileDraftChanges(
        kit,
        () => draft.readDraftChangesSummary(),
        async () => {
          await draft.createRows(PRODUCTS, { p2: { title: 'two' } });
          await draft.createTable(TAGS, productSchema);
        },
      );

      expect(summary).toEqual(before);
      expect(await draft.readDraftChangesSummary()).not.toEqual(before);
    });

    it('reads the row links of every changed table once, and no native diff', async () => {
      const draft = await givenCommittedProducts();
      await draft.updateRow(PRODUCTS, 'p1', { title: 'edited' });
      await draft.createTable(TAGS, productSchema);
      await draft.createRows(TAGS, { t1: { title: 'one' } });

      const { result, linkSetReads, nativeDiffReads } =
        await draftReadQueriesDuring(
          kit,
          await draft.linkSetsOf([PRODUCTS, TAGS]),
          () => draft.readDraftChangesSummary(),
        );

      expect(result.rowsSummary).toEqual({
        total: 2,
        added: 1,
        modified: 1,
        removed: 0,
        renamed: 0,
      });
      expect(linkSetReads).toEqual({ [PRODUCTS]: 1, [TAGS]: 1 });
      expect(nativeDiffReads).toEqual([]);
    });
  });

  function givenCommittedProducts(): Promise<ChangesScenario> {
    return ChangesScenario.committed(kit, {
      [PRODUCTS]: { schema: productSchema, rows: { p1: { title: 'one' } } },
    });
  }

  async function givenEveryKindOfSummaryItem(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [PRODUCTS]: { schema: productSchema, rows: { p1: { title: 'one' } } },
      [NOTES]: { schema: productSchema, rows: { n1: { title: 'one' } } },
    });
    await givenSharedSchemasOfEveryChange(draft);
    await draft.createTable(SCRATCH, productSchema);
    await draft.removeTable(SCRATCH);
    await draft.updateViews(PRODUCTS, productViews);
    await draft.updateRow(NOTES, 'n1', { title: 'edited' });

    return draft;
  }

  async function givenSharedSchemasOfEveryChange(
    draft: ChangesScenario,
  ): Promise<void> {
    await draft.createSharedSchema(ADDRESS, addressSchema);
    await draft.createSharedSchema(PHONE, addressSchema);
    await draft.commit();
    await draft.updateSharedSchema(ADDRESS, obj({ city: str(), zip: str() }));
    await draft.removeSharedSchema(PHONE);
    await draft.createSharedSchema(CONTACT, addressSchema);
  }

  async function tableTotalsByChangeType(
    draft: ChangesScenario,
  ): Promise<Record<ChangeType, number>> {
    const totals: Partial<Record<ChangeType, number>> = {};

    for (const changeType of Object.values(ChangeType)) {
      const { totalCount } = await draft.readDraftTableChanges({
        first: 1,
        filters: { changeTypes: [changeType] },
      });

      totals[changeType] = totalCount;
    }

    return totals as Record<ChangeType, number>;
  }
});

function summaryItemsOf({
  transientTables,
  viewsOnlyTables,
  sharedSchemas,
}: DraftChangesSummary): string[] {
  return [
    ...transientTables.map(({ tableId }) => `transient ${tableId}`),
    ...viewsOnlyTables.map(({ tableId }) => `views ${tableId}`),
    ...sharedSchemas.map(({ sharedSchemaId }) => `shared ${sharedSchemaId}`),
  ];
}

function countsOf({
  tablesSummary,
  rowsSummary,
  rowsWithUnits,
  sharedSchemasCount,
  transientTablesCount,
  viewsOnlyTablesCount,
}: DraftChangesSummary): Partial<DraftChangesSummary> {
  return {
    tablesSummary,
    rowsSummary,
    rowsWithUnits,
    sharedSchemasCount,
    transientTablesCount,
    viewsOnlyTablesCount,
  };
}
