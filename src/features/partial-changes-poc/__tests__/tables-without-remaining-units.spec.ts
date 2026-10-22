import { ChangesScenario } from 'src/features/partial-changes-poc/__tests__/support/changes-scenario';
import { guardCommittedVersions } from 'src/features/partial-changes-poc/__tests__/support/committed-versions-guard';
import {
  createPartialChangesTestKit,
  PartialChangesTestKit,
} from 'src/features/partial-changes-poc/__tests__/support/partial-changes-test-kit';
import {
  orderSchema,
  product,
  productSchema,
} from 'src/features/partial-changes-poc/__tests__/support/schemas';

describe('Draft tables without remaining units link the Head table version (decision 9)', () => {
  let kit: PartialChangesTestKit;

  beforeAll(async () => {
    kit = await createPartialChangesTestKit();
  });

  guardCommittedVersions(() => kit.guard);

  afterAll(async () => {
    await kit.close();
  });

  const p1 = { tableId: 'products', rowId: 'p1' };

  async function givenEditAndContentEqualVersions() {
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
    await scenario.patchRow('products', 'p1', { price: 11 });
    await scenario.patchRow('products', 'p2', { price: 21 });
    await scenario.patchRow('products', 'p2', { price: 20 });
    await scenario.patchRow('orders', 'o1', { note: 'edited' });
    await scenario.patchRow('orders', 'o1', { note: '' });
    return scenario;
  }

  it('leaves no Draft changes after an applied all: true commit, as native createRevision', async () => {
    const partial = await givenEditAndContentEqualVersions();
    const native = await givenEditAndContentEqualVersions();
    const draftTables = await partial.tableVersions('draft');

    const result = await partial.commit({ all: true });
    await native.commitNatively();

    expect(result.status).toBe('applied');
    expect(await partial.tableVersions('head')).toEqual(draftTables);
    expect(await partial.draftHasChanges()).toBe(false);
    expect(await native.draftHasChanges()).toBe(false);
  });

  it('leaves no Draft changes after an applied all: true revert, as native revertChanges', async () => {
    const scenario = await givenEditAndContentEqualVersions();
    const headTables = await scenario.tableVersions('head');

    const result = await scenario.revert({ all: true });

    expect(result.status).toBe('applied');
    expect(await scenario.tableVersions('draft')).toEqual(headTables);
    expect(await scenario.draftHasChanges()).toBe(false);
  });

  it('links the new Head table versions into the Draft after a partial commit of the last unit', async () => {
    const scenario = await givenEditAndContentEqualVersions();

    const result = await scenario.commit({ rows: [p1] });

    expect(result.status).toBe('applied');
    expect(await scenario.tableVersions('draft')).toEqual(
      await scenario.tableVersions('head'),
    );
    expect(await scenario.draftHasChanges()).toBe(false);
  });

  it('links the Head table versions into the Draft after a partial revert of the last unit', async () => {
    const scenario = await givenEditAndContentEqualVersions();

    const result = await scenario.revert({ rows: [p1] });

    expect(result.status).toBe('applied');
    expect(await scenario.tableVersions('draft')).toEqual(
      await scenario.tableVersions('head'),
    );
    expect(await scenario.draftHasChanges()).toBe(false);
  });

  it('keeps the Draft version of a table that still has units', async () => {
    const scenario = await givenEditAndContentEqualVersions();
    await scenario.patchRow('orders', 'o1', { note: 'kept' });

    await scenario.commit({ rows: [p1] });

    expect((await scenario.draftRow('orders', 'o1')).data.note).toBe('kept');
    expect(await scenario.draftHasChanges()).toBe(true);
  });
});
