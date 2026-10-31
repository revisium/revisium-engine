import { num, obj, str } from '@revisium/schema-toolkit/mocks';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import type { AddressedUnit } from '../../__tests__/support/catalogue-reading';
import { ChangesScenario } from '../../__tests__/support/changes-scenario';
import { expectEveryDifferenceOwnedOnce } from '../../__tests__/support/column-ownership';

const PRODUCTS = 'products';

const productSchema = obj({ code: str(), price: num() });

describe('ChangeCatalogue: row existence and identity units', () => {
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

  it.each<{
    change: string;
    edit: (draft: ChangesScenario) => Promise<void>;
    units: AddressedUnit[];
  }>([
    {
      change: 'a created row',
      edit: (draft) => draft.createRows(PRODUCTS, { p3: product('three') }),
      units: [{ kind: 'rowCreate', tableId: PRODUCTS, rowId: 'p3' }],
    },
    {
      change: 'a deleted row',
      edit: (draft) => draft.removeRow(PRODUCTS, 'p2'),
      units: [{ kind: 'rowDelete', tableId: PRODUCTS, rowId: 'p2' }],
    },
    {
      change: 'a deleted row whose id was created again',
      edit: async (draft) => {
        await draft.removeRow(PRODUCTS, 'p2');
        await draft.createRows(PRODUCTS, { p2: product('reused') });
      },
      units: [{ kind: 'rowReplace', tableId: PRODUCTS, rowId: 'p2' }],
    },
    {
      change: 'a renamed row',
      edit: (draft) => draft.renameRow(PRODUCTS, 'p1', 'p9'),
      units: [
        {
          kind: 'rowRename',
          tableId: PRODUCTS,
          rowId: 'p9',
          previousRowId: 'p1',
        },
      ],
    },
    {
      change: 'a swap of two ids',
      edit: async (draft) => {
        await draft.renameRow(PRODUCTS, 'p1', 'swapping');
        await draft.renameRow(PRODUCTS, 'p2', 'p1');
        await draft.renameRow(PRODUCTS, 'swapping', 'p2');
      },
      units: [
        {
          kind: 'rowRename',
          tableId: PRODUCTS,
          rowId: 'p1',
          previousRowId: 'p2',
        },
        {
          kind: 'rowRename',
          tableId: PRODUCTS,
          rowId: 'p2',
          previousRowId: 'p1',
        },
      ],
    },
    {
      change: 'a rename into the id of a deleted row',
      edit: async (draft) => {
        await draft.removeRow(PRODUCTS, 'p1');
        await draft.renameRow(PRODUCTS, 'p2', 'p1');
      },
      units: [
        { kind: 'rowDelete', tableId: PRODUCTS, rowId: 'p1', side: 'head' },
        {
          kind: 'rowRename',
          tableId: PRODUCTS,
          rowId: 'p1',
          previousRowId: 'p2',
        },
      ],
    },
  ])('lists the units of $change', async ({ edit, units }) => {
    const draft = await givenCommittedProducts();
    await edit(draft);

    const catalogue = await draft.readCatalogue([PRODUCTS]);

    expect(catalogue.unitsOf(PRODUCTS)).toEqual(units);
    expectEveryDifferenceOwnedOnce(catalogue);
  });

  it('lists the units of a Draft in code-point order of row ids, then kind and path', async () => {
    const draft = await ChangesScenario.committed(kit, {
      [PRODUCTS]: {
        schema: productSchema,
        rows: { b: product('b'), C: product('c') },
      },
    });
    await draft.updateRow(PRODUCTS, 'b', { code: 'edited', price: 2 });
    await draft.writeRowColumns(PRODUCTS, 'b', { meta: { note: 'checked' } });
    await draft.removeRow(PRODUCTS, 'C');
    await draft.createRows(PRODUCTS, {
      a: product('a'),
      _d: product('d'),
      D: product('d'),
    });

    const catalogue = await draft.readCatalogue([PRODUCTS]);

    expect(catalogue.unitsOf(PRODUCTS)).toEqual([
      { kind: 'rowDelete', tableId: PRODUCTS, rowId: 'C' },
      { kind: 'rowCreate', tableId: PRODUCTS, rowId: 'D' },
      { kind: 'rowCreate', tableId: PRODUCTS, rowId: '_d' },
      { kind: 'rowCreate', tableId: PRODUCTS, rowId: 'a' },
      { kind: 'field', tableId: PRODUCTS, rowId: 'b', path: '/code' },
      { kind: 'field', tableId: PRODUCTS, rowId: 'b', path: '/price' },
      { kind: 'rowColumns', tableId: PRODUCTS, rowId: 'b', columns: ['meta'] },
    ]);
    expectEveryDifferenceOwnedOnce(catalogue);
  });

  function givenCommittedProducts(): Promise<ChangesScenario> {
    return ChangesScenario.committed(kit, {
      [PRODUCTS]: {
        schema: productSchema,
        rows: { p1: product('one'), p2: product('two') },
      },
    });
  }
});

function product(code: string, price = 1) {
  return { code, price };
}
