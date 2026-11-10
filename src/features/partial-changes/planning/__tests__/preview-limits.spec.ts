import { num, numFormula, obj, str } from '@revisium/schema-toolkit/mocks';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import type { ChangeOperation } from 'src/features/partial-changes/plan/change-operation';
import { encodeFingerprint } from 'src/features/partial-changes/plan/fingerprint';
import type { CommitChangesResult } from 'src/features/partial-changes/commands/impl/commit-draft-changes.command';
import type { RevertChangesResult } from 'src/features/partial-changes/commands/impl/revert-draft-changes.command';
import type { PreviewChangesResult } from 'src/features/partial-changes/queries/impl/preview-draft-changes.query';
import type { FieldRef } from 'src/features/partial-changes/selection/selection';
import { ChangesScenario } from '../../__tests__/support/changes-scenario';

const MAX_CHANGED_ROWS = 3;
const MAX_PER_ROW_WORK = 1;
const MAX_MIXED_TABLE_LINKS = 3;
const LIMITED_WORK = {
  PARTIAL_CHANGES_MAX_CHANGED_ROWS: String(MAX_CHANGED_ROWS),
  PARTIAL_CHANGES_MAX_PER_ROW_WORK: String(MAX_PER_ROW_WORK),
  PARTIAL_CHANGES_MAX_MIXED_TABLE_LINKS: String(MAX_MIXED_TABLE_LINKS),
};

const PRODUCTS = 'products';
const ORDERS = 'orders';
const NOTES = 'notes';
const OPERATIONS: ChangeOperation[] = ['commit', 'revert'];
const PRODUCT_IDS = ['p1', 'p2', 'p3', 'p4'];
const ORDER_IDS = ['o1', 'o2'];

const productSchema = obj({ title: str() });
const noteSchema = obj({
  title: str(),
  product: str({ foreignKey: PRODUCTS }),
});
const orderSchema = obj({
  price: num(),
  quantity: num(),
  total: numFormula('price * quantity'),
});

const titleOfP1: FieldRef = { tableId: PRODUCTS, rowId: 'p1', path: '/title' };
const CHANGED_ROWS_TOO_LARGE =
  'The affected tables hold 4 changed rows; the limit for one operation is 3';
const PER_ROW_WORK_TOO_LARGE =
  'The operation merges 2 rows that need per-row work (formula fields or file registration); the limit for one operation is 1';
const PRODUCT_LINKS_TOO_LARGE =
  'Assembling products copies up to 4 row links; the limit for one table is 3';
const missingOrder = { rows: [{ tableId: ORDERS, rowId: 'missing' }] };
// A limit decides before freshness (SPEC §5.6 step 1), whatever expected is.
const EXPECTATIONS = [
  { label: 'without expected', expected: undefined },
  { label: 'with a fingerprint of other rules', expected: 'pcf3.AA' },
  {
    label: 'with a fingerprint of another state',
    expected: encodeFingerprint({
      operation: 'commit',
      headRevisionId: 'previewed head',
      draftRevisionId: 'previewed draft',
      units: 'a'.repeat(64),
      content: 'b'.repeat(64),
    }),
  },
];
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
    'stops a %s with tooLarge before the catalogue when the affected tables hold more changed rows than the limit, returning no value of the plan (AS-87)',
    async (operation) => {
      const draft = await givenEditedProducts();

      const preview = await draft.previewChanges({
        operation,
        selection: { fields: [titleOfP1] },
      });

      expect(preview).toEqual<PreviewChangesResult>({
        status: 'blocked',
        planned: false,
        headRevisionId: await draft.revisionId('head'),
        draftRevisionId: await draft.revisionId('draft'),
        fingerprint: null,
        counts: null,
        coverage: [],
        refusedTables: [],
        required: [],
        blockers: [{ code: 'tooLarge', message: CHANGED_ROWS_TOO_LARGE }],
        deferred: [],
        sample: [],
        unmatched: null,
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
    'stops a %s with tooLarge in the closure when its merges need more per-row work than the limit, returning no value of what the closure found (AS-87)',
    async (operation) => {
      const draft = await givenTwoEditedOrders();

      const preview = await draft.previewChanges({
        operation,
        selection: { fields: [priceOf('o1'), priceOf('o2')] },
      });

      expect(preview).toEqual<PreviewChangesResult>({
        status: 'blocked',
        planned: false,
        headRevisionId: await draft.revisionId('head'),
        draftRevisionId: await draft.revisionId('draft'),
        fingerprint: null,
        counts: null,
        coverage: [],
        refusedTables: [],
        required: [],
        blockers: [{ code: 'tooLarge', message: PER_ROW_WORK_TOO_LARGE }],
        deferred: [],
        sample: [],
        unmatched: null,
        estimate: {
          changedRows: 2,
          mergedRows: 2,
          perRowWorkRows: 2,
          mixedTables: [
            {
              tableId: ORDERS,
              linksCopied: operation === 'commit' ? 2 : 0,
              linksAdded: 2,
            },
          ],
        },
      });
    },
  );

  it.each(OPERATIONS)(
    'returns no unmatched selectors of a %s stopped by a limit, though a selector matches nothing (AS-87)',
    async (operation) => {
      const draft = await givenEditedProducts();

      const preview = await draft.previewChanges({
        operation,
        selection: {
          fields: [titleOfP1],
          rows: [{ tableId: PRODUCTS, rowId: 'missing' }],
        },
      });

      expect(preview).toMatchObject({
        status: 'blocked',
        planned: false,
        unmatched: null,
        blockers: [{ code: 'tooLarge' }],
      });
    },
  );

  it.each(OPERATIONS)(
    'returns of a %s stopped in the closure only the tooLarge blockers, not the blocker of a selector that matches nothing (AS-87)',
    async (operation) => {
      const draft = await givenTwoEditedOrders();

      const preview = await draft.previewChanges({
        operation,
        selection: { fields: [priceOf('o1'), priceOf('o2')], ...missingOrder },
      });

      expect(preview).toMatchObject({
        status: 'blocked',
        planned: false,
        unmatched: null,
        blockers: [{ code: 'tooLarge', message: PER_ROW_WORK_TOO_LARGE }],
      });
      expect(preview.blockers).toHaveLength(1);
    },
  );

  it('stops a commit with tooLarge when a required addition makes a table mixed beyond the link limit, returning neither the addition nor the closure found before the stop (AS-87)', async () => {
    const draft = await givenNoteOfCreatedProductNextToAnEditedOne();

    const preview = await draft.previewChanges({
      operation: 'commit',
      selection: {
        fields: [{ tableId: NOTES, rowId: 'n1', path: '/product' }],
      },
    });
    const result = await draft.commitChanges({
      selection: {
        fields: [{ tableId: NOTES, rowId: 'n1', path: '/product' }],
      },
    });

    expect(preview).toMatchObject({
      status: 'blocked',
      planned: false,
      fingerprint: null,
      counts: null,
      coverage: [],
      required: [],
      deferred: [],
      sample: [],
      unmatched: null,
      blockers: [
        {
          code: 'tooLarge',
          tableId: PRODUCTS,
          message: PRODUCT_LINKS_TOO_LARGE,
        },
      ],
    });
    expect(preview.estimate.mixedTables).toContainEqual(
      expect.objectContaining({ tableId: PRODUCTS, linksCopied: 4 }),
    );
    expect(result).toEqual<CommitChangesResult>({
      status: 'blocked',
      planned: false,
      blockers: [
        {
          code: 'tooLarge',
          tableId: PRODUCTS,
          message: PRODUCT_LINKS_TOO_LARGE,
        },
      ],
      required: [],
    });
  });

  it.each(EXPECTATIONS)(
    'blocks a commit stopped by a limit with planned: false, no required additions and no unmatched selectors, never stale, $label (AS-87)',
    async ({ expected }) => {
      const draft = await givenTwoEditedOrders();

      const result = await draft.commitChanges({
        selection: { fields: [priceOf('o1'), priceOf('o2')], ...missingOrder },
        expected,
      });

      expect(result).toEqual<CommitChangesResult>({
        status: 'blocked',
        planned: false,
        blockers: [{ code: 'tooLarge', message: PER_ROW_WORK_TOO_LARGE }],
        required: [],
      });
    },
  );

  it.each(EXPECTATIONS)(
    'blocks a revert stopped by a limit with planned: false, no required additions and no unmatched selectors, never stale, $label (AS-87)',
    async ({ expected }) => {
      const draft = await givenEditedProducts();

      const result = await draft.revertChanges({
        selection: {
          fields: [titleOfP1],
          rows: [{ tableId: PRODUCTS, rowId: 'missing' }],
        },
        expected,
      });

      expect(result).toEqual<RevertChangesResult>({
        status: 'blocked',
        planned: false,
        blockers: [{ code: 'tooLarge', message: CHANGED_ROWS_TOO_LARGE }],
        required: [],
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

  async function givenNoteOfCreatedProductNextToAnEditedOne(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [PRODUCTS]: {
        schema: productSchema,
        rows: rowsOf(PRODUCT_IDS, () => ({ title: 'one' })),
      },
      [NOTES]: {
        schema: noteSchema,
        rows: { n1: { title: 'one', product: 'p1' } },
      },
    });
    await draft.createRows(PRODUCTS, { p9: { title: 'nine' } });
    await draft.updateRow(PRODUCTS, 'p1', { title: 'uno' });
    await draft.updateRow(NOTES, 'n1', { title: 'one', product: 'p9' });

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
