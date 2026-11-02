import { num, numFormula, obj, str } from '@revisium/schema-toolkit/mocks';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import type { ChangeOperation } from 'src/features/partial-changes/plan/change-operation';
import type { PreviewChangesResult } from 'src/features/partial-changes/queries/impl/preview-draft-changes.query';
import type { FieldRef } from 'src/features/partial-changes/selection/selection';
import { ChangesScenario } from '../../__tests__/support/changes-scenario';

const MAX_CHANGED_ROWS = 3;
const MAX_PER_ROW_WORK = 1;
const LIMITED_WORK = {
  PARTIAL_CHANGES_MAX_CHANGED_ROWS: String(MAX_CHANGED_ROWS),
  PARTIAL_CHANGES_MAX_PER_ROW_WORK: String(MAX_PER_ROW_WORK),
};

const PRODUCTS = 'products';
const ORDERS = 'orders';
const OPERATIONS: ChangeOperation[] = ['commit', 'revert'];
const PRODUCT_IDS = ['p1', 'p2', 'p3', 'p4'];
const ORDER_IDS = ['o1', 'o2'];

const productSchema = obj({ title: str() });
const orderSchema = obj({
  price: num(),
  quantity: num(),
  total: numFormula('price * quantity'),
});

const titleOfP1: FieldRef = { tableId: PRODUCTS, rowId: 'p1', path: '/title' };
const priceOf = (rowId: string): FieldRef => ({
  tableId: ORDERS,
  rowId,
  path: '/price',
});

describe('previewChanges refused by a limit', () => {
  let kit: PartialChangesTestKit;

  beforeAll(async () => {
    kit = await createPartialChangesTestKit({ settings: LIMITED_WORK });
  });

  afterEach(async () => {
    await kit.guard.verifyAndForget();
  });

  afterAll(async () => {
    await kit.close();
  });

  it.each(OPERATIONS)(
    'blocks a %s with tooLarge and an empty fingerprint before the catalogue when the affected tables hold more changed rows than the limit',
    async (operation) => {
      const draft = await givenEditedProducts();

      const preview = await draft.previewChanges({
        operation,
        selection: { fields: [titleOfP1] },
      });

      expect(preview).toEqual<PreviewChangesResult>({
        status: 'blocked',
        headRevisionId: await draft.revisionId('head'),
        draftRevisionId: await draft.revisionId('draft'),
        fingerprint: '',
        counts: { selected: 0, required: 0, remaining: 0 },
        unreadTables: 0,
        refusedTables: [],
        required: [],
        blockers: [
          {
            code: 'tooLarge',
            message:
              'The affected tables hold 4 changed rows; the limit for one operation is 3',
          },
        ],
        deferred: [],
        sample: [],
        unmatched: {},
        estimate: {
          changedRows: 4,
          mergedRows: 0,
          perRowWorkRows: 0,
          mixedTables: [],
        },
      });
    },
  );

  it.each(OPERATIONS)(
    'blocks a %s with tooLarge and an empty fingerprint when its merges need more per-row work than the limit',
    async (operation) => {
      const draft = await givenTwoEditedOrders();

      const preview = await draft.previewChanges({
        operation,
        selection: { fields: [priceOf('o1'), priceOf('o2')] },
      });

      expect(preview).toMatchObject({
        status: 'blocked',
        fingerprint: '',
        counts: { selected: 2, required: 0, remaining: 2 },
        blockers: [
          {
            code: 'tooLarge',
            message:
              'The operation merges 2 rows that need per-row work (formula fields or file registration); the limit for one operation is 1',
          },
        ],
        deferred: [],
        estimate: { changedRows: 2, mergedRows: 2, perRowWorkRows: 2 },
      });
    },
  );

  async function givenEditedProducts(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [PRODUCTS]: {
        schema: productSchema,
        rows: rowsOf(PRODUCT_IDS, () => ({ title: 'one' })),
      },
    });

    for (const rowId of PRODUCT_IDS) {
      await draft.updateRow(PRODUCTS, rowId, { title: `edited ${rowId}` });
    }

    return draft;
  }

  async function givenTwoEditedOrders(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [ORDERS]: {
        schema: orderSchema,
        rows: rowsOf(ORDER_IDS, () => ({ price: 2, quantity: 3, total: 0 })),
      },
    });

    for (const rowId of ORDER_IDS) {
      await draft.updateRow(ORDERS, rowId, { price: 5, quantity: 7, total: 0 });
    }

    return draft;
  }
});

function rowsOf<T>(
  rowIds: readonly string[],
  dataOf: () => T,
): Record<string, T> {
  return Object.fromEntries(rowIds.map((rowId) => [rowId, dataOf()]));
}
