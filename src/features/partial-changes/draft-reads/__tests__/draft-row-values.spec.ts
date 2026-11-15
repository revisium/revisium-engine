import { arr, num, obj, str } from '@revisium/schema-toolkit/mocks';
import objectHash from 'object-hash';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import { addField, removeField } from 'src/__tests__/fixtures/ledger-steps';
import type { InputJsonValue } from 'src/engine-prisma-types';
import { ListingValidationError } from 'src/features/partial-changes/draft-reads/listing-validation-error';
import type {
  DraftFieldChange,
  DraftRowItem,
} from 'src/features/partial-changes/queries/impl/get-draft-row-changes.query';
import { RowChangeDetailType } from 'src/features/revision-changes/types';
import { ChangesScenario } from '../../__tests__/support/changes-scenario';
import type { DraftRowOptions } from '../../__tests__/support/draft-reading';
import { rowItemsOf } from '../../__tests__/support/draft-reading';

const PRODUCTS = 'products';
const LINES = 'lines';
const SHELVES = 'shelves';
const NOTES = 'notes';
const LIMIT = 20;
const LONG_TITLE = 'x'.repeat(100);
const EMOJI = '\u{1F600}';

const productSchema = obj({ title: str(), price: num(), tags: arr(str()) });
const lineSchema = obj({ parts: arr(obj({ name: str() })) });
const shelfSchema = obj({ groups: arr(obj({ tags: arr(str()) })) });
const noteSchema = obj({ title: str(), note: str() });

describe('draft row values', () => {
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

  describe('value limit', () => {
    it('returns each side within the limit whole, with the size of each side in bytes', async () => {
      const draft = await givenCommittedProducts();
      await draft.updateRow(PRODUCTS, 'p1', product('Desk lamp'));

      const [field] = await readFields(draft, { maxValueBytes: LIMIT });

      expect(field).toEqual({
        path: '/title',
        changeType: RowChangeDetailType.FieldModified,
        oldValue: 'Lamp',
        newValue: 'Desk lamp',
        oldValueBytes: 6,
        newValueBytes: 11,
        oldValueToken: expect.any(String) as string,
        newValueToken: expect.any(String) as string,
        selection: expect.objectContaining({ state: 'unit' }) as unknown,
      });
    });

    it('cuts a longer string to its longest prefix within the limit and says which side it cut', async () => {
      const draft = await givenCommittedProducts({ p1: product(LONG_TITLE) });
      await draft.updateRow(PRODUCTS, 'p1', product('Lamp'));

      const [field] = await readFields(draft, { maxValueBytes: LIMIT });

      expect(field).toMatchObject({
        path: '/title',
        oldValue: 'x'.repeat(LIMIT - 2),
        newValue: 'Lamp',
        oldValueBytes: 102,
        newValueBytes: 6,
        oldValueCut: 'prefix',
      });
      expect(field).not.toHaveProperty('newValueCut');
    });

    it('cuts a string of multi-byte characters and emoji on a character boundary', async () => {
      const draft = await givenCommittedProducts();
      await draft.updateRow(PRODUCTS, 'p1', product(`€€€${EMOJI}`));
      await draft.updateRow(PRODUCTS, 'p2', product(`ab${EMOJI}${EMOJI}`));

      const fields = await readFields(draft, { maxValueBytes: 9 });

      expect(
        fields.map(({ newValue, newValueBytes, newValueCut }) => [
          newValue,
          newValueBytes,
          newValueCut,
        ]),
      ).toEqual([
        ['€€', 15, 'prefix'],
        [`ab${EMOJI}`, 12, 'prefix'],
      ]);
    });

    it('omits an object side over the limit, which a part of would not be a JSON value, with its size', async () => {
      const draft = await ChangesScenario.committed(kit, {
        [LINES]: {
          schema: lineSchema,
          rows: { l1: { parts: [{ name: 'a' }] } },
        },
      });
      await draft.updateRow(LINES, 'l1', {
        parts: [{ name: 'a' }, { name: 'a long part name' }],
      });

      const [field] = await readFields(draft, { maxValueBytes: LIMIT });

      expect(field).toMatchObject({
        path: '/parts/1',
        changeType: RowChangeDetailType.FieldAdded,
        oldValue: null,
        newValue: null,
        oldValueBytes: null,
        newValueBytes: 27,
        newValueCut: 'omitted',
      });
      expect(field).not.toHaveProperty('oldValueCut');
    });

    it('omits the whole row of a created and of a removed row over the limit', async () => {
      const draft = await givenCommittedProducts();
      await draft.removeRow(PRODUCTS, 'p1');
      await draft.createRows(PRODUCTS, { p9: product('New lamp') });

      const fields = await readFields(draft, { maxValueBytes: LIMIT });

      expect(fields).toMatchObject([
        {
          path: '',
          changeType: RowChangeDetailType.FieldRemoved,
          oldValue: null,
          newValue: null,
          oldValueBytes: bytesOf(product('Lamp')),
          newValueBytes: null,
          oldValueCut: 'omitted',
        },
        {
          path: '',
          changeType: RowChangeDetailType.FieldAdded,
          oldValue: null,
          newValue: null,
          oldValueBytes: null,
          newValueBytes: bytesOf(product('New lamp')),
          newValueCut: 'omitted',
        },
      ]);
    });

    it('changes nothing but the values, their sizes and cuts', async () => {
      const draft = await givenCommittedProducts({ p1: product(LONG_TITLE) });
      await draft.updateRow(PRODUCTS, 'p1', product('Lamp', 5, ['a']));
      await draft.removeRow(PRODUCTS, 'p2');
      const all = await readItems(draft, {});

      const limited = await readItems(draft, { maxValueBytes: LIMIT });

      expect(limited.map(withoutValues)).toEqual(all.map(withoutValues));
    });

    it('returns the field changes without sizes or cuts when no limit is given', async () => {
      const draft = await givenCommittedProducts({ p1: product(LONG_TITLE) });
      await draft.updateRow(PRODUCTS, 'p1', product('Lamp'));

      const [field] = await readFields(draft, { maxValueBytes: null });

      expect(Object.keys(field ?? {}).sort()).toEqual([
        'changeType',
        'newValue',
        'oldValue',
        'path',
        'selection',
      ]);
      expect(field?.oldValue).toBe(LONG_TITLE);
    });

    it.each<[string, unknown]>([
      ['1', 1],
      ['1,048,577', 1_048_577],
      ['1.5', 1.5],
      ['a string', '20'],
    ])(
      'refuses a value limit of %s before reading the snapshot',
      async (_case, maxValueBytes) => {
        const draft = await givenCommittedProducts();
        const readSnapshot = jest.spyOn(kit.snapshotReader, 'readSnapshot');

        try {
          await expect(
            draft.readDraftRowChanges({
              first: 10,
              maxValueBytes: maxValueBytes as number,
            }),
          ).rejects.toThrow(ListingValidationError);
          expect(readSnapshot).not.toHaveBeenCalled();
        } finally {
          readSnapshot.mockRestore();
        }
      },
    );
  });

  describe('arrays', () => {
    it('gives a grown array its length on each side', async () => {
      const draft = await givenCommittedProducts({
        p1: product('Lamp', 1, ['a', 'b']),
      });
      await draft.updateRow(
        PRODUCTS,
        'p1',
        product('Lamp', 1, ['a', 'c', 'd']),
      );

      const [item] = await readItems(draft, {});

      expect(item?.fields.map(({ path }) => path)).toEqual([
        '/tags/1',
        '/tags/2',
      ]);
      expect(item?.arrays).toEqual([
        { path: '/tags', oldLength: 2, newLength: 3 },
      ]);
    });

    it('gives a shrunk array its length on each side', async () => {
      const draft = await givenCommittedProducts({
        p1: product('Lamp', 1, ['a', 'b', 'c']),
      });
      await draft.updateRow(PRODUCTS, 'p1', product('Lamp', 1, ['a']));

      const [item] = await readItems(draft, {});

      expect(item?.arrays).toEqual([
        { path: '/tags', oldLength: 3, newLength: 1 },
      ]);
    });

    it('describes the array of objects that holds a changed nested field', async () => {
      const draft = await ChangesScenario.committed(kit, {
        [LINES]: {
          schema: lineSchema,
          rows: { l1: { parts: [{ name: 'a' }, { name: 'b' }] } },
        },
      });
      await draft.updateRow(LINES, 'l1', {
        parts: [{ name: 'a' }, { name: 'x' }],
      });

      const [item] = await readItems(draft, {});

      expect(item?.fields.map(({ path }) => path)).toEqual(['/parts/1/name']);
      expect(item?.arrays).toEqual([
        { path: '/parts', oldLength: 2, newLength: 2 },
      ]);
    });

    it('describes every array around a change inside nested arrays, outer first, and none inside an element shown whole', async () => {
      const draft = await ChangesScenario.committed(kit, {
        [SHELVES]: {
          schema: shelfSchema,
          rows: {
            s1: { groups: [{ tags: ['a'] }, { tags: ['x', 'y'] }] },
          },
        },
      });
      await draft.updateRow(SHELVES, 's1', {
        groups: [{ tags: ['a', 'b'] }, { tags: ['x'] }, { tags: [] }],
      });

      const [item] = await readItems(draft, {});

      expect(item?.fields.map(({ path }) => path)).toEqual([
        '/groups/0/tags/1',
        '/groups/1/tags/1',
        '/groups/2',
      ]);
      expect(item?.arrays).toEqual([
        { path: '/groups', oldLength: 2, newLength: 3 },
        { path: '/groups/0/tags', oldLength: 1, newLength: 2 },
        { path: '/groups/1/tags', oldLength: 2, newLength: 1 },
      ]);
    });

    it('gives an array added or removed whole a length on its one side', async () => {
      const draft = await ChangesScenario.committed(kit, {
        [NOTES]: {
          schema: obj({ title: str(), old: arr(str()) }),
          rows: { n1: { title: 'one', old: ['a', 'b'] } },
        },
      });
      await draft.updateTable(NOTES, [
        removeField('old'),
        addField('labels', arr(str())),
      ]);

      const [item] = await readItems(draft, {});

      expect(
        item?.fields.map(({ path, changeType }) => [path, changeType]),
      ).toEqual([
        ['/old', RowChangeDetailType.FieldRemoved],
        ['/labels', RowChangeDetailType.FieldAdded],
      ]);
      expect(item?.arrays).toEqual([
        { path: '/old', oldLength: 2, newLength: null },
        { path: '/labels', oldLength: null, newLength: 0 },
      ]);
    });

    it('describes no array of a created row, which shows its side whole, nor of a row without one', async () => {
      const draft = await givenCommittedProducts();
      await draft.createRows(PRODUCTS, { p9: product('New', 1, ['a']) });
      await draft.updateRow(PRODUCTS, 'p1', product('Desk lamp'));

      const items = await readItems(draft, {});

      expect(items.map(({ rowId, arrays }) => [rowId, arrays])).toEqual([
        ['p1', []],
        ['p9', []],
      ]);
    });

    it('describes only the arrays of the field changes the field limit lists', async () => {
      const draft = await ChangesScenario.committed(kit, {
        [NOTES]: {
          schema: obj({ name: str(), labels: arr(str()) }),
          rows: { n1: { name: 'one', labels: ['a'] } },
        },
      });
      await draft.updateRow(NOTES, 'n1', { name: 'uno', labels: ['b'] });

      const [first] = await readItems(draft, { fieldsPerRow: 1 });
      const [both] = await readItems(draft, { fieldsPerRow: 2 });
      const [none] = await readItems(draft, { fieldsPerRow: 0 });

      expect(both?.fields.map(({ path }) => path)).toEqual([
        '/name',
        '/labels/0',
      ]);
      expect(first?.arrays).toEqual([]);
      expect(both?.arrays).toEqual([
        { path: '/labels', oldLength: 1, newLength: 1 },
      ]);
      expect(none?.arrays).toEqual([]);
    });
  });

  describe('a side without a value', () => {
    it('tells a missing key from a stored value by the change type and the size', async () => {
      const draft = await ChangesScenario.committed(kit, {
        [NOTES]: {
          schema: noteSchema,
          rows: {
            n1: { title: 'one', note: 'a' },
            n2: { title: 'two', note: 'b' },
          },
        },
      });
      await draft.updateRow(NOTES, 'n1', { title: 'uno', note: 'a' });
      await draft.updateRow(NOTES, 'n2', { title: 'dos', note: 'b' });
      await rewriteDraftRowData(draft, NOTES, 'n1', { title: 'one' });
      await rewriteDraftRowData(draft, NOTES, 'n2', {
        title: 'two',
        note: null,
      });

      const fields = await readFields(draft, { maxValueBytes: LIMIT });

      expect(
        fields.map(({ path, changeType, newValue, newValueBytes }) => [
          path,
          changeType,
          newValue,
          newValueBytes,
        ]),
      ).toEqual([
        ['/note', RowChangeDetailType.FieldRemoved, null, null],
        ['/note', RowChangeDetailType.FieldModified, '', 2],
      ]);
    });
  });

  async function givenCommittedProducts(
    rows: Record<string, ReturnType<typeof product>> = {},
  ): Promise<ChangesScenario> {
    return ChangesScenario.committed(kit, {
      [PRODUCTS]: {
        schema: productSchema,
        rows: { p1: product('Lamp'), p2: product('Desk'), ...rows },
      },
    });
  }

  async function readItems(
    draft: ChangesScenario,
    options: Omit<DraftRowOptions, 'first'>,
  ): Promise<DraftRowItem[]> {
    return rowItemsOf([
      await draft.readDraftRowChanges({ first: 100, ...options }),
    ]);
  }

  async function readFields(
    draft: ChangesScenario,
    options: Omit<DraftRowOptions, 'first'>,
  ): Promise<DraftFieldChange[]> {
    return (await readItems(draft, options)).flatMap(({ fields }) => fields);
  }

  // Native writes store neither a null for a string nor a row without one of its fields.
  async function rewriteDraftRowData(
    draft: ChangesScenario,
    tableId: string,
    rowId: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const row = await draft.row('draft', tableId, rowId);

    await kit.prisma.row.update({
      where: { versionId: row.versionId },
      data: { data: data as InputJsonValue, hash: objectHash(data) },
    });
  }
});

function product(title: string, price = 1, tags: string[] = []) {
  return { title, price, tags };
}

function bytesOf(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}

function withoutValues(item: DraftRowItem): DraftRowItem {
  return {
    ...item,
    fields: item.fields.map(
      ({
        oldValue: _oldValue,
        newValue: _newValue,
        oldValueBytes: _oldValueBytes,
        newValueBytes: _newValueBytes,
        oldValueCut: _oldValueCut,
        newValueCut: _newValueCut,
        oldValueToken: _oldValueToken,
        newValueToken: _newValueToken,
        ...rest
      }) => rest as DraftFieldChange,
    ),
  };
}
