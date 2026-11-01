import { num, obj, str } from '@revisium/schema-toolkit/mocks';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import { removeField } from 'src/features/share/ledger-replay/__tests__/support/ledger-steps';
import type { TableViewsData } from 'src/features/views/types';
import type { AddressedUnit } from '../../__tests__/support/catalogue-reading';
import { ChangesScenario } from '../../__tests__/support/changes-scenario';
import { expectEveryDifferenceOwnedOnce } from '../../__tests__/support/column-ownership';

const PRODUCTS = 'products';
const ADDRESS = 'address';
const PHONE = 'phone';
const CONTACT = 'contact';
const EMAIL = 'email';

const productSchema = obj({ code: str(), price: num() });
const addressSchema = obj({ city: str() });
const editedAddressSchema = obj({ city: str(), street: str() });
const phoneSchema = obj({ number: str() });
const emailSchema = obj({ address: str() });

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
    it.each<{
      change: string;
      edit: (draft: ChangesScenario) => Promise<void>;
      units: AddressedUnit[];
    }>([
      {
        change: 'a created shared schema',
        edit: (draft) => draft.createSharedSchema(EMAIL, emailSchema),
        units: [{ kind: 'sharedSchema', tableId: EMAIL }],
      },
      {
        change: 'an edited shared schema',
        edit: (draft) => draft.updateSharedSchema(ADDRESS, editedAddressSchema),
        units: [{ kind: 'sharedSchema', tableId: ADDRESS }],
      },
      {
        change: 'a removed shared schema',
        edit: (draft) => draft.removeSharedSchema(ADDRESS),
        units: [{ kind: 'sharedSchema', tableId: ADDRESS }],
      },
      {
        change: 'a shared schema removed and created again at its id',
        edit: async (draft) => {
          await draft.removeSharedSchema(ADDRESS);
          await draft.createSharedSchema(ADDRESS, editedAddressSchema);
        },
        units: [{ kind: 'sharedSchema', tableId: ADDRESS }],
      },
      {
        change: 'a shared schema renamed with the low-level row API',
        edit: (draft) => draft.renameSharedSchema(PHONE, CONTACT),
        units: [{ kind: 'sharedSchema', tableId: CONTACT }],
      },
      {
        change:
          'a shared schema renamed into the id of a removed one with the low-level row API',
        edit: async (draft) => {
          await draft.removeSharedSchema(ADDRESS);
          await draft.renameSharedSchema(PHONE, ADDRESS);
        },
        units: [{ kind: 'sharedSchema', tableId: ADDRESS }],
      },
    ])('lists one sharedSchema unit for $change', async ({ edit, units }) => {
      const draft = await givenCommittedSharedSchemas();
      await edit(draft);

      const catalogue = await draft.readCatalogue([]);

      expect(catalogue.units()).toEqual(units);
      expectEveryDifferenceOwnedOnce(catalogue);
    });

    it('covers the removed and the created version of a shared schema created again at its id', async () => {
      const draft = await givenCommittedSharedSchemas();
      await draft.removeSharedSchema(ADDRESS);
      await draft.createSharedSchema(ADDRESS, editedAddressSchema);

      const catalogue = await draft.readCatalogue([]);

      expect(
        catalogue.systemRowsOf({ kind: 'sharedSchema', tableId: ADDRESS }),
      ).toEqual(['sharedSchema address', 'sharedSchema address']);
    });

    it('covers every version that held the id a renamed shared schema took over from a removed one', async () => {
      const draft = await givenCommittedSharedSchemas();
      await draft.removeSharedSchema(ADDRESS);
      await draft.renameSharedSchema(PHONE, ADDRESS);

      const catalogue = await draft.readCatalogue([]);

      expect(
        catalogue.systemRowsOf({ kind: 'sharedSchema', tableId: ADDRESS }),
      ).toEqual([
        'sharedSchema address',
        'sharedSchema address',
        'sharedSchema phone',
      ]);
    });
  });

  async function givenCommittedSharedSchemas(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [PRODUCTS]: { schema: productSchema },
    });
    await draft.createSharedSchema(ADDRESS, addressSchema);
    await draft.createSharedSchema(PHONE, phoneSchema);
    await draft.commit();

    return draft;
  }

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
