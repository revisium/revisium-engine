import {
  Barrier,
  pauseOnce,
} from 'src/features/partial-changes-poc/__tests__/support/barrier';
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
import { CommitWriter } from 'src/features/partial-changes-poc/write/commit-writer.service';
import { RevertWriter } from 'src/features/partial-changes-poc/write/revert-writer.service';

describe('concurrency of partial operations', () => {
  let kit: PartialChangesTestKit;

  beforeAll(async () => {
    kit = await createPartialChangesTestKit();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await kit.close();
  });

  async function givenEditedProducts() {
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
    await scenario.patchRow('products', 'p1', { price: 11, qty: 2 });
    await scenario.patchRow('products', 'p2', { price: 21 });
    return scenario;
  }

  async function whilePaused<T>(
    writer: object,
    operation: () => Promise<T>,
    racer: () => Promise<unknown>,
  ): Promise<{ result: T; writeAttempts: number }> {
    const barrier = new Barrier();
    const spy = pauseOnce(writer, 'write' as never, barrier);
    const pending = operation();
    await barrier.whenReached();
    await racer();
    barrier.release();
    const result = await pending;
    return { result, writeAttempts: spy.mock.calls.length };
  }

  it('keeps a native write to an untouched table that lands while a commit is planned', async () => {
    const scenario = await givenEditedProducts();

    const { result, writeAttempts } = await whilePaused(
      kit.module.get(CommitWriter),
      () => scenario.commit({ rows: [{ tableId: 'products', rowId: 'p1' }] }),
      () => scenario.patchRow('orders', 'o1', { note: 'raced' }),
    );

    expect(result.status).toBe('applied');
    expect((await scenario.draftRow('orders', 'o1')).data.note).toBe('raced');
    expect((await scenario.headRow('orders', 'o1')).data.note).toBe('');
    expect((await scenario.headRow('products', 'p1')).data.price).toBe(11);
    expect(writeAttempts).toBe(2);
  });

  it('commits the latest value of a selected field that changed while the commit was planned', async () => {
    const scenario = await givenEditedProducts();

    const { writeAttempts } = await whilePaused(
      kit.module.get(CommitWriter),
      () =>
        scenario.commit({
          fields: [{ tableId: 'products', rowId: 'p1', path: '/price' }],
        }),
      () => scenario.patchRow('products', 'p1', { price: 13 }),
    );

    expect((await scenario.headRow('products', 'p1')).data).toEqual(
      product('one', 13),
    );
    expect((await scenario.draftRow('products', 'p1')).data).toEqual(
      product('one', 13, 2),
    );
    expect(writeAttempts).toBe(2);
  });

  it('serializes two racing partial commits into consecutive revisions', async () => {
    const scenario = await givenEditedProducts();
    const firstHead = await scenario.headRevisionId();
    let second: Promise<unknown> = Promise.resolve();

    const { result: first, writeAttempts } = await whilePaused(
      kit.module.get(CommitWriter),
      () => scenario.commit({ rows: [{ tableId: 'products', rowId: 'p1' }] }),
      async () => {
        second = scenario.commit({
          rows: [{ tableId: 'products', rowId: 'p2' }],
        });
        await second;
      },
    );

    expect(first.status).toBe('applied');
    expect(await second).toMatchObject({
      status: 'applied',
      previousHeadRevisionId: firstHead,
    });
    expect(first.previousHeadRevisionId).not.toBe(firstHead);
    const revisions = await kit.prisma.revision.findMany({
      where: { branchId: scenario.branch.branchId },
    });
    expect(revisions.filter((revision) => revision.isHead)).toHaveLength(1);
    expect(revisions.filter((revision) => revision.isDraft)).toHaveLength(1);
    expect((await scenario.headRow('products', 'p1')).data.price).toBe(11);
    expect((await scenario.headRow('products', 'p2')).data.price).toBe(21);
    expect(await scenario.draftHasChanges()).toBe(false);
    expect(writeAttempts).toBe(3);
  });

  it('keeps a native write that lands while a partial revert is planned', async () => {
    const scenario = await givenEditedProducts();

    const { result, writeAttempts } = await whilePaused(
      kit.module.get(RevertWriter),
      () => scenario.revert({ rows: [{ tableId: 'products', rowId: 'p1' }] }),
      () => scenario.patchRow('orders', 'o1', { note: 'raced' }),
    );

    expect(result.status).toBe('applied');
    expect((await scenario.draftRow('orders', 'o1')).data.note).toBe('raced');
    expect((await scenario.draftRow('products', 'p1')).data.price).toBe(10);
    expect(writeAttempts).toBe(2);
  });
});
