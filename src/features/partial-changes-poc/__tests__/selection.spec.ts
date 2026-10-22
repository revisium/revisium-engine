import { arr, num, obj, str } from '@revisium/schema-toolkit/mocks';
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

describe('selection', () => {
  let kit: PartialChangesTestKit;

  beforeAll(async () => {
    kit = await createPartialChangesTestKit();
  });

  afterAll(async () => {
    await kit.close();
  });

  async function givenEditsInTwoTables() {
    const scenario = await ChangesScenario.committed(kit, {
      products: {
        schema: productSchema,
        rows: { p1: product('one', 10), p2: product('two', 20) },
      },
      orders: {
        schema: orderSchema,
        rows: { o1: { product: 'p1', note: '' } },
      },
    });
    await scenario.patchRow('products', 'p1', { price: 11, title: 'ONE' });
    await scenario.patchRow('products', 'p2', { price: 21 });
    await scenario.patchRow('orders', 'o1', { note: 'edited' });
    return scenario;
  }

  it('selects every data unit of a table with tableData', async () => {
    const scenario = await givenEditsInTwoTables();

    const preview = await scenario.preview('commit', {
      tableData: ['products'],
    });

    expect(preview.counts).toEqual({ selected: 3, required: 0, remaining: 1 });
  });

  it('removes excluded units from an all selection', async () => {
    const scenario = await givenEditsInTwoTables();

    await scenario.commit({
      all: true,
      exclude: { rows: [{ tableId: 'products', rowId: 'p2' }] },
    });

    expect((await scenario.headRow('products', 'p1')).data).toEqual(
      product('ONE', 11),
    );
    expect((await scenario.headRow('products', 'p2')).data.price).toBe(20);
    expect((await scenario.headRow('orders', 'o1')).data.note).toBe('edited');
  });

  it('returns empty for a selection without units', async () => {
    const scenario = await givenEditsInTwoTables();

    const result = await scenario.commit({ tableData: [] });

    expect(result).toEqual({ status: 'empty' });
  });

  it('reports selectors that match no change', async () => {
    const scenario = await givenEditsInTwoTables();

    const preview = await scenario.preview('commit', {
      rows: [
        { tableId: 'products', rowId: 'p1' },
        { tableId: 'products', rowId: 'missing' },
      ],
    });

    expect(preview.unmatched).toEqual({
      rows: [{ tableId: 'products', rowId: 'missing' }],
    });
    expect(preview.status).toBe('ready');
  });

  it('requires the whole array when a path inside it is selected', async () => {
    const scenario = await ChangesScenario.committed(kit, {
      lists: {
        schema: obj({ name: str(), tags: arr(str()) }),
        rows: { l1: { name: 'list', tags: ['a'] } },
      },
    });
    await scenario.updateRow('lists', 'l1', {
      name: 'renamed',
      tags: ['a', 'b'],
    });

    const preview = await scenario.preview('commit', {
      fields: [{ tableId: 'lists', rowId: 'l1', path: '/tags/1' }],
    });

    expect(preview.required).toEqual([
      {
        unit: { kind: 'field', tableId: 'lists', rowId: 'l1', path: '/tags' },
        reason: expect.objectContaining({ code: 'atomicValue' }),
      },
    ]);
  });

  it('requires the whole created row when one of its fields is selected', async () => {
    const scenario = await givenEditsInTwoTables();
    await scenario.createRow('products', 'p3', product('three', 30));

    const preview = await scenario.preview('commit', {
      fields: [{ tableId: 'products', rowId: 'p3', path: '/price' }],
    });

    expect(
      preview.required.map(({ unit, reason }) => [unit, reason.code]),
    ).toEqual([
      [{ kind: 'rowCreate', tableId: 'products', rowId: 'p3' }, 'wholeRowUnit'],
    ]);
  });

  it('finds no unit for a row edited back to its Head value although the Draft stays marked changed', async () => {
    const scenario = await ChangesScenario.committed(kit, {
      products: { schema: productSchema, rows: { p1: product('one', 10) } },
    });
    await scenario.patchRow('products', 'p1', { price: 11 });
    await scenario.patchRow('products', 'p1', { price: 10 });

    const result = await scenario.commit({ all: true });

    expect(result).toEqual({ status: 'empty' });
    expect(await scenario.draftHasChanges()).toBe(true);
  });

  describe('tables with a structure change (M2: BR-007 split, adapted from the M1 boundary)', () => {
    async function givenStructureAndDataChanges() {
      const scenario = await givenEditsInTwoTables();
      await scenario.addField('products', 'weight', num());
      return scenario;
    }

    it('selects an unchanged-field edit of a table whose structure changed without its structure', async () => {
      const scenario = await givenStructureAndDataChanges();

      const preview = await scenario.preview('commit', {
        fields: [{ tableId: 'products', rowId: 'p1', path: '/price' }],
      });

      expect(preview.status).toBe('ready');
      expect(preview.required).toEqual([]);
    });

    it('commits the structure of one of two changed tables', async () => {
      const scenario = await givenStructureAndDataChanges();
      await scenario.addField('orders', 'weight', num());

      const result = await scenario.commit({ tables: ['products'] });

      expect(result.status).toBe('applied');
      expect((await scenario.headRow('products', 'p1')).data.weight).toBe(0);
      expect((await scenario.headRow('orders', 'o1')).data).toEqual({
        product: 'p1',
        note: '',
      });
    });

    it('commits data of other tables while the structure change stays in the Draft', async () => {
      const scenario = await givenStructureAndDataChanges();

      const result = await scenario.commit({ tableData: ['orders'] });

      expect(result.status).toBe('applied');
      expect((await scenario.headRow('orders', 'o1')).data.note).toBe('edited');
      expect((await scenario.headRow('products', 'p1')).data).toEqual(
        product('one', 10),
      );
      expect((await scenario.draftRow('products', 'p1')).data).toMatchObject({
        price: 11,
        weight: 0,
      });
    });
  });
});
