import { ChangesScenario } from 'src/features/partial-changes-poc/__tests__/support/changes-scenario';
import {
  expectVersionsPreserved,
  readCommittedVersions,
} from 'src/features/partial-changes-poc/__tests__/support/committed-versions';
import { readDatabaseFootprint } from 'src/features/partial-changes-poc/__tests__/support/database-footprint';
import {
  createPartialChangesTestKit,
  PartialChangesTestKit,
} from 'src/features/partial-changes-poc/__tests__/support/partial-changes-test-kit';
import {
  orderSchema,
  pricedProductSchema,
} from 'src/features/partial-changes-poc/__tests__/support/schemas';
import { guardCommittedVersions } from 'src/features/partial-changes-poc/__tests__/support/committed-versions-guard';

describe('atomicity and immutability', () => {
  let kit: PartialChangesTestKit;

  beforeAll(async () => {
    kit = await createPartialChangesTestKit();
  });

  guardCommittedVersions(() => kit.guard);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await kit.close();
  });

  async function givenMixedEdits() {
    const scenario = await ChangesScenario.committed(kit, {
      products: {
        schema: pricedProductSchema,
        rows: {
          p1: { price: 10, qty: 2, total: 0 },
          p2: { price: 20, qty: 1, total: 0 },
        },
      },
      orders: {
        schema: orderSchema,
        rows: { o1: { product: 'p1', note: '' } },
      },
    });
    await scenario.patchRow('products', 'p1', { price: 11, qty: 3 });
    await scenario.patchRow('products', 'p2', { price: 21 });
    await scenario.createRow('products', 'p3', { price: 30, qty: 1, total: 0 });
    await scenario.patchRow('orders', 'o1', { product: 'p3' });
    return scenario;
  }

  const priceOfP1 = { tableId: 'products', rowId: 'p1', path: '/price' };

  it('persists nothing when a commit fails after its writes', async () => {
    const scenario = await givenMixedEdits();
    const before = await readDatabaseFootprint(kit.prisma);
    const committed = await readCommittedVersions(
      kit.prisma,
      scenario.branch.branchId,
    );
    jest
      .spyOn(kit.diffService, 'hasTableDiffs')
      .mockRejectedValueOnce(new Error('injected failure'));

    await expect(
      scenario.commitWithRequired({
        fields: [priceOfP1],
        rows: [{ tableId: 'orders', rowId: 'o1' }],
      }),
    ).rejects.toThrow('injected failure');

    expect(await readDatabaseFootprint(kit.prisma)).toEqual(before);
    expectVersionsPreserved(
      committed,
      await readCommittedVersions(kit.prisma, scenario.branch.branchId),
    );
  });

  it('persists nothing when a revert fails after its writes', async () => {
    const scenario = await givenMixedEdits();
    const before = await readDatabaseFootprint(kit.prisma);
    jest
      .spyOn(kit.diffService, 'hasTableDiffs')
      .mockRejectedValueOnce(new Error('injected failure'));

    await expect(scenario.revert({ fields: [priceOfP1] })).rejects.toThrow(
      'injected failure',
    );

    expect(await readDatabaseFootprint(kit.prisma)).toEqual(before);
    expect((await scenario.draftRow('products', 'p1')).data.price).toBe(11);
  });

  it('keeps every committed version byte-identical across a sequence of operations', async () => {
    const scenario = await givenMixedEdits();
    const branchId = scenario.branch.branchId;
    const operations: Array<() => Promise<unknown>> = [
      () => scenario.commit({ fields: [priceOfP1] }),
      () => scenario.patchRow('products', 'p2', { qty: 5 }),
      () => scenario.revert({ fields: [{ ...priceOfP1, rowId: 'p2' }] }),
      () =>
        scenario.commitWithRequired({
          rows: [{ tableId: 'orders', rowId: 'o1' }],
        }),
      () => scenario.patchRow('products', 'p3', { qty: 7 }),
      () => scenario.renameRow('products', 'p2', 'p2-renamed'),
      () => scenario.commit({ all: true }),
      () => scenario.patchRow('products', 'p1', { qty: 9 }),
      () => scenario.revert({ all: true }),
    ];

    for (const operation of operations) {
      const before = await readCommittedVersions(kit.prisma, branchId);
      await operation();
      expectVersionsPreserved(
        before,
        await readCommittedVersions(kit.prisma, branchId),
      );
    }

    expect((await scenario.headRow('products', 'p1')).data).toEqual({
      price: 11,
      qty: 3,
      total: 33,
    });
    expect(await scenario.draftHasChanges()).toBe(false);
  });
});
