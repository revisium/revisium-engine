import { obj, str } from '@revisium/schema-toolkit/mocks';
import type { ApplyStatus } from 'src/features/partial-changes-poc/partial-changes.types';
import { Picker } from 'src/features/partial-changes-poc/__tests__/support/picker';
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
import { guardCommittedVersions } from 'src/features/partial-changes-poc/__tests__/support/committed-versions-guard';

type StepOutcome = {
  summary: string;
  status?: ApplyStatus;
  allowed?: ApplyStatus[];
};

type Step = {
  name: string;
  weight: number;
  run: (scenario: ChangesScenario, pick: Picker) => Promise<StepOutcome>;
};

const APPLIED: ApplyStatus[] = ['applied'];
const APPLIED_OR_EMPTY: ApplyStatus[] = ['applied', 'empty'];

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
  tableId: string,
  operation: 'commit' | 'revert',
): Promise<StepOutcome> {
  const selection = { tables: [tableId] };
  const result =
    operation === 'commit'
      ? await scenario.commitWithRequired(selection)
      : await scenario.revertWithRequired(selection);
  const renumbered = result.renumbered?.length ?? 0;
  const blockers = result.blockers ? ` ${JSON.stringify(result.blockers)}` : '';
  return {
    summary: `${tableId}: ${result.status}, renumbered ${renumbered}${blockers}`,
    status: result.status,
    allowed: APPLIED,
  };
}

async function randomPartialStructure(
  scenario: ChangesScenario,
  pick: Picker,
  operation: 'commit' | 'revert',
): Promise<StepOutcome> {
  const tableId = pick.one(await tablesWithPendingStructure(scenario));
  if (!tableId) {
    return { summary: 'skipped' };
  }
  return partialStructure(scenario, tableId, operation);
}

function done(summary: string): StepOutcome {
  return { summary };
}

const steps: Step[] = [
  {
    name: 'native: add a field',
    weight: 5,
    run: async (scenario, pick) => {
      const tableId = pick.one(await scenario.tableIds('draft'));
      if (!tableId) {
        return done('skipped');
      }
      await scenario.addField(tableId, pick.name('f'), str());
      return done(tableId);
    },
  },
  {
    name: 'native: create a table',
    weight: 1,
    run: async (scenario, pick) => {
      const tableId = pick.name('t');
      await scenario.createTable(tableId, obj({ label: str() }));
      await scenario.createRow(tableId, 'r1', { label: tableId });
      return done(tableId);
    },
  },
  {
    name: 'native: rename a table',
    weight: 2,
    run: async (scenario, pick) => {
      const tableId = pick.one(await scenario.tableIds('draft'));
      if (!tableId) {
        return done('skipped');
      }
      const nextTableId = pick.name('n');
      await scenario.renameTable(tableId, nextTableId);
      return done(`${tableId}->${nextTableId}`);
    },
  },
  {
    name: 'native: edit a row',
    weight: 2,
    run: async (scenario, pick) => {
      if (!(await scenario.tableIds('draft')).includes('products')) {
        return done('skipped');
      }
      await scenario.patchRow('products', 'p1', {
        price: Math.round(pick.next() * 100),
      });
      return done('products/p1');
    },
  },
  {
    name: 'partial commit of one table structure',
    weight: 6,
    run: (scenario, pick) => randomPartialStructure(scenario, pick, 'commit'),
  },
  {
    name: 'partial revert of one table structure',
    weight: 3,
    run: (scenario, pick) => randomPartialStructure(scenario, pick, 'revert'),
  },
  {
    name: 'partial commit of table data',
    weight: 1,
    run: async (scenario) => {
      const result = await scenario.commitWithRequired({
        tableData: ['products'],
      });
      return {
        summary: result.status,
        status: result.status,
        allowed: APPLIED_OR_EMPTY,
      };
    },
  },
  {
    name: 'native full commit',
    weight: 1,
    run: async (scenario) => {
      if (!(await scenario.draftHasChanges())) {
        return done('skipped');
      }
      await scenario.commitNatively();
      return done('committed');
    },
  },
  {
    name: 'all: true commit',
    weight: 1,
    run: async (scenario) => {
      const { status } = await scenario.commit({ all: true });
      return { summary: status, status, allowed: APPLIED_OR_EMPTY };
    },
  },
];

const SEEDS = [11, 23, 37, 41, 59, 73, 89, 97];
const STEPS_PER_SEQUENCE = 20;

describe('ledger stays replayable across operation sequences (property-style)', () => {
  let kit: PartialChangesTestKit;

  beforeAll(async () => {
    kit = await createPartialChangesTestKit();
  });

  guardCommittedVersions(() => kit.guard);

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

      const opening = await partialStructure(scenario, 'orders', 'commit');
      await expectStep(history, 'opening partial commit of orders', opening, {
        scenario,
        replica,
      });
      for (let index = 0; index < STEPS_PER_SEQUENCE; index++) {
        const step = pick.weighted(steps);
        if (step) {
          await expectStep(history, step.name, await step.run(scenario, pick), {
            scenario,
            replica,
          });
        }
      }

      await expectWithHistory(history, () =>
        expectLedgerReplaysTo(kit, scenario, 'draft'),
      );
      const final = await scenario.commit({ all: true });
      await expectWithHistory(history, async () => {
        expect(APPLIED_OR_EMPTY).toContain(final.status);
        expect((await scenario.preview('commit', { all: true })).status).toBe(
          'empty',
        );
        expect(await scenario.ledger('draft')).toEqual(
          await scenario.ledger('head'),
        );
        await expectReplicaMirrorsHead(replica, scenario);
      });
      process.stdout.write(
        `seed ${seed}:\n  ${history.join('\n  ')}\n  final all: true: ${final.status}\n`,
      );
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

async function expectStep(
  history: string[],
  name: string,
  outcome: StepOutcome,
  sides: { scenario: ChangesScenario; replica: Replica },
): Promise<void> {
  history.push(`${name}: ${outcome.summary}`);
  await expectWithHistory(history, async () => {
    if (outcome.allowed) {
      expect(outcome.allowed).toContain(outcome.status);
    }
    await expectPendingAfterPublished(sides.scenario);
    await expectReplicaMirrorsHead(sides.replica, sides.scenario);
  });
}

async function expectPendingAfterPublished(
  scenario: ChangesScenario,
): Promise<void> {
  const head = (await scenario.ledger('head')).map(({ id }) => id);
  const lastPublished = head.at(-1) ?? '';
  const pendingBeforeIt = (await scenario.ledger('draft'))
    .map(({ id }) => id)
    .filter((id) => !head.includes(id) && id <= lastPublished);
  expect(pendingBeforeIt).toEqual([]);
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
