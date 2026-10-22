import { ChangesScenario } from 'src/features/partial-changes-poc/__tests__/support/changes-scenario';
import {
  createPartialChangesTestKit,
  PartialChangesTestKit,
} from 'src/features/partial-changes-poc/__tests__/support/partial-changes-test-kit';
import {
  product,
  productSchema,
} from 'src/features/partial-changes-poc/__tests__/support/schemas';

describe('row identity units', () => {
  let kit: PartialChangesTestKit;

  beforeAll(async () => {
    kit = await createPartialChangesTestKit();
  });

  afterAll(async () => {
    await kit.close();
  });

  describe('reused row id', () => {
    async function givenReplacedRow() {
      const scenario = await ChangesScenario.committed(kit, {
        products: {
          schema: productSchema,
          rows: { p1: product('old', 10), p2: product('two', 20) },
        },
      });
      await scenario.removeRow('products', 'p1');
      await scenario.createRow('products', 'p1', product('new', 99));
      await scenario.patchRow('products', 'p2', { price: 21 });
      return scenario;
    }

    it('treats deletion and re-creation of the same id as one replace unit', async () => {
      const scenario = await givenReplacedRow();

      const preview = await scenario.preview('commit', {
        rows: [{ tableId: 'products', rowId: 'p1' }],
      });

      expect(preview.status).toBe('ready');
      expect(preview.sample).toEqual([
        { kind: 'rowReplace', tableId: 'products', rowId: 'p1' },
      ]);
    });

    it('commits the replacing row with its own identity', async () => {
      const scenario = await givenReplacedRow();
      const replacing = await scenario.draftRow('products', 'p1');

      await scenario.commit({ rows: [{ tableId: 'products', rowId: 'p1' }] });

      const head = await scenario.headRow('products', 'p1');
      expect(head.createdId).toBe(replacing.createdId);
      expect(head.data.title).toBe('new');
    });

    it('keeps the replaced row in Head when the replace unit is not selected', async () => {
      const scenario = await givenReplacedRow();
      const replaced = await scenario.headRow('products', 'p1');

      await scenario.commit({ rows: [{ tableId: 'products', rowId: 'p2' }] });

      expect(await scenario.headRow('products', 'p1')).toEqual(replaced);
      expect((await scenario.draftRow('products', 'p1')).data.title).toBe(
        'new',
      );
    });
  });

  describe('swap of two row ids', () => {
    async function givenSwappedRows() {
      const scenario = await ChangesScenario.committed(kit, {
        products: {
          schema: productSchema,
          rows: { a: product('first', 1), b: product('second', 2) },
        },
      });
      await scenario.renameRow('products', 'a', 'tmp');
      await scenario.renameRow('products', 'b', 'a');
      await scenario.renameRow('products', 'tmp', 'b');
      return scenario;
    }

    it('requires the other rename when only one side of a swap is selected', async () => {
      const scenario = await givenSwappedRows();
      const revisions = await scenario.revisionCount();

      const result = await scenario.commit({
        rows: [{ tableId: 'products', rowId: 'b' }],
      });

      expect(result.status).toBe('required');
      expect(result.required).toEqual([
        {
          unit: {
            kind: 'rowRename',
            tableId: 'products',
            rowId: 'a',
            previousRowId: 'b',
          },
          reason: expect.objectContaining({
            code: 'idOccupied',
            tableId: 'products',
            rowId: 'b',
          }),
        },
      ]);
      expect(await scenario.revisionCount()).toBe(revisions);
    });

    it('commits both renames of a swap with includeRequired', async () => {
      const scenario = await givenSwappedRows();

      const result = await scenario.commit(
        { rows: [{ tableId: 'products', rowId: 'b' }] },
        { includeRequired: true },
      );

      expect(result).toMatchObject({
        status: 'applied',
        applied: { selected: 1, required: 1 },
      });
      expect((await scenario.headRow('products', 'a')).data.title).toBe(
        'second',
      );
      expect((await scenario.headRow('products', 'b')).data.title).toBe(
        'first',
      );
    });
  });

  describe('row rename', () => {
    async function givenRenamedAndEditedRow() {
      const scenario = await ChangesScenario.committed(kit, {
        products: { schema: productSchema, rows: { p1: product('one', 10) } },
      });
      await scenario.renameRow('products', 'p1', 'p1-renamed');
      await scenario.patchRow('products', 'p1-renamed', { price: 11 });
      return scenario;
    }

    it('commits the rename without the field edit of the renamed row', async () => {
      const scenario = await givenRenamedAndEditedRow();
      const row = { tableId: 'products', rowId: 'p1-renamed' };

      await scenario.commit({
        rows: [row],
        exclude: { fields: [{ ...row, path: '/price' }] },
      });

      expect(await scenario.headRowIds('products')).toEqual(['p1-renamed']);
      expect(
        (await scenario.headRow('products', 'p1-renamed')).data.price,
      ).toBe(10);
      const remaining = await scenario.preview('commit', { all: true });
      expect(remaining.sample).toEqual([
        { ...row, kind: 'field', path: '/price' },
      ]);
    });

    it('commits the field edit of a renamed row under its Head id', async () => {
      const scenario = await givenRenamedAndEditedRow();

      await scenario.commit({
        fields: [{ tableId: 'products', rowId: 'p1-renamed', path: '/price' }],
      });

      expect(await scenario.headRowIds('products')).toEqual(['p1']);
      expect((await scenario.headRow('products', 'p1')).data.price).toBe(11);
      const remaining = await scenario.preview('commit', { all: true });
      expect(remaining.sample).toEqual([
        {
          kind: 'rowRename',
          tableId: 'products',
          rowId: 'p1-renamed',
          previousRowId: 'p1',
        },
      ]);
    });

    it('links the Draft row version when the whole renamed row is committed', async () => {
      const scenario = await givenRenamedAndEditedRow();
      const draft = await scenario.draftRow('products', 'p1-renamed');

      await scenario.commit({
        rows: [{ tableId: 'products', rowId: 'p1-renamed' }],
      });

      expect((await scenario.headRow('products', 'p1-renamed')).versionId).toBe(
        draft.versionId,
      );
    });

    it('requires the deletion of the row whose id the rename takes over', async () => {
      const scenario = await ChangesScenario.committed(kit, {
        products: {
          schema: productSchema,
          rows: { a: product('first', 1), b: product('second', 2) },
        },
      });
      await scenario.removeRow('products', 'b');
      await scenario.renameRow('products', 'a', 'b');

      const preview = await scenario.preview('commit', {
        rows: [{ tableId: 'products', rowId: 'b' }],
      });

      expect(preview.status).toBe('required');
      expect(preview.required.map(({ unit }) => unit)).toEqual([
        { kind: 'rowDelete', tableId: 'products', rowId: 'b' },
      ]);
    });

    it('reaches the deletion of an id taken over by a rename only through exclude, not by its public id', async () => {
      const scenario = await ChangesScenario.committed(kit, {
        products: {
          schema: productSchema,
          rows: { a: product('first', 1), b: product('second', 2) },
        },
      });
      await scenario.removeRow('products', 'b');
      await scenario.renameRow('products', 'a', 'b');

      await scenario.commit({
        tableData: ['products'],
        exclude: { rows: [{ tableId: 'products', rowId: 'b' }] },
      });

      expect(await scenario.headRowIds('products')).toEqual(['a']);
      expect((await scenario.headRow('products', 'a')).data.title).toBe(
        'first',
      );
    });
  });
});
