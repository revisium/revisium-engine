import { ChangesScenario } from 'src/features/partial-changes-poc/__tests__/support/changes-scenario';
import {
  createPartialChangesTestKit,
  PartialChangesTestKit,
} from 'src/features/partial-changes-poc/__tests__/support/partial-changes-test-kit';
import {
  orderSchema,
  pricedProductSchema,
  product,
  productSchema,
} from 'src/features/partial-changes-poc/__tests__/support/schemas';
import { guardCommittedVersions } from 'src/features/partial-changes-poc/__tests__/support/committed-versions-guard';

describe('partial revert', () => {
  let kit: PartialChangesTestKit;

  beforeAll(async () => {
    kit = await createPartialChangesTestKit();
  });

  guardCommittedVersions(() => kit.guard);

  afterAll(async () => {
    await kit.close();
  });

  async function givenTwoEditedProducts() {
    const scenario = await ChangesScenario.committed(kit, {
      products: {
        schema: productSchema,
        rows: { p1: product('one', 10), p2: product('two', 20) },
      },
    });
    await scenario.patchRow('products', 'p1', { price: 11 });
    await scenario.patchRow('products', 'p2', { price: 21 });
    return scenario;
  }

  it('reverts one row to its Head version and keeps the other edit in the same Draft', async () => {
    const scenario = await givenTwoEditedProducts();
    const headRevisionId = await scenario.headRevisionId();
    const draftRevisionId = await scenario.draftRevisionId();
    const head = await scenario.headRow('products', 'p1');

    const result = await scenario.revert({
      rows: [{ tableId: 'products', rowId: 'p1' }],
    });

    expect(result).toMatchObject({
      status: 'applied',
      headRevisionId,
      draftRevisionId,
      remaining: { units: 1 },
    });
    expect(await scenario.draftRow('products', 'p1')).toEqual(head);
    expect((await scenario.draftRow('products', 'p2')).data.price).toBe(21);
    expect(await scenario.headRevisionId()).toBe(headRevisionId);
    expect(await scenario.draftHasChanges()).toBe(true);
  });

  it('marks the Draft unchanged when its last change is reverted', async () => {
    const scenario = await givenTwoEditedProducts();

    await scenario.revert({
      rows: [
        { tableId: 'products', rowId: 'p1' },
        { tableId: 'products', rowId: 'p2' },
      ],
    });

    expect(await scenario.draftHasChanges()).toBe(false);
    expect(await scenario.preview('revert', { all: true })).toMatchObject({
      status: 'empty',
    });
  });

  it('reverts one field and recomputes the formula of the row', async () => {
    const scenario = await ChangesScenario.committed(kit, {
      products: {
        schema: pricedProductSchema,
        rows: { p1: { price: 10, qty: 2, total: 0 } },
      },
    });
    await scenario.patchRow('products', 'p1', { price: 11, qty: 3 });

    await scenario.revert({
      fields: [{ tableId: 'products', rowId: 'p1', path: '/price' }],
    });

    const draft = await scenario.draftRow('products', 'p1');
    expect(draft.data).toEqual({ price: 10, qty: 3, total: 30 });
    expect(draft.readonly).toBe(false);
  });

  it('reverts a row rename and keeps the field edit of the renamed row', async () => {
    const scenario = await ChangesScenario.committed(kit, {
      products: { schema: productSchema, rows: { p1: product('one', 10) } },
    });
    await scenario.renameRow('products', 'p1', 'p1-renamed');
    await scenario.patchRow('products', 'p1-renamed', { price: 11 });
    const row = { tableId: 'products', rowId: 'p1-renamed' };

    await scenario.revert({
      rows: [row],
      exclude: { fields: [{ ...row, path: '/price' }] },
    });

    expect(await scenario.draftRowIds('products')).toEqual(['p1']);
    expect((await scenario.draftRow('products', 'p1')).data.price).toBe(11);
  });

  describe('reverse dependencies', () => {
    function givenCatalog(products: string[]) {
      return ChangesScenario.committed(kit, {
        products: {
          schema: productSchema,
          rows: Object.fromEntries(products.map((id) => [id, product(id, 1)])),
        },
        orders: {
          schema: orderSchema,
          rows: { o1: { product: 'p1', note: '' } },
        },
      });
    }

    const orderProduct = { tableId: 'orders', rowId: 'o1', path: '/product' };

    it('requires the remaining edit that references a row whose creation is reverted', async () => {
      const scenario = await givenCatalog(['p1']);
      await scenario.createRow('products', 'p2', product('p2', 2));
      await scenario.patchRow('orders', 'o1', { product: 'p2' });

      const preview = await scenario.preview('revert', {
        rows: [{ tableId: 'products', rowId: 'p2' }],
      });

      expect(preview.status).toBe('required');
      expect(preview.required).toEqual([
        {
          unit: { kind: 'field', ...orderProduct },
          reason: expect.objectContaining({ code: 'referrerStillReferences' }),
        },
      ]);
    });

    it('reverts the created row and the referencing edit together', async () => {
      const scenario = await givenCatalog(['p1']);
      await scenario.createRow('products', 'p2', product('p2', 2));
      await scenario.patchRow('orders', 'o1', { product: 'p2' });

      const result = await scenario.revertWithRequired({
        rows: [{ tableId: 'products', rowId: 'p2' }],
      });

      expect(result.status).toBe('applied');
      expect(await scenario.draftRowIds('products')).toEqual(['p1']);
      expect((await scenario.draftRow('orders', 'o1')).data.product).toBe('p1');
    });

    it('requires restoring a deleted row that a reverted field points to again', async () => {
      const scenario = await givenCatalog(['p1', 'p2']);
      await scenario.patchRow('orders', 'o1', { product: 'p2' });
      await scenario.removeRow('products', 'p1');

      const preview = await scenario.preview('revert', {
        fields: [orderProduct],
      });

      expect(preview.required).toEqual([
        {
          unit: { kind: 'rowDelete', tableId: 'products', rowId: 'p1' },
          reason: expect.objectContaining({ code: 'referencedRowMissing' }),
        },
      ]);
    });
  });
});
