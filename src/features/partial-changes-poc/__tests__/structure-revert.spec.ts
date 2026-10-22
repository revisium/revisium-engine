import { num, str } from '@revisium/schema-toolkit/mocks';
import { ChangesScenario } from 'src/features/partial-changes-poc/__tests__/support/changes-scenario';
import {
  createPartialChangesTestKit,
  PartialChangesTestKit,
} from 'src/features/partial-changes-poc/__tests__/support/partial-changes-test-kit';
import { expectLedgerReplaysTo } from 'src/features/partial-changes-poc/__tests__/support/replica';
import {
  orderSchema,
  product,
  productSchema,
} from 'src/features/partial-changes-poc/__tests__/support/schemas';
import { guardCommittedVersions } from 'src/features/partial-changes-poc/__tests__/support/committed-versions-guard';

describe('structure revert', () => {
  let kit: PartialChangesTestKit;

  beforeAll(async () => {
    kit = await createPartialChangesTestKit();
  });

  guardCommittedVersions(() => kit.guard);

  afterAll(async () => {
    await kit.close();
  });

  async function givenTwoTablesChanged() {
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
    await scenario.addField('products', 'color', str());
    await scenario.addField('orders', 'weight', num());
    await scenario.patchRow('products', 'p1', { price: 11, color: 'red' });
    await scenario.createRow('products', 'p3', {
      ...product('three', 30),
      color: 'green',
    });
    await scenario.patchRow('orders', 'o1', { weight: 5 });
    return scenario;
  }

  it('maps the remaining Draft rows back to the Head structure', async () => {
    const scenario = await givenTwoTablesChanged();

    const result = await scenario.revert({ tables: ['products'] });

    expect(result.status).toBe('applied');
    expect((await scenario.schemas('draft')).products).toEqual(
      (await scenario.schemas('head')).products,
    );
    expect((await scenario.draftRow('products', 'p1')).data).toEqual(
      product('one', 11),
    );
    expect((await scenario.draftRow('products', 'p3')).data).toEqual(
      product('three', 30),
    );
  });

  it('keeps the structure of the other table in the Draft', async () => {
    const scenario = await givenTwoTablesChanged();

    await scenario.revert({ tables: ['products'] });

    expect((await scenario.draftRow('orders', 'o1')).data).toEqual({
      product: 'p1',
      note: '',
      weight: 5,
    });
  });

  it('drops the reverted migrations from the Draft ledger', async () => {
    const scenario = await givenTwoTablesChanged();
    const published = new Set(
      (await scenario.ledger('head')).map(({ id }) => id),
    );
    const before = await scenario.ledger('draft');

    await scenario.revert({ tables: ['products'] });

    expect(await scenario.ledger('draft')).toEqual(
      before.filter(
        (migration) =>
          published.has(migration.id) || migration.tableId !== 'products',
      ),
    );
    await expectLedgerReplaysTo(kit, scenario, 'draft');
  });

  it('takes Head values of changed fields for existing rows and Head defaults for created rows', async () => {
    const scenario = await ChangesScenario.committed(kit, {
      products: { schema: productSchema, rows: { p1: product('one', 10, 2) } },
    });
    await scenario.updateTable('products', [
      { op: 'replace', path: '/properties/qty', value: str() },
    ]);
    await scenario.patchRow('products', 'p1', { title: 'ONE', qty: 'many' });
    await scenario.createRow('products', 'p2', {
      title: 'two',
      price: 20,
      qty: 'few',
    });

    await scenario.revert({ tables: ['products'] });

    expect((await scenario.draftRow('products', 'p1')).data).toEqual(
      product('ONE', 10, 2),
    );
    expect((await scenario.draftRow('products', 'p2')).data).toEqual(
      product('two', 20, 0),
    );
  });

  it('restores a deleted row into the remaining Draft structure', async () => {
    const scenario = await givenTwoTablesChanged();
    await scenario.removeRow('products', 'p2');

    const result = await scenario.revert({
      rows: [{ tableId: 'products', rowId: 'p2' }],
    });

    expect(result.status).toBe('applied');
    expect((await scenario.draftRow('products', 'p2')).data).toEqual({
      ...product('two', 20),
      color: '',
    });
  });

  it('reverts a created table with its rows', async () => {
    const scenario = await givenTwoTablesChanged();
    await scenario.createTable('tags', productSchema);
    await scenario.createRow('tags', 't1', product('tag', 1));

    await scenario.revert({ tables: ['tags'] });

    expect(await scenario.tableIds('draft')).toEqual(['orders', 'products']);
    await expectLedgerReplaysTo(kit, scenario, 'draft');
  });

  it('restores a removed table with its Head rows', async () => {
    const scenario = await ChangesScenario.committed(kit, {
      products: { schema: productSchema, rows: { p1: product('one', 1) } },
      tags: { schema: productSchema, rows: { t1: product('tag', 1) } },
    });
    await scenario.removeTable('tags');

    await scenario.revert({ tables: ['tags'] });

    expect(await scenario.draftRowIds('tags')).toEqual(['t1']);
    expect(await scenario.draftHasChanges()).toBe(false);
  });
});
