import { num, obj, str } from '@revisium/schema-toolkit/mocks';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import { removeField } from 'src/features/share/ledger-replay/__tests__/support/ledger-steps';
import type { TableViewsData } from 'src/features/views/types';
import { ChangesScenario } from '../../__tests__/support/changes-scenario';
import { expectEveryDifferenceOwnedOnce } from '../../__tests__/support/column-ownership';

const PRODUCTS = 'products';
const ADDRESS = 'address';

const productSchema = obj({ code: str(), price: num() });

describe('ChangeCatalogue: views and shared schema units', () => {
  let kit: PartialChangesTestKit;

  beforeAll(async () => {
    kit = await createPartialChangesTestKit();
  });

  afterEach(async () => {
    await kit.guard.verifyAndForget();
  });

  afterAll(async () => {
    await kit.close();
  });

  describe('views', () => {
    it('lists an independent views edit as the views unit of its table', async () => {
      const draft = await givenCommittedProductsWithViews();
      await draft.updateViews(PRODUCTS, productViews('Renamed', ['code']));

      const catalogue = await draft.readCatalogue([PRODUCTS]);

      expect(catalogue.units()).toEqual([{ kind: 'views', tableId: PRODUCTS }]);
      expectEveryDifferenceOwnedOnce(catalogue);
    });

    it('lists no views unit when the views only follow a schema migration', async () => {
      const draft = await givenCommittedProductsWithViews();
      await draft.updateTable(PRODUCTS, [removeField('price')]);

      const catalogue = await draft.readCatalogue([PRODUCTS]);

      expect(catalogue.units()).toEqual([
        { kind: 'structure', tableId: PRODUCTS },
      ]);
      expectEveryDifferenceOwnedOnce(catalogue);
    });

    it('lists a views edit made after a schema migration next to the structure unit', async () => {
      const draft = await givenCommittedProductsWithViews();
      await draft.updateTable(PRODUCTS, [removeField('price')]);
      await draft.updateViews(PRODUCTS, productViews('Renamed', ['code']));

      const catalogue = await draft.readCatalogue([PRODUCTS]);

      expect(catalogue.units()).toEqual([
        { kind: 'structure', tableId: PRODUCTS },
        { kind: 'views', tableId: PRODUCTS },
      ]);
      expectEveryDifferenceOwnedOnce(catalogue);
    });
  });

  describe('shared schemas', () => {
    it('lists a shared schema created in the Draft as its sharedSchema unit', async () => {
      const draft = await ChangesScenario.committed(kit, {
        [PRODUCTS]: { schema: productSchema },
      });
      await draft.createSharedSchema(ADDRESS, obj({ city: str() }));

      const catalogue = await draft.readCatalogue([]);

      expect(catalogue.units()).toEqual([
        { kind: 'sharedSchema', tableId: ADDRESS },
      ]);
      expectEveryDifferenceOwnedOnce(catalogue);
    });
  });

  async function givenCommittedProductsWithViews(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [PRODUCTS]: {
        schema: productSchema,
        rows: { p1: { code: 'one', price: 1 } },
      },
    });
    await draft.updateViews(PRODUCTS, productViews('All', ['code', 'price']));
    await draft.commit();

    return draft;
  }
});

function productViews(name: string, fields: string[]): TableViewsData {
  return {
    version: 1,
    defaultViewId: 'default',
    views: [
      {
        id: 'default',
        name,
        columns: fields.map((field) => ({ field: `data.${field}` })),
      },
    ],
  };
}
