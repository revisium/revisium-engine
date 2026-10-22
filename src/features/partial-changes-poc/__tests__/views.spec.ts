import { str } from '@revisium/schema-toolkit/mocks';
import type { TableViewsData } from 'src/features/views/types';
import { ChangesScenario } from 'src/features/partial-changes-poc/__tests__/support/changes-scenario';
import {
  createPartialChangesTestKit,
  PartialChangesTestKit,
} from 'src/features/partial-changes-poc/__tests__/support/partial-changes-test-kit';
import {
  product,
  productSchema,
} from 'src/features/partial-changes-poc/__tests__/support/schemas';

function viewsWith(
  name: string,
  fields: string[],
  sortBy?: string,
): TableViewsData {
  return {
    version: 1,
    defaultViewId: 'default',
    views: [
      {
        id: 'default',
        name,
        columns: fields.map((field) => ({ field: `data.${field}` })),
        ...(sortBy
          ? { sorts: [{ field: `data.${sortBy}`, direction: 'asc' as const }] }
          : {}),
      },
    ],
  };
}

describe('views documents', () => {
  let kit: PartialChangesTestKit;

  beforeAll(async () => {
    kit = await createPartialChangesTestKit();
  });

  afterAll(async () => {
    await kit.close();
  });

  async function givenProductsWithViews() {
    return ChangesScenario.committed(
      kit,
      {
        products: { schema: productSchema, rows: { p1: product('one', 10) } },
      },
      (scenario) =>
        scenario.updateViews('products', viewsWith('All', ['title', 'price'])),
    );
  }

  describe('independent views edit', () => {
    async function givenViewsAndDataEdited() {
      const scenario = await givenProductsWithViews();
      await scenario.updateViews(
        'products',
        viewsWith('All', ['title', 'price'], 'title'),
      );
      await scenario.patchRow('products', 'p1', { price: 11 });
      return scenario;
    }

    it('commits the views edit alone', async () => {
      const scenario = await givenViewsAndDataEdited();

      const result = await scenario.commit({ views: ['products'] });

      expect(result.status).toBe('applied');
      expect(await scenario.views('head', 'products')).toEqual(
        viewsWith('All', ['title', 'price'], 'title'),
      );
      expect((await scenario.headRow('products', 'p1')).data.price).toBe(10);
    });

    it('reverts the views edit alone', async () => {
      const scenario = await givenViewsAndDataEdited();

      const result = await scenario.revert({ views: ['products'] });

      expect(result.status).toBe('applied');
      expect(await scenario.views('draft', 'products')).toEqual(
        viewsWith('All', ['title', 'price']),
      );
      expect((await scenario.draftRow('products', 'p1')).data.price).toBe(11);
    });
  });

  describe('views using a new field', () => {
    async function givenColumnForNewField() {
      const scenario = await givenProductsWithViews();
      await scenario.addField('products', 'color', str());
      await scenario.updateViews(
        'products',
        viewsWith('All', ['title', 'price', 'color']),
      );
      return scenario;
    }

    it('requires the structure for committed views', async () => {
      const scenario = await givenColumnForNewField();

      const preview = await scenario.preview('commit', {
        views: ['products'],
      });

      expect(preview.required).toEqual([
        {
          unit: { kind: 'structure', tableId: 'products' },
          reason: expect.objectContaining({ code: 'viewsDoNotFitStructure' }),
        },
      ]);
    });

    it('requires the views when the structure is reverted', async () => {
      const scenario = await givenColumnForNewField();

      const preview = await scenario.preview('revert', {
        tables: ['products'],
      });

      expect(preview.required).toEqual([
        {
          unit: { kind: 'views', tableId: 'products' },
          reason: expect.objectContaining({ code: 'viewsDoNotFitStructure' }),
        },
      ]);
    });
  });

  describe('Head views under a committed structure', () => {
    async function givenPriceRemovedAndViewRenamed() {
      const scenario = await givenProductsWithViews();
      await scenario.removeField('products', 'price');
      await scenario.updateViews('products', viewsWith('Renamed', ['title']));
      return scenario;
    }

    it('migrates the Head views with the structure and keeps the views edit in the Draft', async () => {
      const scenario = await givenPriceRemovedAndViewRenamed();

      const result = await scenario.commit({ tables: ['products'] });

      expect(result).toMatchObject({
        status: 'applied',
        remaining: { units: 1 },
      });
      expect(await scenario.views('head', 'products')).toEqual(
        viewsWith('All', ['title']),
      );
      expect(await scenario.views('draft', 'products')).toEqual(
        viewsWith('Renamed', ['title']),
      );
    });

    it('treats the automatic views migration as part of the structure', async () => {
      const scenario = await givenProductsWithViews();
      await scenario.removeField('products', 'price');

      const preview = await scenario.preview('commit', { all: true });

      expect(preview.counts).toEqual({
        selected: 1,
        required: 0,
        remaining: 0,
      });
    });
  });
});
