import { ChangesScenario } from 'src/features/partial-changes-poc/__tests__/support/changes-scenario';
import { readDatabaseFootprint } from 'src/features/partial-changes-poc/__tests__/support/database-footprint';
import {
  createPartialChangesTestKit,
  PartialChangesTestKit,
} from 'src/features/partial-changes-poc/__tests__/support/partial-changes-test-kit';
import {
  orderSchema,
  product,
  productSchema,
} from 'src/features/partial-changes-poc/__tests__/support/schemas';

describe('preview, freshness and retry', () => {
  let kit: PartialChangesTestKit;

  beforeAll(async () => {
    kit = await createPartialChangesTestKit();
  });

  afterAll(async () => {
    await kit.close();
  });

  const p1 = { tableId: 'products', rowId: 'p1' };

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

  it('writes nothing during preview, including a preview with required units', async () => {
    const scenario = await ChangesScenario.committed(kit, {
      products: { schema: productSchema, rows: { p1: product('p1', 1) } },
      orders: {
        schema: orderSchema,
        rows: { o1: { product: 'p1', note: '' } },
      },
    });
    await scenario.createRow('products', 'p2', product('p2', 2));
    await scenario.patchRow('orders', 'o1', { product: 'p2' });
    const before = await readDatabaseFootprint(kit.prisma);

    const preview = await scenario.preview('commit', {
      fields: [{ tableId: 'orders', rowId: 'o1', path: '/product' }],
    });

    expect(preview.status).toBe('required');
    expect(await readDatabaseFootprint(kit.prisma)).toEqual(before);
  });

  it('returns stale and writes nothing when a selected row changed after preview', async () => {
    const scenario = await givenTwoEditedProducts();
    const preview = await scenario.preview('commit', { rows: [p1] });
    await scenario.patchRow('products', 'p1', { price: 12 });
    const revisions = await scenario.revisionCount();

    const result = await scenario.commit(
      { rows: [p1] },
      { expected: preview.fingerprint },
    );

    expect(result).toEqual({ status: 'stale' });
    expect(await scenario.revisionCount()).toBe(revisions);
    expect((await scenario.headRow('products', 'p1')).data.price).toBe(10);
  });

  it('applies when only an unrelated row changed after preview', async () => {
    const scenario = await givenTwoEditedProducts();
    const preview = await scenario.preview('commit', { rows: [p1] });
    await scenario.patchRow('products', 'p2', { price: 22 });

    const result = await scenario.commit(
      { rows: [p1] },
      { expected: preview.fingerprint },
    );

    expect(result.status).toBe('applied');
    expect((await scenario.headRow('products', 'p2')).data.price).toBe(20);
    expect((await scenario.draftRow('products', 'p2')).data.price).toBe(22);
  });

  it('returns stale for a revert when a selected row changed after preview', async () => {
    const scenario = await givenTwoEditedProducts();
    const preview = await scenario.preview('revert', { rows: [p1] });
    await scenario.patchRow('products', 'p1', { price: 12 });

    const result = await scenario.revert(
      { rows: [p1] },
      { expected: preview.fingerprint },
    );

    expect(result).toEqual({ status: 'stale' });
    expect((await scenario.draftRow('products', 'p1')).data.price).toBe(12);
  });

  it('returns empty and creates no revision when an applied commit is repeated', async () => {
    const scenario = await givenTwoEditedProducts();
    const preview = await scenario.preview('commit', { rows: [p1] });
    await scenario.commit({ rows: [p1] }, { expected: preview.fingerprint });
    const revisions = await scenario.revisionCount();

    const retry = await scenario.commit(
      { rows: [p1] },
      { expected: preview.fingerprint },
    );

    expect(retry).toEqual({ status: 'empty' });
    expect(await scenario.revisionCount()).toBe(revisions);
  });

  it('accepts the preview fingerprint when the required units are included on commit', async () => {
    const scenario = await ChangesScenario.committed(kit, {
      products: { schema: productSchema, rows: { p1: product('p1', 1) } },
      orders: {
        schema: orderSchema,
        rows: { o1: { product: 'p1', note: '' } },
      },
    });
    await scenario.createRow('products', 'p2', product('p2', 2));
    await scenario.patchRow('orders', 'o1', { product: 'p2' });
    const selection = {
      fields: [{ tableId: 'orders', rowId: 'o1', path: '/product' }],
    };
    const preview = await scenario.preview('commit', selection);

    const result = await scenario.commit(selection, {
      includeRequired: true,
      expected: preview.fingerprint,
    });

    expect(result.status).toBe('applied');
  });
});
