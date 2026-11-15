import { num, obj, str } from '@revisium/schema-toolkit/mocks';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import { addField } from 'src/__tests__/fixtures/ledger-steps';
import { encodeCursor } from 'src/features/partial-changes/input/cursor-codec';
import { ListingValidationError } from 'src/features/partial-changes/draft-reads/listing-validation-error';
import type {
  DraftRowChangesInput,
  DraftRowItem,
  DraftRowPage,
} from 'src/features/partial-changes/queries/impl/get-draft-row-changes.query';
import { ChangeType } from 'src/features/revision-changes/types';
import { ChangesScenario } from '../../__tests__/support/changes-scenario';
import { rowItemsOf } from '../../__tests__/support/draft-reading';

const PRODUCTS = 'products';
const GOODS = 'goods';
const TAGS = 'tags';
const RECENT = 'recent';

const productSchema = obj({ title: str(), price: num() });

describe('Draft rows by the time of their last change', () => {
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

  describe('order', () => {
    it('lists the rows changed last first, each with the time of its last change, and removed rows last without one', async () => {
      const draft = await givenEveryRowChangeKind();
      await draft.stampDraftRowChanges(PRODUCTS, {
        p1: '2026-03-01T10:00:00.000Z',
        p20: '2026-03-01T12:00:00.000Z',
        p30: '2026-03-01T09:00:00.000Z',
        p9: '2026-03-01T11:00:00.000Z',
      });

      const items = await readRecent(draft, { tableId: PRODUCTS });

      expect(items.map(lineOf)).toEqual([
        'p20 RENAMED 2026-03-01T12:00:00.000Z',
        'p9 ADDED 2026-03-01T11:00:00.000Z',
        'p1 MODIFIED 2026-03-01T10:00:00.000Z',
        'p30 RENAMED_AND_MODIFIED 2026-03-01T09:00:00.000Z',
        'p4 REMOVED -',
        'p5 REMOVED -',
      ]);
    });

    it('orders rows changed at one time by row id in code points', async () => {
      const draft = await givenCommittedProducts(['B', 'a', '_a', 'b']);
      for (const rowId of ['B', 'a', '_a', 'b']) {
        await draft.updateRow(PRODUCTS, rowId, product('edited'));
      }
      await draft.stampDraftRowChanges(PRODUCTS, {
        B: '2026-03-01T10:00:00.000Z',
        a: '2026-03-01T10:00:00.000Z',
        _a: '2026-03-01T10:00:00.000Z',
        b: '2026-03-01T11:00:00.000Z',
      });

      const items = await readRecent(draft, { tableId: PRODUCTS });

      expect(items.map(({ rowId }) => rowId)).toEqual(['b', 'B', '_a', 'a']);
    });

    it('takes the time of the last native write of each row: an edit, a rename or a creation', async () => {
      const draft = await givenCommittedProducts(['p1', 'p2', 'p3']);
      await draft.updateRow(PRODUCTS, 'p1', product('first edit'));
      await nextMillisecond();
      await draft.renameRow(PRODUCTS, 'p2', 'p20');
      await nextMillisecond();
      await draft.createRows(PRODUCTS, { p9: product('new') });
      await nextMillisecond();
      await draft.updateRow(PRODUCTS, 'p1', product('second edit'));

      const items = await readRecent(draft, { tableId: PRODUCTS });

      expect(items.map(({ rowId }) => rowId)).toEqual(['p1', 'p9', 'p20']);
      expect(items.map(({ changedAt }) => changedAt)).toEqual([
        await draftUpdatedAtOf(draft, 'p1'),
        await draftUpdatedAtOf(draft, 'p9'),
        await draftUpdatedAtOf(draft, 'p20'),
      ]);
    });

    it('gives every row a structure change rewrote the time of that change', async () => {
      const draft = await givenCommittedProducts(['p1', 'p2']);
      await draft.updateRow(PRODUCTS, 'p1', product('edited'));
      await nextMillisecond();
      const beforeStructureChange = new Date();
      await draft.updateTable(PRODUCTS, [addField('color', str())]);

      const items = await readRecent(draft, { tableId: PRODUCTS });

      expect(items.map(({ rowId }) => rowId).sort()).toEqual(['p1', 'p2']);
      expect(
        items.filter(
          ({ changedAt }) =>
            !(changedAt instanceof Date) || changedAt < beforeStructureChange,
        ),
      ).toEqual([]);
    });

    it('carries the time on the rows of the id order too', async () => {
      const draft = await givenEveryRowChangeKind();
      await draft.stampDraftRowChanges(PRODUCTS, {
        p1: '2026-03-01T10:00:00.000Z',
      });

      const items = rowItemsOf([
        await draft.readDraftRowChanges({ first: 10 }),
      ]);

      expect(items.find(({ rowId }) => rowId === 'p1')?.changedAt).toEqual(
        new Date('2026-03-01T10:00:00.000Z'),
      );
      expect(items.find(({ rowId }) => rowId === 'p4')?.changedAt).toBeNull();
    });

    it('lists the rows of a created table by their time', async () => {
      const draft = await givenCommittedProducts(['p1']);
      await draft.createTable(TAGS, obj({ label: str() }));
      await draft.createRows(TAGS, {
        t1: { label: 'one' },
        t2: { label: 'two' },
      });
      await draft.stampDraftRowChanges(TAGS, {
        t1: '2026-03-01T11:00:00.000Z',
        t2: '2026-03-01T12:00:00.000Z',
      });

      const items = await readRecent(draft, { tableId: TAGS });

      expect(items.map(({ rowId }) => rowId)).toEqual(['t2', 't1']);
    });

    it('lists the rows of the table created at a replaced table id by their time, then the removed table rows', async () => {
      const draft = await givenCommittedProducts(['p1', 'p2']);
      await draft.removeTable(PRODUCTS);
      await draft.createTable(PRODUCTS, productSchema);
      await draft.createRows(PRODUCTS, {
        p3: product('new'),
        p8: product('new'),
      });
      await draft.stampDraftRowChanges(PRODUCTS, {
        p3: '2026-03-01T11:00:00.000Z',
        p8: '2026-03-01T12:00:00.000Z',
      });

      for (const first of [1, 2, 10]) {
        const items = rowItemsOf(
          await draft.readEveryDraftRowPage({
            first,
            orderBy: RECENT,
            filters: { tableId: PRODUCTS },
          }),
        );

        expect([first, items.map(lineOf)]).toEqual([
          first,
          [
            'p8 ADDED 2026-03-01T12:00:00.000Z',
            'p3 ADDED 2026-03-01T11:00:00.000Z',
            'p1 REMOVED -',
            'p2 REMOVED -',
          ],
        ]);
      }
    });
  });

  describe('replaced rows', () => {
    it('places the two items of a replaced row together by the time of the created row, on no two pages', async () => {
      const draft = await givenCommittedProducts(['p1', 'p2', 'p3']);
      await draft.updateRow(PRODUCTS, 'p1', product('edited'));
      await draft.removeRow(PRODUCTS, 'p2');
      await draft.createRows(PRODUCTS, { p2: product('again') });
      await draft.updateRow(PRODUCTS, 'p3', product('edited'));
      await draft.stampDraftRowChanges(PRODUCTS, {
        p1: '2026-03-01T10:00:00.000Z',
        p2: '2026-03-01T11:00:00.000Z',
        p3: '2026-03-01T12:00:00.000Z',
      });
      const expected = [
        'p3 MODIFIED 2026-03-01T12:00:00.000Z',
        'p2 REMOVED replaced 2026-03-01T11:00:00.000Z',
        'p2 ADDED replaced 2026-03-01T11:00:00.000Z',
        'p1 MODIFIED 2026-03-01T10:00:00.000Z',
      ];

      for (const first of [1, 2]) {
        const pages = await draft.readEveryDraftRowPage({
          first,
          orderBy: RECENT,
          filters: { tableId: PRODUCTS },
        });

        expect([first, rowItemsOf(pages).map(lineOf)]).toEqual([
          first,
          expected,
        ]);
        expect(pages.map((page) => replacedRowIdsOf(page).length)).toContain(2);
      }
    });
  });

  describe('id takeover', () => {
    it('lists the rename into the id of a deleted row by its time and the deleted row last, both with the takeover on pages of one', async () => {
      const draft = await givenCommittedProducts(['p1', 'p2', 'p3']);
      await draft.removeRow(PRODUCTS, 'p1');
      await draft.renameRow(PRODUCTS, 'p2', 'p1');
      await draft.updateRow(PRODUCTS, 'p3', product('edited'));
      await draft.stampDraftRowChanges(PRODUCTS, {
        p1: '2026-03-01T11:00:00.000Z',
        p3: '2026-03-01T10:00:00.000Z',
      });
      const whole = await readRecent(draft, { tableId: PRODUCTS });

      const paged = rowItemsOf(
        await draft.readEveryDraftRowPage({
          first: 1,
          orderBy: RECENT,
          filters: { tableId: PRODUCTS },
        }),
      );

      expect(whole.map(lineOf)).toEqual([
        'p1 RENAMED 2026-03-01T11:00:00.000Z',
        'p3 MODIFIED 2026-03-01T10:00:00.000Z',
        'p1 REMOVED -',
      ]);
      expect(paged).toEqual(whole);
      expect(paged.map(({ idTakeover }) => idTakeover !== undefined)).toEqual([
        true,
        false,
        true,
      ]);
    });
  });

  describe('filters', () => {
    it('applies the change types, the search and the row ids in the order of the last change', async () => {
      const draft = await givenEveryRowChangeKind();
      await draft.stampDraftRowChanges(PRODUCTS, {
        p1: '2026-03-01T10:00:00.000Z',
        p20: '2026-03-01T12:00:00.000Z',
        p30: '2026-03-01T13:00:00.000Z',
        p9: '2026-03-01T11:00:00.000Z',
      });

      expect(
        (
          await readRecent(draft, {
            tableId: PRODUCTS,
            changeTypes: [ChangeType.Modified],
          })
        ).map(({ rowId }) => rowId),
      ).toEqual(['p30', 'p1']);
      expect(
        (await readRecent(draft, { tableId: PRODUCTS, search: '0' })).map(
          ({ rowId }) => rowId,
        ),
      ).toEqual(['p30', 'p20']);
      expect(
        (
          await readRecent(draft, {
            tableId: PRODUCTS,
            rowIds: ['p4', 'p1', 'p9'],
          })
        ).map(({ rowId }) => rowId),
      ).toEqual(['p9', 'p1', 'p4']);
    });

    it('selects a renamed table by its Head id', async () => {
      const draft = await givenCommittedProducts(['p1', 'p2']);
      await draft.renameTable(PRODUCTS, GOODS);
      await draft.updateRow(GOODS, 'p1', product('edited'));
      await draft.updateRow(GOODS, 'p2', product('edited'));
      await draft.stampDraftRowChanges(GOODS, {
        p1: '2026-03-01T10:00:00.000Z',
        p2: '2026-03-01T11:00:00.000Z',
      });

      const items = await readRecent(draft, { tableId: PRODUCTS });

      expect(items.map(({ tableId, rowId }) => `${tableId}/${rowId}`)).toEqual([
        'goods/p2',
        'goods/p1',
      ]);
    });
  });

  describe('paging and validation', () => {
    it('reads the same rows as before when the order is id or absent', async () => {
      const draft = await givenEveryRowChangeKind();
      const absent = await draft.readDraftRowChanges({ first: 10 });

      expect(
        await draft.readDraftRowChanges({ first: 10, orderBy: 'id' }),
      ).toEqual(absent);
      expect(
        await draft.readDraftRowChanges({ first: 10, orderBy: null }),
      ).toEqual(absent);
      expect(rowItemsOf([absent]).map(({ rowId }) => rowId)).toEqual([
        'p1',
        'p20',
        'p30',
        'p4',
        'p5',
        'p9',
      ]);
    });

    it('refuses the cursor of one order under the other', async () => {
      const draft = await givenEveryRowChangeKind();
      const byId = await draft.readDraftRowChanges({
        first: 1,
        filters: { tableId: PRODUCTS },
      });
      const byTime = await draft.readDraftRowChanges({
        first: 1,
        orderBy: RECENT,
        filters: { tableId: PRODUCTS },
      });

      await expect(
        draft.readDraftRowChanges({
          first: 1,
          orderBy: RECENT,
          filters: { tableId: PRODUCTS },
          after: byId.pageInfo.endCursor,
        }),
      ).rejects.toThrow(ListingValidationError);
      await expect(
        draft.readDraftRowChanges({
          first: 1,
          filters: { tableId: PRODUCTS },
          after: byTime.pageInfo.endCursor,
        }),
      ).rejects.toThrow(ListingValidationError);
    });

    it.each<[string, Partial<DraftRowChangesInput>]>([
      ['the recent order without a table id', { orderBy: RECENT }],
      [
        'the recent order with row filters but no table id',
        { orderBy: RECENT, filters: { search: 'p' } },
      ],
      [
        'an unknown order',
        {
          orderBy: 'name' as DraftRowChangesInput['orderBy'],
          filters: { tableId: PRODUCTS },
        },
      ],
      ...['yesterday', '2026-03-01 10:00', 1, undefined].map(
        (changedAt): [string, Partial<DraftRowChangesInput>] => [
          `a recent cursor with the time ${String(changedAt)}`,
          {
            orderBy: RECENT,
            filters: { tableId: PRODUCTS },
            after: encodeCursor('recentRows', {
              tableId: PRODUCTS,
              headOnly: false,
              rowId: 'p1',
              changedAt,
            }),
          },
        ],
      ),
    ])('refuses %s before reading the snapshot', async (_input, input) => {
      const draft = await givenEveryRowChangeKind();
      const readSnapshot = jest.spyOn(kit.snapshotReader, 'readSnapshot');

      try {
        await expect(
          draft.readDraftRowChanges({ first: 10, ...input }),
        ).rejects.toThrow(ListingValidationError);
        expect(readSnapshot).not.toHaveBeenCalled();
      } finally {
        readSnapshot.mockRestore();
      }
    });
  });

  function readRecent(
    draft: ChangesScenario,
    filters: DraftRowChangesInput['filters'],
  ): Promise<DraftRowItem[]> {
    return draft
      .readDraftRowChanges({ first: 5_000, orderBy: RECENT, filters })
      .then((page) => rowItemsOf([page]));
  }

  async function draftUpdatedAtOf(
    draft: ChangesScenario,
    rowId: string,
  ): Promise<Date> {
    return (await draft.row('draft', PRODUCTS, rowId)).updatedAt;
  }

  function givenCommittedProducts(
    rowIds: readonly string[],
  ): Promise<ChangesScenario> {
    return ChangesScenario.committed(kit, {
      [PRODUCTS]: {
        schema: productSchema,
        rows: Object.fromEntries(
          rowIds.map((rowId) => [rowId, product(rowId)]),
        ),
      },
    });
  }

  // One row of every change type in one table, and a second removed row.
  async function givenEveryRowChangeKind(): Promise<ChangesScenario> {
    const draft = await givenCommittedProducts(['p1', 'p2', 'p3', 'p4', 'p5']);
    await draft.updateRow(PRODUCTS, 'p1', product('edited'));
    await draft.renameRow(PRODUCTS, 'p2', 'p20');
    await draft.renameRow(PRODUCTS, 'p3', 'p30');
    await draft.updateRow(PRODUCTS, 'p30', product('edited'));
    await draft.removeRow(PRODUCTS, 'p4');
    await draft.removeRow(PRODUCTS, 'p5');
    await draft.createRows(PRODUCTS, { p9: product('new') });

    return draft;
  }
});

function product(title: string) {
  return { title, price: 1 };
}

function lineOf({ rowId, changeType, replaced, changedAt }: DraftRowItem) {
  const time = changedAt?.toISOString() ?? '-';

  if (replaced) {
    return `${rowId} ${changeType} replaced ${time}`;
  }

  return `${rowId} ${changeType} ${time}`;
}

function replacedRowIdsOf({ edges }: DraftRowPage): string[] {
  return edges
    .filter(({ node }) => node.replaced)
    .map(({ node }) => node.rowId);
}

// Native writers stamp a row with the moment of the write; distinct moments make the order of writes observable.
async function nextMillisecond(): Promise<void> {
  const start = Date.now();

  while (Date.now() <= start + 1) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}
