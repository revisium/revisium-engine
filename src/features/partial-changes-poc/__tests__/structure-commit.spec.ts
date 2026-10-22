import { num, numFormula, obj, str } from '@revisium/schema-toolkit/mocks';
import { ChangesScenario } from 'src/features/partial-changes-poc/__tests__/support/changes-scenario';
import {
  createPartialChangesTestKit,
  PartialChangesTestKit,
} from 'src/features/partial-changes-poc/__tests__/support/partial-changes-test-kit';
import {
  product,
  productSchema,
} from 'src/features/partial-changes-poc/__tests__/support/schemas';

describe('structure units (BR-007)', () => {
  let kit: PartialChangesTestKit;

  beforeAll(async () => {
    kit = await createPartialChangesTestKit();
  });

  afterAll(async () => {
    await kit.close();
  });

  async function givenColorAddedWhilePricesChange() {
    const scenario = await ChangesScenario.committed(kit, {
      products: {
        schema: productSchema,
        rows: { p1: product('one', 10), p2: product('two', 20) },
      },
    });
    await scenario.addField('products', 'color', str());
    await scenario.patchRow('products', 'p1', { price: 11, color: 'red' });
    await scenario.patchRow('products', 'p2', { color: 'blue' });
    return scenario;
  }

  const priceOf = (rowId: string) => ({
    tableId: 'products',
    rowId,
    path: '/price',
  });

  describe('BR-007 example: prices now, color later', () => {
    it('commits a price edit without the new field', async () => {
      const scenario = await givenColorAddedWhilePricesChange();
      const headSchemas = await scenario.schemas('head');
      const headLedger = await scenario.ledger('head');

      const result = await scenario.commit({ fields: [priceOf('p1')] });

      expect(result.status).toBe('applied');
      expect((await scenario.headRow('products', 'p1')).data).toEqual(
        product('one', 11),
      );
      expect(await scenario.schemas('head')).toEqual(headSchemas);
      expect(await scenario.ledger('head')).toEqual(headLedger);
      expect((await scenario.draftRow('products', 'p1')).data).toEqual({
        ...product('one', 11),
        color: 'red',
      });
    });

    it('commits the new field with its values later', async () => {
      const scenario = await givenColorAddedWhilePricesChange();
      await scenario.commit({ fields: [priceOf('p1')] });
      const draftSchemas = await scenario.schemas('draft');

      const result = await scenario.commit({ tables: ['products'] });

      expect(result.status).toBe('applied');
      expect(await scenario.schemas('head')).toEqual(draftSchemas);
      expect((await scenario.headRow('products', 'p1')).data).toEqual({
        ...product('one', 11),
        color: 'red',
      });
      expect((await scenario.headRow('products', 'p2')).data).toEqual({
        ...product('two', 20),
        color: 'blue',
      });
      expect(await scenario.draftHasChanges()).toBe(false);
    });
  });

  it('keeps unselected unchanged-field edits in the Draft when the structure is committed', async () => {
    const scenario = await givenColorAddedWhilePricesChange();

    const result = await scenario.commit({ tables: ['products'] });

    expect(result).toMatchObject({
      status: 'applied',
      applied: { selected: 1, required: 0 },
      remaining: { units: 1 },
    });
    expect((await scenario.headRow('products', 'p1')).data).toEqual({
      ...product('one', 10),
      color: 'red',
    });
    expect((await scenario.draftRow('products', 'p1')).data).toEqual({
      ...product('one', 11),
      color: 'red',
    });
  });

  it('requires the structure for a value of a new field', async () => {
    const scenario = await givenColorAddedWhilePricesChange();

    const preview = await scenario.preview('commit', {
      fields: [{ tableId: 'products', rowId: 'p1', path: '/color' }],
    });

    expect(preview.status).toBe('required');
    expect(preview.required).toEqual([
      {
        unit: { kind: 'structure', tableId: 'products' },
        reason: expect.objectContaining({
          code: 'structureBoundData',
          path: '/color',
        }),
      },
    ]);
  });

  it('selects only unchanged-field edits with tableData', async () => {
    const scenario = await givenColorAddedWhilePricesChange();

    const preview = await scenario.preview('commit', {
      tableData: ['products'],
    });

    expect(preview.status).toBe('ready');
    expect(preview.sample).toEqual([
      { kind: 'field', tableId: 'products', rowId: 'p1', path: '/price' },
    ]);
  });

  it('commits a created row in the Head structure without the new field', async () => {
    const scenario = await givenColorAddedWhilePricesChange();
    await scenario.createRow('products', 'p3', {
      ...product('three', 30),
      color: 'green',
    });

    const result = await scenario.commit({
      rows: [{ tableId: 'products', rowId: 'p3' }],
    });

    expect(result.status).toBe('applied');
    expect((await scenario.headRow('products', 'p3')).data).toEqual(
      product('three', 30),
    );
    expect((await scenario.draftRow('products', 'p3')).data.color).toBe(
      'green',
    );
  });

  it('lists new-field values of a created row as deferred with the structure', async () => {
    const scenario = await givenColorAddedWhilePricesChange();
    await scenario.createRow('products', 'p3', {
      ...product('three', 30),
      color: 'green',
    });

    const preview = await scenario.preview('commit', {
      rows: [{ tableId: 'products', rowId: 'p3' }],
    });

    expect(preview.status).toBe('ready');
    expect(preview.deferred).toEqual([
      {
        unit: { kind: 'rowCreate', tableId: 'products', rowId: 'p3' },
        paths: ['/color'],
        structure: { kind: 'structure', tableId: 'products' },
      },
    ]);
  });

  it('defers nothing when the created row is committed with the structure', async () => {
    const scenario = await givenColorAddedWhilePricesChange();
    await scenario.createRow('products', 'p3', {
      ...product('three', 30),
      color: 'green',
    });

    const preview = await scenario.preview('commit', {
      tables: ['products'],
      rows: [{ tableId: 'products', rowId: 'p3' }],
    });

    expect(preview.status).toBe('ready');
    expect(preview.deferred).toEqual([]);
  });

  it('migrates a Head row whose deletion stays in the Draft into the committed structure', async () => {
    const scenario = await givenColorAddedWhilePricesChange();
    await scenario.removeRow('products', 'p2');

    const result = await scenario.commit({ tables: ['products'] });

    expect(result.status).toBe('applied');
    expect((await scenario.headRow('products', 'p2')).data).toEqual({
      ...product('two', 20),
      color: '',
    });
    expect(await scenario.draftRowIds('products')).toEqual(['p1']);
  });

  describe('freshness of a structure unit', () => {
    it('returns stale when the selected table structure changed after the preview', async () => {
      const scenario = await givenColorAddedWhilePricesChange();
      const { fingerprint } = await scenario.preview('commit', {
        tables: ['products'],
      });
      const revisions = await scenario.revisionCount();
      await scenario.addField('products', 'size', str());

      const result = await scenario.commit(
        { tables: ['products'] },
        { expected: fingerprint },
      );

      expect(result).toEqual({ status: 'stale' });
      expect(await scenario.revisionCount()).toBe(revisions);
    });

    it('applies when only another table changed after the preview', async () => {
      const scenario = await givenColorAddedWhilePricesChange();
      await scenario.createTable('tags', productSchema);
      const { fingerprint } = await scenario.preview('commit', {
        tables: ['products'],
      });
      await scenario.addField('tags', 'size', str());

      const result = await scenario.commit(
        { tables: ['products'] },
        { expected: fingerprint },
      );

      expect(result.status).toBe('applied');
    });
  });

  it('computes formulas of merged rows with the target structure', async () => {
    const scenario = await ChangesScenario.committed(kit, {
      lines: {
        schema: obj({
          price: num(),
          qty: num(),
          total: numFormula('price * qty'),
        }),
        rows: { l1: { price: 10, qty: 2, total: 0 } },
      },
    });
    await scenario.updateTable('lines', [
      {
        op: 'replace',
        path: '/properties/total',
        value: numFormula('price * qty * 2'),
      },
    ]);
    await scenario.patchRow('lines', 'l1', { price: 11 });

    await scenario.commit({
      fields: [{ tableId: 'lines', rowId: 'l1', path: '/price' }],
    });

    expect((await scenario.headRow('lines', 'l1')).data).toEqual({
      price: 11,
      qty: 2,
      total: 22,
    });
    expect((await scenario.draftRow('lines', 'l1')).data.total).toBe(44);
  });
});
