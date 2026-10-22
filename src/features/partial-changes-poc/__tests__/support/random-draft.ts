import { SystemSchemaIds } from '@revisium/schema-toolkit/consts';
import { num, obj, ref, str } from '@revisium/schema-toolkit/mocks';
import type { InputJsonValue } from 'src/engine-prisma-types';
import { ChangesScenario } from 'src/features/partial-changes-poc/__tests__/support/changes-scenario';
import type { PartialChangesTestKit } from 'src/features/partial-changes-poc/__tests__/support/partial-changes-test-kit';
import { Picker } from 'src/features/partial-changes-poc/__tests__/support/picker';
import {
  documentSchema,
  emptyFile,
  orderSchema,
} from 'src/features/partial-changes-poc/__tests__/support/schemas';

type DraftEdit = {
  name: string;
  weight: number;
  run: (scenario: ChangesScenario, pick: Picker) => Promise<void>;
};

const EDITS_PER_DRAFT = 16;
const PRICE_RANGE = 100;
const PUBLISHED_DATES = [
  '2020-01-01T00:00:00.000Z',
  '2021-06-15T12:00:00.000Z',
  '2022-12-31T23:59:59.000Z',
];

const articleSchema = obj({
  title: str(),
  price: num(),
  published: ref(SystemSchemaIds.RowPublishedAt),
});

function article(title: string, price: number) {
  return { title, price, published: '' };
}

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

async function pickUnreferencedArticle(
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

async function newArticle(
  scenario: ChangesScenario,
  title: string,
): Promise<InputJsonValue> {
  const schema = (await scenario.schemas('draft')).products as unknown as {
    properties: Record<string, { type?: string; $ref?: string }>;
  };
  return Object.fromEntries(
    Object.entries(schema.properties).map(([field, node]) => [
      field,
      field === 'title' ? title : defaultOf(node),
    ]),
  );
}

function defaultOf(node: { type?: string; $ref?: string }): InputJsonValue {
  if (node.$ref) {
    return '';
  }
  return node.type === 'number' ? 1 : '';
}

const edits: DraftEdit[] = [
  {
    name: 'edit a price',
    weight: 3,
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
    name: 'edit a publishedAt',
    weight: 4,
    run: async (scenario, pick) => {
      const rowId = await pickRow(scenario, pick, 'products');
      if (rowId) {
        await scenario.patchRow('products', rowId, {
          published: pick.one(PUBLISHED_DATES) ?? '',
        });
      }
    },
  },
  {
    name: 'create a product',
    weight: 1,
    run: async (scenario, pick) =>
      scenario.createRow(
        'products',
        pick.name('n'),
        await newArticle(scenario, 'new'),
      ),
  },
  {
    name: 'remove a product',
    weight: 1,
    run: async (scenario, pick) => {
      const rowId = await pickUnreferencedArticle(scenario, pick);
      if (rowId) {
        await scenario.removeRow('products', rowId);
      }
    },
  },
  {
    name: 'rename a product',
    weight: 1,
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
      const rowId = await pickUnreferencedArticle(scenario, pick);
      if (rowId) {
        await scenario.removeRow('products', rowId);
        await scenario.createRow(
          'products',
          rowId,
          await newArticle(scenario, 'again'),
        );
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
    name: 'upload a file',
    weight: 2,
    run: async (scenario, pick) => {
      const rowId = await pickRow(scenario, pick, 'documents');
      if (rowId) {
        await scenario.uploadFile('documents', rowId, 'photo');
      }
    },
  },
  {
    name: 'create a document',
    weight: 1,
    run: (scenario, pick) =>
      scenario.createRow('documents', pick.name('d'), {
        title: 'new',
        photo: emptyFile,
      }),
  },
  {
    name: 'add a field',
    weight: 1,
    run: async (scenario, pick) => {
      const tableId = pick.one(
        (await scenario.tableIds('draft')).filter(
          (id) => !['documents', 'articles'].includes(id),
        ),
      );
      if (tableId) {
        await scenario.addField(tableId, pick.name('f'), str());
      }
    },
  },
  {
    name: 'edit the publishedAt of an article',
    weight: 3,
    run: async (scenario, pick) => {
      const rowId = await pickRow(scenario, pick, 'articles');
      if (rowId) {
        await scenario.patchRow('articles', rowId, {
          published: pick.one(PUBLISHED_DATES) ?? '',
        });
      }
    },
  },
  {
    name: 'edit the title of an article',
    weight: 1,
    run: async (scenario, pick) => {
      const rowId = await pickRow(scenario, pick, 'articles');
      if (rowId) {
        await scenario.patchRow('articles', rowId, { title: pick.name('t') });
      }
    },
  },
  {
    name: 'remove the publishedAt field of articles',
    weight: 1,
    run: (scenario) => scenario.removeField('articles', 'published'),
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
];

export async function givenRandomDraft(
  kit: PartialChangesTestKit,
  seed: number,
): Promise<ChangesScenario> {
  const pick = new Picker(seed);
  const scenario = await ChangesScenario.committed(kit, {
    products: {
      schema: articleSchema,
      rows: Object.fromEntries(
        ['one', 'two', 'three', 'four', 'five'].map((title, index) => [
          `p${index + 1}`,
          article(title, index + 1),
        ]),
      ),
    },
    orders: {
      schema: orderSchema,
      rows: { o1: { product: 'p1', note: '' } },
    },
    articles: {
      schema: obj({
        title: str(),
        published: ref(SystemSchemaIds.RowPublishedAt),
      }),
      rows: {
        a1: { title: 'a1', published: '' },
        a2: { title: 'a2', published: '' },
        a3: { title: 'a3', published: '' },
      },
    },
    documents: {
      schema: documentSchema,
      rows: {
        d1: { title: 'one', photo: emptyFile },
        d2: { title: 'two', photo: emptyFile },
      },
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
