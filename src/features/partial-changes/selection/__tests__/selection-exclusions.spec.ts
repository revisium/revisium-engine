import { arr, num, obj, str } from '@revisium/schema-toolkit/mocks';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import type { AddressedUnit } from '../../__tests__/support/catalogue-reading';
import { ChangesScenario } from '../../__tests__/support/changes-scenario';

const PRODUCTS = 'products';

const productSchema = obj({ code: str(), price: num(), labels: arr(str()) });

const createdP3: AddressedUnit = {
  kind: 'rowCreate',
  tableId: PRODUCTS,
  rowId: 'p3',
};

describe('SelectionResolver: exclusions and unmatched selectors', () => {
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

  describe('exclusions', () => {
    it('removes the units an exclusion selects from the selection', async () => {
      const draft = await givenCommittedProducts();
      await draft.updateRow(PRODUCTS, 'p1', product('edited'));
      await draft.updateRow(PRODUCTS, 'p2', product('edited'));

      const resolution = await draft.resolveSelection({
        tableData: [PRODUCTS],
        exclude: { rows: [{ tableId: PRODUCTS, rowId: 'p1' }] },
      });

      expect(resolution.selected).toEqual([fieldOf('p2', '/code')]);
      expect(resolution.excluded).toEqual([fieldOf('p1', '/code')]);
    });

    it('excludes the array unit for an excluded pointer inside the array', async () => {
      const draft = await givenCommittedProducts();
      await draft.updateRow(PRODUCTS, 'p1', product('edited', ['sale', 'new']));

      const resolution = await draft.resolveSelection({
        rows: [{ tableId: PRODUCTS, rowId: 'p1' }],
        exclude: {
          fields: [{ tableId: PRODUCTS, rowId: 'p1', path: '/labels/1' }],
        },
      });

      expect(resolution.selected).toEqual([fieldOf('p1', '/code')]);
      expect(resolution.excluded).toEqual([fieldOf('p1', '/labels')]);
    });

    it('excludes the creation for an excluded field of a created row', async () => {
      const draft = await givenCommittedProducts();
      await draft.createRows(PRODUCTS, { p3: product('three') });

      const resolution = await draft.resolveSelection({
        rows: [{ tableId: PRODUCTS, rowId: 'p3' }],
        exclude: {
          fields: [{ tableId: PRODUCTS, rowId: 'p3', path: '/code' }],
        },
      });

      expect(resolution.selected).toEqual([]);
      expect(resolution.excluded).toEqual([createdP3]);
      expect(resolution.blockers).toEqual([]);
    });

    it('blocks a required unit that is excluded with requiredExcluded', async () => {
      const draft = await givenCommittedProducts();
      await draft.createRows(PRODUCTS, { p3: product('three') });

      const resolution = await draft.resolveSelection({
        fields: [{ tableId: PRODUCTS, rowId: 'p3', path: '/code' }],
        exclude: { rows: [{ tableId: PRODUCTS, rowId: 'p3' }] },
      });

      expect(resolution).toEqual({
        selected: [],
        excluded: [createdP3],
        required: [],
        blockers: [
          {
            code: 'requiredExcluded',
            tableId: PRODUCTS,
            rowId: 'p3',
            message: 'products/p3 is required but excluded',
            unit: createdP3,
            reason: {
              code: 'wholeRowUnit',
              tableId: PRODUCTS,
              rowId: 'p3',
              path: '/code',
              because:
                'products/p3 is created, deleted or replaced as a whole row',
            },
          },
        ],
        unmatched: {},
      });
    });
  });

  describe('unmatched selectors', () => {
    it('returns the selectors that match no unit and blocks a selection that matched in part', async () => {
      const draft = await givenCommittedProducts();
      await draft.updateRow(PRODUCTS, 'p1', product('edited'));

      const resolution = await draft.resolveSelection({
        rows: [
          { tableId: PRODUCTS, rowId: 'p1' },
          { tableId: PRODUCTS, rowId: 'p404' },
        ],
        exclude: { rows: [{ tableId: PRODUCTS, rowId: 'p405' }] },
      });

      expect(resolution.selected).toEqual([fieldOf('p1', '/code')]);
      expect(resolution.unmatched).toEqual({
        rows: [{ tableId: PRODUCTS, rowId: 'p404' }],
        exclude: { rows: [{ tableId: PRODUCTS, rowId: 'p405' }] },
      });
      expect(resolution.blockers).toEqual([
        {
          code: 'unmatchedSelector',
          message: 'Some selectors match no unit; see unmatched',
        },
      ]);
    });

    it('returns every selector and no blocker when nothing matched', async () => {
      const draft = await givenCommittedProducts();
      await draft.updateRow(PRODUCTS, 'p1', product('edited'));

      const resolution = await draft.resolveSelection({
        tables: ['missing'],
        rows: [{ tableId: PRODUCTS, rowId: 'p404' }],
        exclude: {
          fields: [{ tableId: PRODUCTS, rowId: 'p1', path: '/price' }],
        },
      });

      expect(resolution).toEqual({
        selected: [],
        excluded: [],
        required: [],
        blockers: [],
        unmatched: {
          tables: ['missing'],
          rows: [{ tableId: PRODUCTS, rowId: 'p404' }],
          exclude: {
            fields: [{ tableId: PRODUCTS, rowId: 'p1', path: '/price' }],
          },
        },
      });
    });
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

function product(code: string, labels: string[] = ['sale']) {
  return { code, price: 1, labels };
}

function fieldOf(rowId: string, path: string): AddressedUnit {
  return { kind: 'field', tableId: PRODUCTS, rowId, path };
}
