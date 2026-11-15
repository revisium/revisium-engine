import { arr, num, numFormula, obj, str } from '@revisium/schema-toolkit/mocks';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import { ListingValidationError } from 'src/features/partial-changes/draft-reads/listing-validation-error';
import { ReportedRowCountsReader } from 'src/features/partial-changes/draft-reads/reported-row-counts-reader';
import { ReportedRowPairsReader } from 'src/features/partial-changes/draft-reads/reported-row-pairs-reader';
import type {
  DraftFieldValue,
  DraftValueSide,
} from 'src/features/partial-changes/queries/impl/get-draft-field-value.query';
import { transactionModeOfSnapshotRead } from '../../__tests__/support/change-preview';
import { ChangesScenario } from '../../__tests__/support/changes-scenario';
import {
  draftReadQueriesDuring,
  type DraftValueOptions,
  rawQueriesDuring,
} from '../../__tests__/support/draft-reading';

const PRODUCTS = 'products';
const GOODS = 'goods';
const ORDERS = 'orders';
const TAGS = 'tags';
const LABELS = 'labels';
const EMOJI = '\u{1F600}';

const productSchema = obj({ title: str(), price: num(), tags: arr(str()) });
const orderSchema = obj({
  price: num(),
  quantity: num(),
  total: numFormula('price * quantity'),
});
const labelSchema = obj({ label: str() });

type ValueView = Pick<DraftFieldValue, 'value' | 'valueBytes' | 'text'>;

describe('draft field value', () => {
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

  describe('values', () => {
    it('reads the value at a path on each side of an edited row, with the revisions it read', async () => {
      const draft = await givenCommittedProducts();
      await draft.updateRow(PRODUCTS, 'p1', product('Desk lamp'));

      const head = await draft.readDraftFieldValue(title('head', 'p1'));
      const edited = await draft.readDraftFieldValue(title('draft', 'p1'));

      expect(head).toEqual({
        headRevisionId: await draft.revisionId('head'),
        draftRevisionId: await draft.revisionId('draft'),
        refusedTables: [],
        value: 'Lamp',
        valueBytes: 6,
        valueToken: expect.any(String) as string,
        text: { offset: 0, totalLength: 4 },
      });
      expect(viewOf(edited)).toEqual({
        value: 'Desk lamp',
        valueBytes: 11,
        text: { offset: 0, totalLength: 9 },
      });
    });

    it('reads the whole row at the root pointer and an array whole', async () => {
      const draft = await givenCommittedProducts();
      await draft.updateRow(PRODUCTS, 'p1', product('Desk lamp', 2, ['a']));

      const row = await draft.readDraftFieldValue({
        ...title('draft', 'p1'),
        path: '',
      });
      const tags = await draft.readDraftFieldValue({
        ...title('draft', 'p1'),
        path: '/tags',
      });

      expect(viewOf(row)).toEqual({
        value: product('Desk lamp', 2, ['a']),
        valueBytes: bytesOf(product('Desk lamp', 2, ['a'])),
      });
      expect(viewOf(tags)).toEqual({ value: ['a'], valueBytes: 5 });
    });

    it('reads a created row on the Draft side only and a removed row on the Head side only', async () => {
      const draft = await givenCommittedProducts();
      await draft.removeRow(PRODUCTS, 'p1');
      await draft.createRows(PRODUCTS, { p9: product('New') });

      expect(await titlesOf(draft, 'p9')).toEqual([NONE, textOf('New')]);
      expect(await titlesOf(draft, 'p1')).toEqual([textOf('Lamp'), NONE]);
    });

    it('reads no value at a path that a side does not hold, nor of an unknown row or table', async () => {
      const draft = await givenCommittedProducts();
      await draft.updateRow(
        PRODUCTS,
        'p1',
        product('Desk lamp', 1, ['a', 'b']),
      );

      const views = await Promise.all(
        [
          { ...title('draft', 'p1'), path: '/missing' },
          { ...title('draft', 'p1'), path: '/tags/5' },
          { ...title('draft', 'p1'), path: '/title/length' },
          { ...title('draft', 'p1'), path: '/tags/length' },
          { ...title('draft', 'p1'), path: '/tags/00' },
          { ...title('draft', 'p1'), path: '/tags/-' },
          title('draft', 'p7'),
          { ...title('head', 'p1'), tableId: 'unknown' },
        ].map(async (options) =>
          viewOf(await draft.readDraftFieldValue(options)),
        ),
      );

      expect(views).toEqual([NONE, NONE, NONE, NONE, NONE, NONE, NONE, NONE]);
    });

    it('computes a formula value as the row read does', async () => {
      const draft = await ChangesScenario.committed(kit, {
        [ORDERS]: {
          schema: orderSchema,
          rows: { o1: { price: 2, quantity: 3, total: 0 } },
        },
      });
      await draft.updateRow(ORDERS, 'o1', { price: 4, quantity: 3, total: 0 });
      const [item] = (await draft.readDraftRowChanges({ first: 10 })).edges;

      const values = await Promise.all(
        (['head', 'draft'] as const).map(async (side) =>
          viewOf(
            await draft.readDraftFieldValue({
              tableId: ORDERS,
              rowId: 'o1',
              path: '/total',
              side,
            }),
          ),
        ),
      );

      expect(
        item?.node.fields.find(({ path }) => path === '/total'),
      ).toMatchObject({ oldValue: 6, newValue: 12 });
      expect(values).toEqual([
        { value: 6, valueBytes: 1 },
        { value: 12, valueBytes: 2 },
      ]);
    });

    it('reads a value of a refused table, listing the refusal', async () => {
      const draft = await ChangesScenario.committedWithoutLedger(kit, {
        [PRODUCTS]: { schema: productSchema, rows: { p1: product('Lamp') } },
      });
      await draft.updateRow(PRODUCTS, 'p1', product('Desk lamp'));

      const value = await draft.readDraftFieldValue(title('draft', 'p1'));

      expect(value).toMatchObject({
        value: 'Desk lamp',
        refusedTables: [{ tableId: PRODUCTS, code: 'unledgeredTable' }],
      });
    });
  });

  describe('row and table ids', () => {
    it('reads a renamed row by its id on the side read, or by its id on the other side while no row of the side holds it', async () => {
      const draft = await givenCommittedProducts();
      await draft.renameRow(PRODUCTS, 'p2', 'p20');
      await draft.updateRow(PRODUCTS, 'p20', product('Oak desk'));

      expect(await titlesOf(draft, 'p20')).toEqual([
        textOf('Desk'),
        textOf('Oak desk'),
      ]);
      expect(await titlesOf(draft, 'p2')).toEqual([
        textOf('Desk'),
        textOf('Oak desk'),
      ]);
    });

    it('reads by the id of a takeover the deleted row on the Head side, and the rename by its Head id', async () => {
      const draft = await givenCommittedProducts();
      await draft.removeRow(PRODUCTS, 'p1');
      await draft.renameRow(PRODUCTS, 'p2', 'p1');
      await draft.updateRow(PRODUCTS, 'p1', product('Oak desk'));

      expect(await titlesOf(draft, 'p1')).toEqual([
        textOf('Lamp'),
        textOf('Oak desk'),
      ]);
      expect(await titlesOf(draft, 'p2')).toEqual([
        textOf('Desk'),
        textOf('Oak desk'),
      ]);
    });

    it('reads the deleted row of a replaced row on the Head side and the created row on the Draft side', async () => {
      const draft = await givenCommittedProducts();
      await draft.removeRow(PRODUCTS, 'p1');
      await draft.createRows(PRODUCTS, { p1: product('Reused') });

      expect(await titlesOf(draft, 'p1')).toEqual([
        textOf('Lamp'),
        textOf('Reused'),
      ]);
    });

    it('reads a renamed table by its id on the side read, or by its id on the other side while no table of the side holds it', async () => {
      const draft = await givenCommittedProducts();
      await draft.renameTable(PRODUCTS, GOODS);
      await draft.updateRow(GOODS, 'p1', product('Desk lamp'));

      for (const tableId of [GOODS, PRODUCTS]) {
        expect(await titlesOf(draft, 'p1', tableId)).toEqual([
          textOf('Lamp'),
          textOf('Desk lamp'),
        ]);
      }
    });

    it('reads the removed table of a replaced table id on the Head side and the created one on the Draft side', async () => {
      const draft = await givenCommittedProducts();
      await draft.removeTable(PRODUCTS);
      await draft.createTable(PRODUCTS, productSchema);
      await draft.createRows(PRODUCTS, { p1: product('Reused') });

      expect(await titlesOf(draft, 'p1')).toEqual([
        textOf('Lamp'),
        textOf('Reused'),
      ]);
    });

    it('reads a removed table by its id on the Head side, and the table renamed into its id by its Head id', async () => {
      const draft = await ChangesScenario.committed(kit, {
        [TAGS]: { schema: labelSchema, rows: { t1: { label: 'removed' } } },
        [LABELS]: { schema: labelSchema, rows: { t1: { label: 'kept' } } },
      });
      await draft.removeTable(TAGS);
      await draft.renameTable(LABELS, TAGS);
      await draft.updateRow(TAGS, 't1', { label: 'kept and edited' });

      expect(await labelsOf(draft, TAGS)).toEqual([
        textOf('removed'),
        textOf('kept and edited'),
      ]);
      expect(await labelsOf(draft, LABELS)).toEqual([
        textOf('kept'),
        textOf('kept and edited'),
      ]);
    });
  });

  describe('text ranges', () => {
    it('reads the part of a string from an offset, with its total length', async () => {
      const draft = await givenCommittedProducts();
      await draft.updateRow(PRODUCTS, 'p1', product('abcdefghij'));

      const part = await draft.readDraftFieldValue({
        ...title('draft', 'p1'),
        offset: 2,
        limit: 3,
      });
      const rest = await draft.readDraftFieldValue({
        ...title('draft', 'p1'),
        offset: 8,
      });

      expect(viewOf(part)).toEqual({
        value: 'cde',
        valueBytes: 12,
        text: { offset: 2, totalLength: 10 },
      });
      expect(viewOf(rest)).toEqual({
        value: 'ij',
        valueBytes: 12,
        text: { offset: 8, totalLength: 10 },
      });
    });

    it('never splits the surrogate pair of an emoji', async () => {
      const draft = await givenCommittedProducts();
      await draft.updateRow(PRODUCTS, 'p1', product(`a${EMOJI}b`));

      const views = await Promise.all(
        [
          { offset: 0, limit: 2 },
          { offset: 2, limit: 3 },
        ].map(async (range) =>
          viewOf(
            await draft.readDraftFieldValue({
              ...title('draft', 'p1'),
              ...range,
            }),
          ),
        ),
      );

      expect(views).toEqual([
        { value: 'a', valueBytes: 8, text: { offset: 0, totalLength: 4 } },
        {
          value: `${EMOJI}b`,
          valueBytes: 8,
          text: { offset: 1, totalLength: 4 },
        },
      ]);
    });

    it('reads a value that is not a string whole under a range', async () => {
      const draft = await givenCommittedProducts();
      await draft.updateRow(PRODUCTS, 'p1', product('Lamp', 1, ['a', 'b']));

      const tags = await draft.readDraftFieldValue({
        ...title('draft', 'p1'),
        path: '/tags',
        offset: 1,
        limit: 1,
      });

      expect(viewOf(tags)).toEqual({ value: ['a', 'b'], valueBytes: 9 });
    });
  });

  describe('value tokens', () => {
    it('returns one token for every range of an unchanged value, and none without a value', async () => {
      const draft = await givenCommittedProducts();
      await draft.updateRow(PRODUCTS, 'p1', product('abcdef'));

      const tokens = await Promise.all(
        [{}, { offset: 0, limit: 3 }, { offset: 3, limit: 3 }].map(
          async (range) =>
            (
              await draft.readDraftFieldValue({
                ...title('draft', 'p1'),
                ...range,
              })
            ).valueToken,
        ),
      );
      const none = await draft.readDraftFieldValue(title('head', 'p7'));

      expect(new Set(tokens).size).toBe(1);
      expect(tokens[0]).toEqual(expect.any(String));
      expect(none.valueToken).toBeNull();
    });

    it('returns another token after an edit of the value, so a continuation tells it read another text', async () => {
      const draft = await givenCommittedProducts();
      await draft.updateRow(PRODUCTS, 'p1', product('abcdef'));
      const first = await draft.readDraftFieldValue({
        ...title('draft', 'p1'),
        limit: 3,
      });

      await draft.updateRow(PRODUCTS, 'p1', product('UVWXYZ'));
      const next = await draft.readDraftFieldValue({
        ...title('draft', 'p1'),
        offset: 3,
      });

      expect([first.value, next.value]).toEqual(['abc', 'XYZ']);
      expect(next.valueToken).not.toBe(first.valueToken);
      expect([next.headRevisionId, next.draftRevisionId]).toEqual([
        first.headRevisionId,
        first.draftRevisionId,
      ]);
    });

    it('keeps the token of a value across edits of other rows and of other fields of its row', async () => {
      const draft = await givenCommittedProducts();
      await draft.updateRow(PRODUCTS, 'p1', product('abcdef'));
      const before = await draft.readDraftFieldValue(title('draft', 'p1'));

      await draft.updateRow(PRODUCTS, 'p2', product('Oak desk'));
      await draft.createRows(PRODUCTS, { p3: product('abcdef') });
      await draft.updateRow(PRODUCTS, 'p1', product('abcdef', 9, ['x']));

      expect(
        (await draft.readDraftFieldValue(title('draft', 'p1'))).valueToken,
      ).toBe(before.valueToken);
    });

    it('gives each side of a field change in the row read under the value limit the token of the value read', async () => {
      const draft = await givenCommittedProducts();
      await draft.updateRow(PRODUCTS, 'p1', product('x'.repeat(40)));
      await draft.removeRow(PRODUCTS, 'p2');

      const page = await draft.readDraftRowChanges({
        first: 10,
        maxValueBytes: 20,
      });
      const [edited, removed] = page.edges.map(({ node }) => node.fields[0]);
      const tokens = [
        (await draft.readDraftFieldValue(title('head', 'p1'))).valueToken,
        (await draft.readDraftFieldValue(title('draft', 'p1'))).valueToken,
        (
          await draft.readDraftFieldValue({
            ...title('head', 'p2'),
            path: '',
          })
        ).valueToken,
      ];

      expect([
        edited?.oldValueToken,
        edited?.newValueToken,
        removed?.oldValueToken,
        removed?.newValueToken,
      ]).toEqual([...tokens, null]);
      expect(edited?.newValueCut).toBe('prefix');
      expect(removed?.oldValueCut).toBe('omitted');
    });
  });

  describe('validation', () => {
    it.each<[string, Record<string, unknown>]>([
      ['a missing table id', { tableId: undefined }],
      ['an empty table id', { tableId: '' }],
      ['a table id that is not a string', { tableId: 5 }],
      ['a row id holding the NUL character', { rowId: 'p\u0000' }],
      ['an empty row id', { rowId: '' }],
      ['a path that is not a JSON Pointer', { path: 'title' }],
      ['a path with a malformed escape', { path: '/a~2' }],
      ['an unknown side', { side: 'merged' }],
      ['a missing side', { side: undefined }],
      ['an offset of -1', { offset: -1 }],
      ['an offset of 1.5', { offset: 1.5 }],
      ['a limit of 0', { limit: 0 }],
      ['a limit of 1,048,577', { limit: 1_048_577 }],
      ['a limit that is not a number', { limit: '5' }],
    ])('refuses %s before reading the snapshot', async (_case, input) => {
      const draft = await givenCommittedProducts();
      const readSnapshot = jest.spyOn(kit.snapshotReader, 'readSnapshot');

      try {
        await expect(
          draft.readDraftFieldValue({
            ...title('draft', 'p1'),
            ...input,
          } as DraftValueOptions),
        ).rejects.toThrow(ListingValidationError);
        expect(readSnapshot).not.toHaveBeenCalled();
      } finally {
        readSnapshot.mockRestore();
      }
    });

    it('treats a null offset and a null limit as absent', async () => {
      const draft = await givenCommittedProducts();

      expect(
        await draft.readDraftFieldValue({
          ...title('head', 'p1'),
          offset: null,
          limit: null,
        }),
      ).toEqual(await draft.readDraftFieldValue(title('head', 'p1')));
    });

    it('raises the native lookup error for an unknown branch', async () => {
      const draft = await givenCommittedProducts();

      await expect(
        kit.partialChangesApi.draftFieldValue({
          branch: { ...draft.branch, branchName: 'missing' },
          ...title('head', 'p1'),
        }),
      ).rejects.toThrow(
        'A branch with this name does not exist in the project',
      );
    });
  });

  describe('snapshot and cost', () => {
    it('reads one snapshot in a read-only repeatable-read transaction', async () => {
      const draft = await givenCommittedProducts();
      await draft.updateRow(PRODUCTS, 'p1', product('Desk lamp'));

      const mode = await transactionModeOfSnapshotRead(kit, () =>
        draft.readDraftFieldValue(title('draft', 'p1')),
      );

      expect(mode).toEqual({ readOnly: 'on', isolation: 'repeatable read' });
    });

    it("reads the row by its id, neither the table's changed rows nor the native diff", async () => {
      const draft = await givenCommittedProducts();
      await draft.renameRow(PRODUCTS, 'p2', 'p20');
      await draft.updateRow(PRODUCTS, 'p1', product('Desk lamp'));
      const versionIds = [
        await draft.tableVersionId('head', PRODUCTS),
        await draft.tableVersionId('draft', PRODUCTS),
      ];
      const pairs = jest.spyOn(
        kit.module.get(ReportedRowPairsReader),
        'readPairsPage',
      );
      const counts = jest.spyOn(
        kit.module.get(ReportedRowCountsReader),
        'readRowCounts',
      );
      const changedRows = jest.spyOn(kit.snapshotReader, 'readChangedRows');

      try {
        const { queries } = await rawQueriesDuring(kit, () =>
          draft.readDraftFieldValue(title('head', 'p20')),
        );
        const { nativeDiffReads } = await draftReadQueriesDuring(kit, [], () =>
          draft.readDraftFieldValue(title('draft', 'p1')),
        );

        expect(
          queries
            .filter(({ values }) =>
              versionIds.some((versionId) => values.includes(versionId)),
            )
            .map(({ values }) => values.includes('p20')),
        ).toEqual([true, true]);
        expect(nativeDiffReads).toEqual([]);
        expect([pairs, counts, changedRows].map(callsOf)).toEqual([0, 0, 0]);
      } finally {
        [pairs, counts, changedRows].forEach((spy) => spy.mockRestore());
      }
    });
  });

  async function givenCommittedProducts(): Promise<ChangesScenario> {
    return ChangesScenario.committed(kit, {
      [PRODUCTS]: {
        schema: productSchema,
        rows: { p1: product('Lamp'), p2: product('Desk') },
      },
    });
  }

  async function titlesOf(
    draft: ChangesScenario,
    rowId: string,
    tableId = PRODUCTS,
  ): Promise<ValueView[]> {
    const views: ValueView[] = [];

    for (const side of ['head', 'draft'] as const) {
      views.push(
        viewOf(
          await draft.readDraftFieldValue({ ...title(side, rowId), tableId }),
        ),
      );
    }

    return views;
  }

  async function labelsOf(
    draft: ChangesScenario,
    tableId: string,
  ): Promise<ValueView[]> {
    const views: ValueView[] = [];

    for (const side of ['head', 'draft'] as const) {
      views.push(
        viewOf(
          await draft.readDraftFieldValue({
            tableId,
            rowId: 't1',
            path: '/label',
            side,
          }),
        ),
      );
    }

    return views;
  }
});

const NONE: ValueView = { value: null, valueBytes: null };

function product(title: string, price = 1, tags: string[] = []) {
  return { title, price, tags };
}

function title(side: DraftValueSide, rowId: string): DraftValueOptions {
  return { tableId: PRODUCTS, rowId, path: '/title', side };
}

function textOf(value: string): ValueView {
  return {
    value,
    valueBytes: bytesOf(value),
    text: { offset: 0, totalLength: value.length },
  };
}

function viewOf({ value, valueBytes, text }: DraftFieldValue): ValueView {
  if (text === undefined) {
    return { value, valueBytes };
  }

  return { value, valueBytes, text };
}

function bytesOf(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}

function callsOf(spy: jest.SpyInstance): number {
  return spy.mock.calls.length;
}
