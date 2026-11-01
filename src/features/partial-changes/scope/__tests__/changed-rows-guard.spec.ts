import { num, obj, str } from '@revisium/schema-toolkit/mocks';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import type { FieldRef } from 'src/features/partial-changes/selection/selection';
import { ChangesScenario } from '../../__tests__/support/changes-scenario';
import {
  READING_EVERY_TABLE,
  readScopedCatalogue,
  type ScopedCatalogueView,
} from '../../__tests__/support/scoped-reading';

const MAX_CHANGED_ROWS = 3;
const LIMITED_CHANGED_ROWS = {
  PARTIAL_CHANGES_MAX_CHANGED_ROWS: String(MAX_CHANGED_ROWS),
};

const PRODUCTS = 'products';
const ORDERS = 'orders';
const LOGS = 'logs';
const ORDER_IDS = ['o1', 'o2', 'o3'];
const LOG_IDS = ['l1', 'l2', 'l3', 'l4', 'l5'];

const productSchema = obj({ title: str(), price: num() });
const orderSchema = obj({
  note: str(),
  product: str({ foreignKey: PRODUCTS }),
});
const logSchema = obj({ entry: str() });

const priceOfP1: FieldRef = { tableId: PRODUCTS, rowId: 'p1', path: '/price' };

describe('GuardChangedRows: the limit on changed rows of the affected tables', () => {
  let kit: PartialChangesTestKit;

  beforeAll(async () => {
    kit = await createPartialChangesTestKit({ settings: LIMITED_CHANGED_ROWS });
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await kit.guard.verifyAndForget();
  });

  afterAll(async () => {
    await kit.close();
  });

  it('refuses before loading any changed row when the affected tables hold more changed rows than the limit, each table in full', async () => {
    const draft = await givenPriceEdit(kit);
    await editRows(draft, ORDERS, ORDER_IDS, (rowId) => ({
      note: `edited ${rowId}`,
      product: 'p1',
    }));
    const loads = jest.spyOn(kit.snapshotReader, 'readChangedRows');

    const read = await draft.readScopedCatalogue({ fields: [priceOfP1] });

    expect(read).toEqual(
      refusedAsTooLarge({ changedRows: 4, unreadTables: 0 }),
    );
    expect(loads).not.toHaveBeenCalled();
  });

  it('reads one field although an unrelated table holds more changed rows than the limit', async () => {
    const draft = await givenPriceEditNextToEditedLogs(kit);

    const read = await draft.readScopedCatalogue({ fields: [priceOfP1] });

    expect(read).toMatchObject({
      kind: 'catalogue',
      changedRows: 1,
      readTableIds: [PRODUCTS],
      unreadTables: 1,
    });
  });

  it('refuses all: true, which reads every table', async () => {
    const draft = await givenPriceEditNextToEditedLogs(kit);

    const read = await draft.readScopedCatalogue({ all: true });

    expect(read).toEqual(
      refusedAsTooLarge({ changedRows: 1 + LOG_IDS.length, unreadTables: 0 }),
    );
  });

  describe('the reference read of AS-74, which reads every table', () => {
    let referenceKit: PartialChangesTestKit;

    beforeAll(async () => {
      referenceKit = await createPartialChangesTestKit({
        settings: LIMITED_CHANGED_ROWS,
        overrides: [READING_EVERY_TABLE],
      });
    });

    afterAll(async () => {
      await referenceKit.close();
    });

    it('counts the changed rows of the unrelated table and refuses the field that the scoped read reads', async () => {
      const draft = await givenPriceEditNextToEditedLogs(kit);

      const reference = await readScopedCatalogue(referenceKit, draft.branch, {
        fields: [priceOfP1],
      });

      expect(reference).toEqual(
        refusedAsTooLarge({ changedRows: 1 + LOG_IDS.length, unreadTables: 0 }),
      );
    });
  });
});

function refusedAsTooLarge({
  changedRows,
  unreadTables,
}: {
  changedRows: number;
  unreadTables: number;
}): ScopedCatalogueView {
  return {
    kind: 'tooLarge',
    changedRows,
    unreadTables,
    blocker: {
      code: 'tooLarge',
      message: `The affected tables hold ${changedRows} changed rows; the limit for one operation is ${MAX_CHANGED_ROWS}`,
    },
  };
}

async function givenPriceEditNextToEditedLogs(
  kit: PartialChangesTestKit,
): Promise<ChangesScenario> {
  const draft = await givenPriceEdit(kit);
  await editRows(draft, LOGS, LOG_IDS, (rowId) => ({
    entry: `edited ${rowId}`,
  }));

  return draft;
}

async function givenPriceEdit(
  kit: PartialChangesTestKit,
): Promise<ChangesScenario> {
  const draft = await ChangesScenario.committed(kit, {
    [PRODUCTS]: {
      schema: productSchema,
      rows: { p1: { title: 'one', price: 1 } },
    },
    [ORDERS]: {
      schema: orderSchema,
      rows: rowsOf(ORDER_IDS, () => ({ note: '', product: 'p1' })),
    },
    [LOGS]: { schema: logSchema, rows: rowsOf(LOG_IDS, () => ({ entry: '' })) },
  });
  await draft.updateRow(PRODUCTS, 'p1', { title: 'one', price: 2 });

  return draft;
}

async function editRows(
  draft: ChangesScenario,
  tableId: string,
  rowIds: readonly string[],
  dataOf: (rowId: string) => Record<string, string>,
): Promise<void> {
  for (const rowId of rowIds) {
    await draft.updateRow(tableId, rowId, dataOf(rowId));
  }
}

function rowsOf(
  rowIds: readonly string[],
  dataOf: () => Record<string, string>,
): Record<string, Record<string, string>> {
  return Object.fromEntries(rowIds.map((rowId) => [rowId, dataOf()]));
}
