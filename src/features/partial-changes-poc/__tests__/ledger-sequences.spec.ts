import { obj, str } from '@revisium/schema-toolkit/mocks';
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

type Step = {
  name: string;
  weight: number;
  run: (scenario: ChangesScenario, pick: Picker) => Promise<string>;
};

class Picker {
  private state: number;
  private counter = 0;

  constructor(seed: number) {
    this.state = seed;
  }

  next(): number {
    this.state = (this.state * 1103515245 + 12345) % 2147483648;
    return this.state / 2147483648;
  }

  one<T>(items: readonly T[]): T | undefined {
    return items[Math.floor(this.next() * items.length)];
  }

  weighted(items: readonly Step[]): Step | undefined {
    const total = items.reduce((sum, item) => sum + item.weight, 0);
    let point = this.next() * total;
    return items.find((item) => {
      point -= item.weight;
      return point < 0;
    });
  }

  name(prefix: string): string {
    this.counter += 1;
    return `${prefix}${this.counter}`;
  }
}

async function tablesWithPendingStructure(
  scenario: ChangesScenario,
): Promise<string[]> {
  const published = new Set(
    (await scenario.ledger('head')).map(({ id }) => id),
  );
  const draftTables = new Set(await scenario.tableIds('draft'));
  const touched = (await scenario.ledger('draft'))
    .filter(({ id }) => !published.has(id))
    .flatMap((migration) =>
      migration.changeType === 'rename'
        ? [migration.nextTableId]
        : [migration.tableId],
    );
  return [...new Set(touched)]
    .filter((tableId) => draftTables.has(tableId))
    .sort();
}

async function partialStructure(
  scenario: ChangesScenario,
  pick: Picker,
  operation: 'commit' | 'revert',
): Promise<string> {
  const tableId = pick.one(await tablesWithPendingStructure(scenario));
  if (!tableId) {
    return 'skipped';
  }
  const selection = { tables: [tableId] };
  const before = new Set((await scenario.ledger('draft')).map(({ id }) => id));
  const result =
    operation === 'commit'
      ? await scenario.commit(selection, { includeRequired: true })
      : await scenario.revert(selection, { includeRequired: true });
  const renumbered = (await scenario.ledger('draft')).filter(
    ({ id }) => !before.has(id),
  ).length;
  const blockers = result.blockers ? ` ${JSON.stringify(result.blockers)}` : '';
  return `${tableId}: ${result.status}, renumbered ${renumbered}${blockers}`;
}

const steps: Step[] = [
  {
    name: 'native: add a field',
    weight: 5,
    run: async (scenario, pick) => {
      const tableId = pick.one(await scenario.tableIds('draft'));
      if (!tableId) {
        return 'skipped';
      }
      await scenario.addField(tableId, pick.name('f'), str());
      return tableId;
    },
  },
  {
    name: 'native: create a table',
    weight: 1,
    run: async (scenario, pick) => {
      const tableId = pick.name('t');
      await scenario.createTable(tableId, obj({ label: str() }));
      await scenario.createRow(tableId, 'r1', { label: tableId });
      return tableId;
    },
  },
  {
    name: 'native: rename a table',
    weight: 2,
    run: async (scenario, pick) => {
      const tableId = pick.one(await scenario.tableIds('draft'));
      if (!tableId) {
        return 'skipped';
      }
      const nextTableId = pick.name('n');
      await scenario.renameTable(tableId, nextTableId);
      return `${tableId}->${nextTableId}`;
    },
  },
  {
    name: 'native: edit a row',
    weight: 2,
    run: async (scenario, pick) => {
      if (!(await scenario.tableIds('draft')).includes('products')) {
        return 'skipped';
      }
      await scenario.patchRow('products', 'p1', {
        price: Math.round(pick.next() * 100),
      });
      return 'products/p1';
    },
  },
  {
    name: 'partial commit of one table structure',
    weight: 6,
    run: (scenario, pick) => partialStructure(scenario, pick, 'commit'),
  },
  {
    name: 'partial revert of one table structure',
    weight: 3,
    run: (scenario, pick) => partialStructure(scenario, pick, 'revert'),
  },
  {
    name: 'partial commit of table data',
    weight: 1,
    run: async (scenario) => {
      const result = await scenario.commit(
        { tableData: ['products'] },
        { includeRequired: true },
      );
      return result.status;
    },
  },
  {
    name: 'native full commit',
    weight: 1,
    run: async (scenario) => {
      if (!(await scenario.draftHasChanges())) {
        return 'skipped';
      }
      await scenario.commitNatively();
      return 'committed';
    },
  },
  {
    name: 'all: true commit',
    weight: 1,
    run: async (scenario) => (await scenario.commit({ all: true })).status,
  },
];

const SEEDS = [11, 23, 37, 41, 59, 73, 89, 97];
const STEPS_PER_SEQUENCE = 20;

describe('ledger stays replayable across operation sequences (property-style)', () => {
  let kit: PartialChangesTestKit;

  beforeAll(async () => {
    kit = await createPartialChangesTestKit();
  });

  afterAll(async () => {
    await kit.close();
  });

  it.each(SEEDS)(
    'keeps a Head-synced replica and the Draft ledger consistent for seed %i',
    async (seed) => {
      const pick = new Picker(seed);
      const scenario = await ChangesScenario.committed(kit, {
        products: { schema: productSchema, rows: { p1: product('one', 1) } },
        orders: {
          schema: orderSchema,
          rows: { o1: { product: 'p1', note: '' } },
        },
      });
      const replica = await Replica.create(kit);
      const history: string[] = [];
      await givenInterleavedPendingStructure(scenario);

      for (let index = 0; index < STEPS_PER_SEQUENCE; index++) {
        const step = pick.weighted(steps);
        if (!step) {
          continue;
        }
        history.push(`${step.name}: ${await step.run(scenario, pick)}`);
        await expectWithHistory(history, () =>
          expectReplicaMirrorsHead(replica, scenario),
        );
      }

      await expectWithHistory(history, () =>
        expectLedgerReplaysTo(kit, scenario, 'draft'),
      );
      await scenario.commit({ all: true });
      await expectWithHistory(history, () =>
        expectReplicaMirrorsHead(replica, scenario),
      );
      process.stdout.write(`seed ${seed}:\n  ${history.join('\n  ')}\n`);
    },
  );
});

async function givenInterleavedPendingStructure(
  scenario: ChangesScenario,
): Promise<void> {
  await scenario.addField('products', 'first', str());
  await scenario.addField('orders', 'second', str());
  await scenario.addField('products', 'third', str());
}

async function expectWithHistory(
  history: string[],
  assertion: () => Promise<void>,
): Promise<void> {
  try {
    await assertion();
  } catch (error) {
    throw new Error(
      `${(error as Error).message}\nafter steps:\n${history.join('\n')}`,
    );
  }
}
