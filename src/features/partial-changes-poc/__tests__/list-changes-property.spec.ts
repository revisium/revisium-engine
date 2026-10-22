import { obj, str } from '@revisium/schema-toolkit/mocks';
import { ChangesScenario } from 'src/features/partial-changes-poc/__tests__/support/changes-scenario';
import { guardCommittedVersions } from 'src/features/partial-changes-poc/__tests__/support/committed-versions-guard';
import {
  expectSelectsExactly,
  unionOfSelectors,
} from 'src/features/partial-changes-poc/__tests__/support/listed-units';
import {
  createPartialChangesTestKit,
  PartialChangesTestKit,
} from 'src/features/partial-changes-poc/__tests__/support/partial-changes-test-kit';
import { Picker } from 'src/features/partial-changes-poc/__tests__/support/picker';
import type { ListedUnit } from 'src/features/partial-changes-poc/partial-changes.types';
import {
  orderSchema,
  product,
  productSchema,
} from 'src/features/partial-changes-poc/__tests__/support/schemas';

type DraftEdit = {
  name: string;
  weight: number;
  run: (scenario: ChangesScenario, pick: Picker) => Promise<void>;
};

const PRICE_RANGE = 100;
const SEEDS = [3, 7, 13, 21, 34, 55];
const EDITS_PER_DRAFT = 14;
const PAGE_SIZE = 4;

async function pickRow(
  scenario: ChangesScenario,
  pick: Picker,
  tableId: string,
): Promise<string | undefined> {
  const tables = await scenario.tableIds('draft');
  return tables.includes(tableId)
    ? pick.one(await scenario.draftRowIds(tableId))
    : undefined;
}

async function pickUnreferencedProduct(
  scenario: ChangesScenario,
  pick: Picker,
): Promise<string | undefined> {
  const tables = await scenario.tableIds('draft');
  if (!tables.includes('products')) {
    return undefined;
  }
  const referenced = new Set<unknown>();
  if (tables.includes('orders')) {
    for (const rowId of await scenario.draftRowIds('orders')) {
      referenced.add((await scenario.draftRow('orders', rowId)).data.product);
    }
  }
  return pick.one(
    (await scenario.draftRowIds('products')).filter(
      (rowId) => !referenced.has(rowId),
    ),
  );
}

async function newProduct(scenario: ChangesScenario, title: string) {
  const schema = (await scenario.schemas('draft')).products as unknown as {
    properties: Record<string, unknown>;
  };
  const addedFields = Object.keys(schema.properties).filter(
    (field) => !['title', 'price', 'qty'].includes(field),
  );
  return {
    ...product(title, 1),
    ...Object.fromEntries(addedFields.map((field) => [field, ''])),
  };
}

const edits: DraftEdit[] = [
  {
    name: 'edit a price',
    weight: 4,
    run: async (scenario, pick) => {
      const rowId = await pickRow(scenario, pick, 'products');
      if (rowId) {
        await scenario.patchRow('products', rowId, {
          price: Math.round(pick.next() * PRICE_RANGE),
        });
      }
    },
  },
  {
    name: 'create a product',
    weight: 2,
    run: async (scenario, pick) =>
      scenario.createRow(
        'products',
        pick.name('n'),
        await newProduct(scenario, 'new'),
      ),
  },
  {
    name: 'remove a product',
    weight: 2,
    run: async (scenario, pick) => {
      const rowId = await pickUnreferencedProduct(scenario, pick);
      if (rowId) {
        await scenario.removeRow('products', rowId);
      }
    },
  },
  {
    name: 'rename a product',
    weight: 2,
    run: async (scenario, pick) => {
      const rowId = await pickRow(scenario, pick, 'products');
      if (rowId) {
        await scenario.renameRow('products', rowId, pick.name('r'));
      }
    },
  },
  {
    name: 'replace a product under the same id',
    weight: 1,
    run: async (scenario, pick) => {
      const rowId = await pickUnreferencedProduct(scenario, pick);
      if (rowId) {
        await scenario.removeRow('products', rowId);
        await scenario.createRow(
          'products',
          rowId,
          await newProduct(scenario, 'again'),
        );
      }
    },
  },
  {
    name: 'edit an order note',
    weight: 2,
    run: async (scenario, pick) => {
      const rowId = await pickRow(scenario, pick, 'orders');
      if (rowId) {
        await scenario.patchRow('orders', rowId, { note: pick.name('note') });
      }
    },
  },
  {
    name: 'point an order to another product',
    weight: 2,
    run: async (scenario, pick) => {
      const rowId = await pickRow(scenario, pick, 'orders');
      const productId = await pickRow(scenario, pick, 'products');
      if (rowId && productId) {
        await scenario.patchRow('orders', rowId, { product: productId });
      }
    },
  },
  {
    name: 'add a field',
    weight: 2,
    run: async (scenario, pick) => {
      const tableId = pick.one(await scenario.tableIds('draft'));
      if (tableId) {
        await scenario.addField(tableId, pick.name('f'), str());
      }
    },
  },
  {
    name: 'rename the tags table',
    weight: 1,
    run: async (scenario, pick) => {
      const tableId = (await scenario.tableIds('draft')).find((id) =>
        id.startsWith('tag'),
      );
      if (tableId) {
        await scenario.renameTable(tableId, pick.name('tags'));
      }
    },
  },
  {
    name: 'create a table with a row',
    weight: 1,
    run: async (scenario, pick) => {
      const tableId = pick.name('t');
      await scenario.createTable(tableId, obj({ label: str() }));
      await scenario.createRow(tableId, 'r1', { label: tableId });
    },
  },
  {
    name: 'remove a table',
    weight: 1,
    run: async (scenario, pick) => {
      const tableId = pick.one(
        (await scenario.tableIds('draft')).filter((id) => id !== 'products'),
      );
      if (tableId) {
        await scenario.removeTable(tableId);
      }
    },
  },
  {
    name: 'edit the products views',
    weight: 1,
    run: async (scenario, pick) => {
      if ((await scenario.tableIds('draft')).includes('products')) {
        await scenario.updateViews('products', {
          version: 1,
          defaultViewId: 'default',
          views: [
            {
              id: 'default',
              name: pick.name('view'),
              columns: [{ field: 'data.title' }],
            },
          ],
        });
      }
    },
  },
];

describe('listChanges property: listed selectors round-trip (decision 7)', () => {
  let kit: PartialChangesTestKit;

  beforeAll(async () => {
    kit = await createPartialChangesTestKit();
  });

  guardCommittedVersions(() => kit.guard);

  afterAll(async () => {
    await kit.close();
  });

  async function givenRandomDraft(seed: number) {
    const pick = new Picker(seed);
    const scenario = await ChangesScenario.committed(kit, {
      products: {
        schema: productSchema,
        rows: { p1: product('one', 1), p2: product('two', 2) },
      },
      orders: {
        schema: orderSchema,
        rows: { o1: { product: 'p1', note: '' } },
      },
      tags: { schema: obj({ label: str() }), rows: { t1: { label: 't' } } },
    });
    const history: string[] = [];
    for (let index = 0; index < EDITS_PER_DRAFT; index++) {
      const edit = pick.weighted(edits);
      if (edit) {
        history.push(`${edit.name}: ${await outcomeOf(edit, scenario, pick)}`);
      }
    }
    process.stdout.write(`seed ${seed}:\n  ${history.join('\n  ')}\n`);
    return scenario;
  }

  it.each(SEEDS)(
    'selects each listed unit alone without unmatched or notSelectable for seed %i',
    async (seed) => {
      const scenario = await givenRandomDraft(seed);

      const units = await scenario.listAllChanges(PAGE_SIZE);

      process.stdout.write(`seed ${seed} listed: ${kindsOf(units)}\n`);
      expect(units.length).toBeGreaterThan(0);
      for (const unit of units) {
        await expectSelectsExactly(scenario, unit);
      }
    },
  );

  it.each(SEEDS)(
    'selects with the union of the listed selectors what all: true selects for seed %i',
    async (seed) => {
      const scenario = await givenRandomDraft(seed);
      const union = unionOfSelectors(await scenario.listAllChanges(PAGE_SIZE));

      for (const operation of ['commit', 'revert'] as const) {
        const all = await scenario.preview(operation, { all: true });
        const listed = await scenario.preview(operation, union);
        expect(summaryOf(listed)).toEqual(summaryOf(all));
      }
    },
  );
});

async function outcomeOf(
  edit: DraftEdit,
  scenario: ChangesScenario,
  pick: Picker,
): Promise<string> {
  try {
    await edit.run(scenario, pick);
    return 'done';
  } catch (error) {
    return `refused natively (${(error as Error).message})`;
  }
}

function summaryOf(preview: {
  status: string;
  fingerprint: string;
  counts: unknown;
}) {
  return {
    status: preview.status,
    fingerprint: preview.fingerprint,
    counts: preview.counts,
  };
}

function kindsOf(units: readonly ListedUnit[]): string {
  const counts = new Map<string, number>();
  for (const unit of units) {
    const kind = unit.side ? `${unit.kind}(side head)` : unit.kind;
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return [...counts]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([kind, count]) => `${kind} ${count}`)
    .join(', ');
}
