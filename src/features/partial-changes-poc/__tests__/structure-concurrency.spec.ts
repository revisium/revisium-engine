import { num, str } from '@revisium/schema-toolkit/mocks';
import { MigrationLockedException } from 'src/features/migration/exceptions/migration-locked.exception';
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
  expectLedgerReplaysTo,
  expectReplicaMirrorsHead,
  Replica,
} from 'src/features/partial-changes-poc/__tests__/support/replica';
import {
  orderSchema,
  product,
  productSchema,
} from 'src/features/partial-changes-poc/__tests__/support/schemas';
import { CommitWriter } from 'src/features/partial-changes-poc/write/commit-writer.service';
import { guardCommittedVersions } from 'src/features/partial-changes-poc/__tests__/support/committed-versions-guard';

const ASYNC_THRESHOLD = 3;

describe('concurrency of partial structure operations', () => {
  let kit: PartialChangesTestKit;

  beforeAll(async () => {
    kit = await createPartialChangesTestKit({
      migrationOptions: { threshold: ASYNC_THRESHOLD, workerMode: 'disabled' },
    });
  });

  guardCommittedVersions(() => kit.guard);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await kit.close();
  });

  async function givenProductsThenOrdersChanged() {
    const scenario = await ChangesScenario.committed(kit, {
      products: {
        schema: productSchema,
        rows: {
          p1: product('one', 1),
          p2: product('two', 2),
          p3: product('three', 3),
        },
      },
      orders: {
        schema: orderSchema,
        rows: { o1: { product: 'p1', note: '' } },
      },
    });
    await scenario.renameTable('products', 'goods');
    await scenario.addField('orders', 'weight', num());
    return scenario;
  }

  async function commitWhilePaused(
    scenario: ChangesScenario,
    racer: () => Promise<unknown>,
  ) {
    const barrier = new Barrier();
    const spy = pauseOnce(kit.module.get(CommitWriter), 'write', barrier);
    const pending = scenario.commit({ tables: ['orders', 'goods'] }).then(
      (result) => ({ result, error: undefined }),
      (error: unknown) => ({ result: undefined, error }),
    );
    await barrier.whenReached();
    await racer();
    barrier.release();
    return { ...(await pending), writeAttempts: spy.mock.calls.length };
  }

  it('keeps a native structure change that lands while a structure commit is planned', async () => {
    const scenario = await givenProductsThenOrdersChanged();
    const replica = await Replica.create(kit);
    await expectReplicaMirrorsHead(replica, scenario);

    const { result, writeAttempts } = await commitWhilePaused(scenario, () =>
      scenario.addField('orders', 'color', str()),
    );

    expect(result?.status).toBe('applied');
    expect(writeAttempts).toBe(2);
    expect((await scenario.draftRow('orders', 'o1')).data).toMatchObject({
      weight: 0,
      color: '',
    });
    await expectReplicaMirrorsHead(replica, scenario);
    await expectLedgerReplaysTo(kit, scenario, 'draft');
  });

  it('refuses a structure commit when an async migration starts while it is planned', async () => {
    const scenario = await givenProductsThenOrdersChanged();
    const head = await scenario.headRevisionId();

    const { result, error } = await commitWhilePaused(scenario, () =>
      scenario.startBackgroundUpdate('goods', [
        { op: 'add', path: '/properties/color', value: str() },
      ]),
    );

    expect(result?.status).not.toBe('applied');
    expect(error).toBeInstanceOf(MigrationLockedException);
    expect(await scenario.headRevisionId()).toBe(head);
  });
});
