import { ChangesScenario } from 'src/features/partial-changes-poc/__tests__/support/changes-scenario';
import {
  createPartialChangesTestKit,
  PartialChangesTestKit,
} from 'src/features/partial-changes-poc/__tests__/support/partial-changes-test-kit';
import {
  orderSchema,
  product,
  productSchema,
} from 'src/features/partial-changes-poc/__tests__/support/schemas';

describe('foreign keys in partial commit', () => {
  let kit: PartialChangesTestKit;

  beforeAll(async () => {
    kit = await createPartialChangesTestKit();
  });

  afterAll(async () => {
    await kit.close();
  });

  function givenCatalog(products: string[], orders: Record<string, string>) {
    return ChangesScenario.committed(kit, {
      products: {
        schema: productSchema,
        rows: Object.fromEntries(products.map((id) => [id, product(id, 1)])),
      },
      orders: {
        schema: orderSchema,
        rows: Object.fromEntries(
          Object.entries(orders).map(([id, productId]) => [
            id,
            { product: productId, note: '' },
          ]),
        ),
      },
    });
  }

  const orderProduct = { tableId: 'orders', rowId: 'o1', path: '/product' };

  describe('selected row references a row created in the Draft', () => {
    async function givenOrderMovedToNewProduct() {
      const scenario = await givenCatalog(['p1'], { o1: 'p1' });
      await scenario.createRow('products', 'p2', product('p2', 2));
      await scenario.patchRow('orders', 'o1', { product: 'p2' });
      return scenario;
    }

    it('requires the referenced new row and writes nothing', async () => {
      const scenario = await givenOrderMovedToNewProduct();
      const revisions = await scenario.revisionCount();

      const result = await scenario.commit({ fields: [orderProduct] });

      expect(result.status).toBe('required');
      expect(result.required).toEqual([
        {
          unit: { kind: 'rowCreate', tableId: 'products', rowId: 'p2' },
          reason: expect.objectContaining({
            code: 'referencedRowMissing',
            tableId: 'products',
            rowId: 'p2',
          }),
        },
      ]);
      expect(await scenario.revisionCount()).toBe(revisions);
    });

    it('commits the referenced row together with includeRequired', async () => {
      const scenario = await givenOrderMovedToNewProduct();

      const result = await scenario.commit(
        { fields: [orderProduct] },
        { includeRequired: true },
      );

      expect(result.status).toBe('applied');
      expect(await scenario.headRowIds('products')).toEqual(['p1', 'p2']);
      expect((await scenario.headRow('orders', 'o1')).data.product).toBe('p2');
      expect(
        await scenario.danglingReferences(
          'head',
          'orders',
          'product',
          'products',
        ),
      ).toEqual([]);
    });
  });

  describe('selected deletion of a row still referenced in the new Head', () => {
    async function givenOrderMovedAwayFromDeletedProduct() {
      const scenario = await givenCatalog(['p1', 'p2'], { o1: 'p1' });
      await scenario.patchRow('orders', 'o1', { product: 'p2' });
      await scenario.removeRow('products', 'p1');
      return scenario;
    }

    it('requires the referrer edit that moved the reference away', async () => {
      const scenario = await givenOrderMovedAwayFromDeletedProduct();

      const preview = await scenario.preview('commit', {
        rows: [{ tableId: 'products', rowId: 'p1' }],
      });

      expect(preview.status).toBe('required');
      expect(preview.required).toEqual([
        {
          unit: { kind: 'field', ...orderProduct },
          reason: expect.objectContaining({
            code: 'referrerStillReferences',
            tableId: 'orders',
            rowId: 'o1',
            path: '/product',
          }),
        },
      ]);
    });

    it('blocks the deletion when the required referrer edit is excluded', async () => {
      const scenario = await givenOrderMovedAwayFromDeletedProduct();
      const revisions = await scenario.revisionCount();

      const result = await scenario.commit(
        {
          rows: [{ tableId: 'products', rowId: 'p1' }],
          exclude: { fields: [orderProduct] },
        },
        { includeRequired: true },
      );

      expect(result.status).toBe('blocked');
      expect(result.blockers).toEqual([
        expect.objectContaining({
          code: 'requiredExcluded',
          tableId: 'orders',
        }),
      ]);
      expect(await scenario.revisionCount()).toBe(revisions);
      expect(await scenario.headRowIds('products')).toEqual(['p1', 'p2']);
    });
  });

  describe('rename of a referenced row', () => {
    async function givenRenamedReferencedProduct() {
      const scenario = await givenCatalog(['p1'], { o1: 'p1' });
      await scenario.renameRow('products', 'p1', 'p9');
      return scenario;
    }

    it('requires the referrer edits that the native rename rewrote', async () => {
      const scenario = await givenRenamedReferencedProduct();
      expect((await scenario.draftRow('orders', 'o1')).data.product).toBe('p9');

      const preview = await scenario.preview('commit', {
        rows: [{ tableId: 'products', rowId: 'p9' }],
      });

      expect(preview.required.map(({ unit }) => unit)).toEqual([
        { kind: 'field', ...orderProduct },
      ]);
    });

    it('requires the rename when only the rewritten reference is selected', async () => {
      const scenario = await givenRenamedReferencedProduct();

      const preview = await scenario.preview('commit', {
        fields: [orderProduct],
      });

      expect(preview.required.map(({ unit }) => unit)).toEqual([
        {
          kind: 'rowRename',
          tableId: 'products',
          rowId: 'p9',
          previousRowId: 'p1',
        },
      ]);
    });

    it('commits rename and rewritten references together without a dangling reference', async () => {
      const scenario = await givenRenamedReferencedProduct();

      const result = await scenario.commit(
        { rows: [{ tableId: 'products', rowId: 'p9' }] },
        { includeRequired: true },
      );

      expect(result.status).toBe('applied');
      expect(await scenario.headRowIds('products')).toEqual(['p9']);
      expect(
        await scenario.danglingReferences(
          'head',
          'orders',
          'product',
          'products',
        ),
      ).toEqual([]);
    });
  });

  describe('Draft already holding a dangling reference', () => {
    const NATIVE_REWRITE_LIMIT = 100;

    it('blocks committing a rename whose native referrer rewrite stopped at its limit', async () => {
      const scenario = await ChangesScenario.committed(
        kit,
        {
          products: { schema: productSchema, rows: { p1: product('p1', 1) } },
          orders: { schema: orderSchema },
        },
        (draft) =>
          draft.createRows(
            'orders',
            Object.fromEntries(
              Array.from({ length: NATIVE_REWRITE_LIMIT + 1 }, (_, index) => [
                `o${String(index).padStart(3, '0')}`,
                { product: 'p1', note: '' },
              ]),
            ),
          ),
      );
      await scenario.renameRow('products', 'p1', 'p9');
      expect(
        await scenario.danglingReferences(
          'draft',
          'orders',
          'product',
          'products',
        ),
      ).toEqual(['o100']);

      const result = await scenario.commit({ all: true });

      expect(result.status).toBe('blocked');
      expect(result.blockers).toEqual([
        expect.objectContaining({
          code: 'danglingInSource',
          tableId: 'orders',
        }),
      ]);
    });
  });
});
