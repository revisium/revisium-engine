import { num, str } from '@revisium/schema-toolkit/mocks';
import type { Migration } from '@revisium/schema-toolkit/types';
import { ChangesScenario } from 'src/features/partial-changes-poc/__tests__/support/changes-scenario';
import {
  createPartialChangesTestKit,
  PartialChangesTestKit,
} from 'src/features/partial-changes-poc/__tests__/support/partial-changes-test-kit';
import {
  expectLedgerReplaysTo,
  expectReplicaMirrorsHead,
  Replica,
} from 'src/features/partial-changes-poc/__tests__/support/replica';
import {
  orderSchema,
  product,
  productSchema,
} from 'src/features/partial-changes-poc/__tests__/support/schemas';

describe('migration ledger of partial structure commits', () => {
  let kit: PartialChangesTestKit;

  beforeAll(async () => {
    kit = await createPartialChangesTestKit();
  });

  afterAll(async () => {
    await kit.close();
  });

  async function givenProductsThenOrdersChanged() {
    const scenario = await ChangesScenario.committed(kit, {
      products: { schema: productSchema, rows: { p1: product('one', 10) } },
      orders: {
        schema: orderSchema,
        rows: { o1: { product: 'p1', note: '' } },
      },
    });
    await scenario.addField('products', 'color', str());
    await scenario.addField('orders', 'weight', num());
    const [products, orders] = expectTwo(
      pending(await scenario.ledger('head'), await scenario.ledger('draft')),
    );
    return { scenario, products, orders };
  }

  it('publishes the selected migration with its Draft id', async () => {
    const { scenario, orders } = await givenProductsThenOrdersChanged();
    const headLedger = await scenario.ledger('head');

    await scenario.commit({ tables: ['orders'] });

    expect(await scenario.ledger('head')).toEqual([...headLedger, orders]);
  });

  it('renumbers the remaining migration after the published one', async () => {
    const { scenario, products, orders } =
      await givenProductsThenOrdersChanged();

    await scenario.commit({ tables: ['orders'] });

    const [remaining] = pending(
      await scenario.ledger('head'),
      await scenario.ledger('draft'),
    );
    expect(remaining).toEqual({ ...products, id: expect.any(String) });
    expect((remaining?.id ?? '') > orders.id).toBe(true);
  });

  it('keeps ids when the remaining migrations already follow the published ones', async () => {
    const { scenario, orders } = await givenProductsThenOrdersChanged();

    await scenario.commit({ tables: ['products'] });

    expect(
      pending(await scenario.ledger('head'), await scenario.ledger('draft')),
    ).toEqual([orders]);
  });

  it('lets a replica synced from Head exports accept the partial commit', async () => {
    const { scenario } = await givenProductsThenOrdersChanged();
    const replica = await Replica.create(kit);
    await expectReplicaMirrorsHead(replica, scenario);

    await scenario.commit({ tables: ['orders'] });

    await expectReplicaMirrorsHead(replica, scenario);
  });

  it('lets the same replica accept the later commit of the renumbered remainder', async () => {
    const { scenario } = await givenProductsThenOrdersChanged();
    const replica = await Replica.create(kit);
    await expectReplicaMirrorsHead(replica, scenario);
    await scenario.commit({ tables: ['orders'] });
    await expectReplicaMirrorsHead(replica, scenario);

    await scenario.commit({ tables: ['products'] });

    await expectReplicaMirrorsHead(replica, scenario);
    await expectLedgerReplaysTo(kit, scenario, 'head');
  });

  it('keeps the remaining Draft ledger replayable to the Draft schemas', async () => {
    const { scenario } = await givenProductsThenOrdersChanged();

    await scenario.commit({ tables: ['orders'] });

    await expectLedgerReplaysTo(kit, scenario, 'draft');
  });

  it('records that a replica synced from the Draft export receives the renumbered migration again', async () => {
    const { scenario, products } = await givenProductsThenOrdersChanged();
    const replica = await Replica.create(kit);
    await replica.syncFromDraft(scenario);

    await scenario.commit({ tables: ['orders'] });
    const [renumbered] = pending(
      await scenario.ledger('head'),
      await scenario.ledger('draft'),
    );
    const results = await replica.syncFromDraft(scenario);

    expect(results.find(({ id }) => id === renumbered?.id)).toEqual({
      id: renumbered?.id,
      status: 'failed',
    });
    expect(await replica.headLedgerIds()).toContain(products.id);
  });
});

describe('interleaved operation sequences keep a Head-synced replica in sync', () => {
  let kit: PartialChangesTestKit;

  beforeAll(async () => {
    kit = await createPartialChangesTestKit();
  });

  afterAll(async () => {
    await kit.close();
  });

  it.each([
    [
      'partial commit, native edit, partial commit, native commit',
      'add products|add orders|commit orders|add orders|commit products|native commit',
    ],
    [
      'partial revert, native edit, partial commit, all',
      'add products|add orders|revert products|add products|commit orders|commit all',
    ],
    [
      'two migrations of one table published before the other table',
      'add products|add orders|add products|commit products|add orders|revert orders|add products|native commit',
    ],
    [
      'native commit between partial operations',
      'add products|add orders|native commit|add products|add orders|commit orders|revert products|add products|commit products',
    ],
    [
      'alternating partial commits and reverts',
      'add products|add orders|commit orders|revert products|add products|commit products|add orders|commit orders',
    ],
  ])('%s', async (_name, script) => {
    const scenario = await ChangesScenario.committed(kit, {
      products: { schema: productSchema, rows: { p1: product('one', 10) } },
      orders: {
        schema: orderSchema,
        rows: { o1: { product: 'p1', note: '' } },
      },
    });
    const replica = await Replica.create(kit);
    let fields = 0;

    for (const step of script.split('|')) {
      const [action, tableId = ''] = step.split(' ');
      if (action === 'add') {
        fields += 1;
        await scenario.addField(tableId, `field${fields}`, str());
      } else if (action === 'native') {
        await scenario.commitNatively();
      } else {
        const selection =
          tableId === 'all' ? { all: true } : { tables: [tableId] };
        const result =
          action === 'commit'
            ? await scenario.commit(selection)
            : await scenario.revert(selection);
        expect({ step, status: result.status }).toEqual({
          step,
          status: 'applied',
        });
      }
      await expectReplicaMirrorsHead(replica, scenario);
    }

    await expectLedgerReplaysTo(kit, scenario, 'draft');
  });
});

function expectTwo(migrations: Migration[]): [Migration, Migration] {
  const [first, second] = migrations;
  if (!first || !second || migrations.length !== 2) {
    throw new Error(
      `Expected two pending migrations, got ${migrations.length}`,
    );
  }
  return [first, second];
}

function pending(head: Migration[], draft: Migration[]): Migration[] {
  const published = new Set(head.map(({ id }) => id));
  return draft.filter(({ id }) => !published.has(id));
}
