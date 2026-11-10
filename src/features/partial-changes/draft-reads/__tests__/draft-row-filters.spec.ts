import { num, obj, str } from '@revisium/schema-toolkit/mocks';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import { ListingValidationError } from 'src/features/partial-changes/listing/listing-validation-error';
import type {
  DraftRowChangesFilters,
  DraftRowItem,
} from 'src/features/partial-changes/queries/impl/get-draft-row-changes.query';
import { ChangeType } from 'src/features/revision-changes/types';
import { ChangesScenario } from '../../__tests__/support/changes-scenario';
import {
  draftReadQueriesDuring,
  rowItemsOf,
} from '../../__tests__/support/draft-reading';
import {
  existenceRef,
  headSideDeletionRef,
  renameRef,
} from '../../__tests__/support/expected-unit-refs';

const PRODUCTS = 'products';
const GOODS = 'goods';
const TAGS = 'tags';
const NOTES = 'notes';
const PAGE_SIZES = [1, 2, 7];

const productSchema = obj({ title: str(), price: num() });
const labelSchema = obj({ label: str() });

describe('Draft row filters', () => {
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

  describe('table id (DR-16)', () => {
    it('lists the rows of both tables of a replaced id, and no other table', async () => {
      const draft = await givenCommittedProductsAndTags();
      await draft.removeTable(PRODUCTS);
      await draft.createTable(PRODUCTS, productSchema);
      await draft.createRows(PRODUCTS, { p9: product('new') });
      await draft.updateRow(TAGS, 't1', { label: 'edited' });

      const items = await readFiltered(draft, { tableId: PRODUCTS });

      expect(items.map(nameOf)).toEqual([
        'products/p1 REMOVED',
        'products/p2 REMOVED',
        'products/p9 ADDED',
      ]);
    });

    it('selects a renamed table by its Draft id, and by its Head id while no table item shows that id', async () => {
      const draft = await givenCommittedProductsAndTags();
      await draft.renameTable(PRODUCTS, GOODS);
      await draft.updateRow(GOODS, 'p1', product('edited'));

      const byDraftId = await readFiltered(draft, { tableId: GOODS });
      const byHeadId = await readFiltered(draft, { tableId: PRODUCTS });

      expect(byDraftId.map(idsOf)).toEqual([['goods', 'products', 'p1']]);
      expect(byHeadId).toEqual(byDraftId);
    });

    it("selects only the table that holds a renamed table's Head id now", async () => {
      const draft = await givenCommittedProductsAndTags();
      await draft.renameTable(PRODUCTS, GOODS);
      await draft.updateRow(GOODS, 'p1', product('edited'));
      await draft.createTable(PRODUCTS, productSchema);
      await draft.createRows(PRODUCTS, { p9: product('new') });

      const items = await readFiltered(draft, { tableId: PRODUCTS });

      expect(items.map(nameOf)).toEqual(['products/p9 ADDED']);
    });

    it('lists nothing for an id that no listed table has', async () => {
      const draft = await givenCommittedProductsAndTags();
      await draft.updateRow(PRODUCTS, 'p1', product('edited'));

      const page = await draft.readDraftRowChanges({
        first: 10,
        filters: { tableId: NOTES },
      });

      expect(page.edges).toEqual([]);
      expect(page.pageInfo).toEqual({ hasNextPage: false, endCursor: null });
    });
  });

  describe('change types (DR-16)', () => {
    it('matches RENAMED_AND_MODIFIED by RENAMED and by MODIFIED, and each other type by itself', async () => {
      const draft = await givenAllRowChangeTypes();

      expect(
        (await readFiltered(draft, { changeTypes: [ChangeType.Renamed] })).map(
          nameOf,
        ),
      ).toEqual(['products/p20 RENAMED', 'products/p30 RENAMED_AND_MODIFIED']);
      expect(
        (await readFiltered(draft, { changeTypes: [ChangeType.Modified] })).map(
          nameOf,
        ),
      ).toEqual(['products/p1 MODIFIED', 'products/p30 RENAMED_AND_MODIFIED']);
      expect(
        (
          await readFiltered(draft, {
            changeTypes: [ChangeType.RenamedAndModified],
          })
        ).map(nameOf),
      ).toEqual(['products/p30 RENAMED_AND_MODIFIED']);
      expect(
        (
          await readFiltered(draft, {
            changeTypes: [ChangeType.Added, ChangeType.Removed],
          })
        ).map(nameOf),
      ).toEqual(['products/p4 REMOVED', 'products/p9 ADDED']);
    });

    it('lists nothing for an empty list of change types, reading no table', async () => {
      const draft = await givenAllRowChangeTypes();

      const { result, linkSetReads } = await draftReadQueriesDuring(
        kit,
        await draft.linkSetsOf([PRODUCTS]),
        () =>
          draft.readDraftRowChanges({
            first: 10,
            filters: { changeTypes: [] },
          }),
      );

      expect(result.edges).toEqual([]);
      expect(result.pageInfo).toEqual({ hasNextPage: false, endCursor: null });
      expect(linkSetReads).toEqual({ [PRODUCTS]: 0 });
    });
  });

  describe('search (DR-16)', () => {
    it('matches a case-insensitive substring of the Head or the Draft row id', async () => {
      const draft = await givenCommittedProductsAndTags();
      await draft.renameRow(PRODUCTS, 'p1', 'item1');
      await draft.updateRow(PRODUCTS, 'p2', product('edited'));

      expect((await readFiltered(draft, { search: 'P1' })).map(idsOf)).toEqual([
        ['products', undefined, 'item1', 'p1'],
      ]);
      expect(
        (await readFiltered(draft, { search: 'ITEM' })).map(idsOf),
      ).toEqual([['products', undefined, 'item1', 'p1']]);
      expect((await readFiltered(draft, { search: 'p' })).map(nameOf)).toEqual([
        'products/item1 RENAMED',
        'products/p2 MODIFIED',
      ]);
    });

    it("treats '_' and '%' as plain characters, not as wildcards", async () => {
      const draft = await ChangesScenario.committed(kit, {
        [PRODUCTS]: {
          schema: productSchema,
          rows: { a_b: product('a'), axb: product('b'), A_B2: product('c') },
        },
      });
      await draft.updateRow(PRODUCTS, 'a_b', product('edited'));
      await draft.updateRow(PRODUCTS, 'axb', product('edited'));
      await draft.updateRow(PRODUCTS, 'A_B2', product('edited'));

      expect((await readFiltered(draft, { search: '_' })).map(nameOf)).toEqual([
        'products/A_B2 MODIFIED',
        'products/a_b MODIFIED',
      ]);
      expect(
        (await readFiltered(draft, { search: 'a_b' })).map(nameOf),
      ).toEqual(['products/A_B2 MODIFIED', 'products/a_b MODIFIED']);
      expect(await readFiltered(draft, { search: '%' })).toEqual([]);
      expect(await readFiltered(draft, { search: 'a%b' })).toEqual([]);
    });
  });

  describe('units of a filtered page', () => {
    it('gives a deleted row whose id a rename took over its Head-side deletion and the takeover when the filter leaves out the rename', async () => {
      const draft = await givenCommittedProductsAndTags();
      await draft.removeRow(PRODUCTS, 'p1');
      await draft.renameRow(PRODUCTS, 'p2', 'p1');
      const takeover = {
        deletion: headSideDeletionRef(PRODUCTS, 'p1'),
        rename: renameRef(PRODUCTS, 'p1', 'p2'),
      };

      const [deleted] = await readFiltered(draft, {
        changeTypes: [ChangeType.Removed],
      });
      const [renamed] = await readFiltered(draft, {
        changeTypes: [ChangeType.Renamed],
      });

      expect(deleted?.selection.units).toEqual([takeover.deletion]);
      expect(deleted?.idTakeover).toEqual(takeover);
      expect(renamed?.selection.units).toEqual([takeover.rename]);
      expect(renamed?.idTakeover).toEqual(takeover);
    });

    it('gives each item of a replaced row the replace unit when the filter leaves out the other item', async () => {
      const draft = await givenCommittedProductsAndTags();
      await draft.removeRow(PRODUCTS, 'p1');
      await draft.createRows(PRODUCTS, { p1: product('reused') });
      const replace = existenceRef('rowReplace', PRODUCTS, 'p1');

      const [deleted] = await readFiltered(draft, {
        changeTypes: [ChangeType.Removed],
      });
      const [created] = await readFiltered(draft, {
        changeTypes: [ChangeType.Added],
      });

      expect(deleted?.selection.units).toEqual([replace]);
      expect(created?.selection.units).toEqual([replace]);
    });

    it('gives a rename into the id of a deleted row its takeover when a search matches only the rename, by its Head id', async () => {
      const draft = await givenCommittedProductsAndTags();
      await draft.removeRow(PRODUCTS, 'p1');
      await draft.renameRow(PRODUCTS, 'p2', 'p1');
      const all = await readFiltered(draft, {});

      const items = await readFiltered(draft, { search: 'p2' });

      expect(items.map(nameOf)).toEqual(['products/p1 RENAMED']);
      expect(items).toEqual(
        all.filter(({ changeType }) => changeType === ChangeType.Renamed),
      );
    });

    it('gives a filtered rename the id exchange of the unfiltered read, on every page size', async () => {
      const draft = await ChangesScenario.committed(kit, {
        [PRODUCTS]: {
          schema: productSchema,
          rows: {
            ka: product('a'),
            kb: product('b'),
            kc: product('c'),
            x1: product('x1'),
            x2: product('x2'),
          },
        },
      });
      await draft.renameRowsAtOnce(PRODUCTS, [
        ['ka', 'kb'],
        ['kb', 'kc'],
        ['kc', 'ka'],
      ]);
      await draft.renameRow(PRODUCTS, 'x2', 'x3');
      await draft.renameRow(PRODUCTS, 'x1', 'x2');
      await draft.updateRow(PRODUCTS, 'x2', product('edited'));
      const all = await readFiltered(draft, {});
      const cases: [DraftRowChangesFilters, string[]][] = [
        [{ changeTypes: [ChangeType.RenamedAndModified] }, ['products/x2']],
        [{ search: 'kb' }, ['products/kb', 'products/kc']],
      ];

      for (const [filters, rows] of cases) {
        const expected = all.filter((item) =>
          rows.includes(`${item.tableId}/${item.rowId}`),
        );

        expect(expected.every(({ idExchange }) => idExchange)).toBe(true);

        for (const first of [1, 100]) {
          expect(
            rowItemsOf(await draft.readEveryDraftRowPage({ first, filters })),
          ).toEqual(expected);
        }
      }
    });

    it('lists under each filter exactly the items of the unfiltered read that it matches', async () => {
      const draft = await givenAllRowChangeTypes();
      await draft.removeRow(PRODUCTS, 'p5');
      await draft.renameRow(PRODUCTS, 'p6', 'p5');
      const all = await readFiltered(draft, {});

      for (const changeType of Object.values(ChangeType)) {
        expect(
          await readFiltered(draft, { changeTypes: [changeType] }),
        ).toEqual(all.filter((item) => matchesType(item, changeType)));
      }
    });
  });

  describe('paging (DR-15)', () => {
    it('pages a filtered read like one large filtered page, never splitting the two items of one row id', async () => {
      const draft = await givenAllRowChangeTypes();
      await draft.removeRow(PRODUCTS, 'p5');
      await draft.createRows(PRODUCTS, { p5: product('reused') });
      const filters: DraftRowChangesFilters = {
        changeTypes: [ChangeType.Added, ChangeType.Removed],
      };
      const all = await readFiltered(draft, filters);

      for (const first of PAGE_SIZES) {
        const pages = await draft.readEveryDraftRowPage({ first, filters });

        expect(rowItemsOf(pages)).toEqual(all);
      }

      expect(all.map(nameOf)).toEqual([
        'products/p4 REMOVED',
        'products/p5 REMOVED',
        'products/p5 ADDED',
        'products/p9 ADDED',
      ]);
    });

    it('says a next page follows only when a matching row follows the page', async () => {
      const draft = await givenCommittedProductsAndTags();
      await draft.updateRow(PRODUCTS, 'p1', product('edited'));
      await draft.createRows(PRODUCTS, { p9: product('new') });
      await draft.updateRow(TAGS, 't1', { label: 'edited' });

      const page = await draft.readDraftRowChanges({
        first: 1,
        filters: { changeTypes: [ChangeType.Modified] },
      });
      const last = await draft.readDraftRowChanges({
        first: 1,
        after: page.pageInfo.endCursor,
        filters: { changeTypes: [ChangeType.Modified] },
      });
      const added = await draft.readDraftRowChanges({
        first: 1,
        filters: { changeTypes: [ChangeType.Added] },
      });
      const ofProducts = await draft.readDraftRowChanges({
        first: 1,
        filters: { tableId: PRODUCTS, changeTypes: [ChangeType.Modified] },
      });

      expect(rowItemsOf([page]).map(nameOf)).toEqual(['products/p1 MODIFIED']);
      expect(page.pageInfo.hasNextPage).toBe(true);
      expect(rowItemsOf([ofProducts]).map(nameOf)).toEqual([
        'products/p1 MODIFIED',
      ]);
      expect(ofProducts.pageInfo.hasNextPage).toBe(false);
      expect(rowItemsOf([last]).map(nameOf)).toEqual(['tags/t1 MODIFIED']);
      expect(last.pageInfo.hasNextPage).toBe(false);
      expect(rowItemsOf([added]).map(nameOf)).toEqual(['products/p9 ADDED']);
      expect(added.pageInfo.hasNextPage).toBe(false);
    });
  });

  describe('cost', () => {
    it('reads the row links of the tables a table id selects only', async () => {
      const draft = await givenCommittedProductsAndTags();
      await draft.updateRow(PRODUCTS, 'p1', product('edited'));
      await draft.updateRow(TAGS, 't1', { label: 'edited' });

      const { result, linkSetReads } = await draftReadQueriesDuring(
        kit,
        await draft.linkSetsOf([PRODUCTS, TAGS]),
        () =>
          draft.readDraftRowChanges({ first: 10, filters: { tableId: TAGS } }),
      );

      expect(rowItemsOf([result]).map(nameOf)).toEqual(['tags/t1 MODIFIED']);
      expect(linkSetReads).toEqual({ [PRODUCTS]: 0, [TAGS]: 1 });
    });

    it('reads one statement per table it reads, and no table whose rows the change types leave out', async () => {
      const draft = await givenCommittedProductsAndTags();
      await draft.removeRow(PRODUCTS, 'p1');
      await draft.renameRow(PRODUCTS, 'p2', 'p1');
      await draft.createTable(NOTES, labelSchema);
      await draft.createRows(NOTES, { n1: { label: 'new' } });
      await draft.updateRow(TAGS, 't1', { label: 'edited' });

      const { result, linkSetReads } = await draftReadQueriesDuring(
        kit,
        await draft.linkSetsOf([NOTES, PRODUCTS, TAGS]),
        () =>
          draft.readDraftRowChanges({
            first: 10,
            filters: { changeTypes: [ChangeType.Removed, ChangeType.Modified] },
          }),
      );

      expect(rowItemsOf([result]).map(nameOf)).toEqual([
        'products/p1 REMOVED',
        'tags/t1 MODIFIED',
      ]);
      expect(linkSetReads).toEqual({ [NOTES]: 0, [PRODUCTS]: 1, [TAGS]: 1 });
    });
    it('reads every table once when a filter leaves the page unfilled', async () => {
      const draft = await givenCommittedProductsAndTags();
      await draft.updateRow(PRODUCTS, 'p1', product('edited'));
      await draft.createTable(NOTES, labelSchema);
      await draft.createRows(NOTES, { n1: { label: 'new' } });
      await draft.updateRow(TAGS, 't1', { label: 'edited' });

      const { result, linkSetReads } = await draftReadQueriesDuring(
        kit,
        await draft.linkSetsOf([NOTES, PRODUCTS, TAGS]),
        () =>
          draft.readDraftRowChanges({ first: 10, filters: { search: 't1' } }),
      );

      expect(rowItemsOf([result]).map(nameOf)).toEqual(['tags/t1 MODIFIED']);
      expect(linkSetReads).toEqual({ [NOTES]: 1, [PRODUCTS]: 1, [TAGS]: 1 });
    });
  });

  describe('validation', () => {
    it.each<[string, unknown]>([
      ['filters that are not an object', 'products'],
      ['filters that are an array', []],
      ['a table id that is not a string', { tableId: 1 }],
      ['change types that are not an array', { changeTypes: 'ADDED' }],
      ['an unknown change type', { changeTypes: ['MOVED'] }],
      ['a search that is not a string', { search: 1 }],
      ['a search with the NUL character', { search: 'p\u00001' }],
    ])('refuses %s before reading the snapshot', async (_input, filters) => {
      const draft = await givenCommittedProductsAndTags();
      const readSnapshot = jest.spyOn(kit.snapshotReader, 'readSnapshot');

      try {
        await expect(
          draft.readDraftRowChanges({
            first: 10,
            filters: filters as DraftRowChangesFilters,
          }),
        ).rejects.toThrow(ListingValidationError);
        expect(readSnapshot).not.toHaveBeenCalled();
      } finally {
        readSnapshot.mockRestore();
      }
    });

    it('treats null filters and null filter fields as absent', async () => {
      const draft = await givenCommittedProductsAndTags();
      await draft.updateRow(PRODUCTS, 'p1', product('edited'));
      const unfiltered = await draft.readDraftRowChanges({ first: 10 });

      expect(
        await draft.readDraftRowChanges({ first: 10, filters: null }),
      ).toEqual(unfiltered);
      expect(
        await draft.readDraftRowChanges({
          first: 10,
          filters: { tableId: null, changeTypes: null, search: null },
        }),
      ).toEqual(unfiltered);
    });
  });

  async function readFiltered(
    draft: ChangesScenario,
    filters: DraftRowChangesFilters,
  ): Promise<DraftRowItem[]> {
    return rowItemsOf([
      await draft.readDraftRowChanges({ first: 5_000, filters }),
    ]);
  }

  function givenCommittedProductsAndTags(): Promise<ChangesScenario> {
    return ChangesScenario.committed(kit, {
      [PRODUCTS]: {
        schema: productSchema,
        rows: { p1: product('p1'), p2: product('p2') },
      },
      [TAGS]: { schema: labelSchema, rows: { t1: { label: 'one' } } },
    });
  }

  // One row of every change type in one table.
  async function givenAllRowChangeTypes(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [PRODUCTS]: {
        schema: productSchema,
        rows: {
          p1: product('p1'),
          p2: product('p2'),
          p3: product('p3'),
          p4: product('p4'),
          p5: product('p5'),
          p6: product('p6'),
        },
      },
    });
    await draft.updateRow(PRODUCTS, 'p1', product('edited'));
    await draft.renameRow(PRODUCTS, 'p2', 'p20');
    await draft.renameRow(PRODUCTS, 'p3', 'p30');
    await draft.updateRow(PRODUCTS, 'p30', product('edited'));
    await draft.removeRow(PRODUCTS, 'p4');
    await draft.createRows(PRODUCTS, { p9: product('new') });

    return draft;
  }
});

function product(title: string, price = 1) {
  return { title, price };
}

// RENAMED and MODIFIED also match RENAMED_AND_MODIFIED, which is both.
function matchesType({ changeType }: DraftRowItem, type: ChangeType): boolean {
  return (
    changeType === type ||
    (changeType === ChangeType.RenamedAndModified &&
      (type === ChangeType.Renamed || type === ChangeType.Modified))
  );
}

function nameOf({ tableId, rowId, changeType }: DraftRowItem): string {
  return `${tableId}/${rowId} ${changeType}`;
}

function idsOf({
  tableId,
  previousTableId,
  rowId,
  previousRowId,
}: DraftRowItem): (string | undefined)[] {
  if (previousRowId === undefined) {
    return [tableId, previousTableId, rowId];
  }

  return [tableId, previousTableId, rowId, previousRowId];
}
