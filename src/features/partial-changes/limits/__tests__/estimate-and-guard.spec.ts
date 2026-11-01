import { SystemSchemaIds } from '@revisium/schema-toolkit/consts';
import { num, numFormula, obj, ref, str } from '@revisium/schema-toolkit/mocks';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import type { InputJsonValue } from 'src/engine-prisma-types';
import type { ChangeOperation } from 'src/features/partial-changes/assembly/outcome-rules';
import type { FieldRef } from 'src/features/partial-changes/selection/selection';
import { ChangesScenario } from '../../__tests__/support/changes-scenario';

const MAX_MIXED_TABLE_LINKS = 3;
const MAX_PER_ROW_WORK = 1;
const LIMITED_WORK = {
  PARTIAL_CHANGES_MAX_MIXED_TABLE_LINKS: String(MAX_MIXED_TABLE_LINKS),
  PARTIAL_CHANGES_MAX_PER_ROW_WORK: String(MAX_PER_ROW_WORK),
};

const PRODUCTS = 'products';
const ORDERS = 'orders';
const DOCUMENTS = 'documents';

const productSchema = obj({ title: str(), price: num() });
const orderSchema = obj({
  price: num(),
  quantity: num(),
  total: numFormula('price * quantity'),
});
const documentSchema = obj({
  title: str(),
  note: str(),
  image: ref(SystemSchemaIds.File),
});

const emptyFile = {
  status: '',
  fileId: '',
  url: '',
  fileName: '',
  hash: '',
  extension: '',
  mimeType: '',
  size: 0,
  width: 0,
  height: 0,
};

const titleOf = (tableId: string, rowId: string): FieldRef => ({
  tableId,
  rowId,
  path: '/title',
});
const priceOf = (rowId: string): FieldRef => ({
  tableId: ORDERS,
  rowId,
  path: '/price',
});

describe('EstimateAndGuard: the estimate before every closure assembly', () => {
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
    operation: ChangeOperation;
    linksCopied: number;
    linksAdded: number;
  }>([
    { operation: 'commit', linksCopied: 4, linksAdded: 2 },
    { operation: 'revert', linksCopied: 0, linksAdded: 1 },
  ])(
    'counts the changed and merged rows and the links of a mixed table in a $operation, an in-place revert copying no link',
    async ({ operation, linksCopied, linksAdded }) => {
      const draft = await givenFiveProductsWithEdits(kit);

      const closure = await draft.closeDependencies(operation, {
        fields: [titleOf(PRODUCTS, 'p1')],
        rows: [{ tableId: PRODUCTS, rowId: 'p6' }],
      });

      expect(closure).toMatchObject({
        kind: 'closed',
        estimate: {
          changedRows: 3,
          mergedRows: 1,
          perRowWorkRows: 0,
          mixedTables: [{ tableId: PRODUCTS, linksCopied, linksAdded }],
        },
      });
    },
  );

  it('counts the merged rows of a table with formula fields as per-row work', async () => {
    const draft = await givenTwoEditedOrders(kit);

    const closure = await draft.closeDependencies('commit', {
      fields: [priceOf('o1'), priceOf('o2')],
    });

    expect(closure.estimate).toEqual({
      changedRows: 2,
      mergedRows: 2,
      perRowWorkRows: 2,
      mixedTables: [{ tableId: ORDERS, linksCopied: 0, linksAdded: 2 }],
    });
  });

  it('counts nothing for a table that a commit takes whole from the Draft', async () => {
    const draft = await givenFiveProductsWithEdits(kit);

    const closure = await draft.closeDependencies('commit', {
      tableData: [PRODUCTS],
    });

    expect(closure.estimate).toEqual({
      changedRows: 3,
      mergedRows: 0,
      perRowWorkRows: 0,
      mixedTables: [],
    });
  });

  describe('the guard of the per-table and per-row-work limits', () => {
    let limitedKit: PartialChangesTestKit;

    beforeAll(async () => {
      limitedKit = await createPartialChangesTestKit({
        settings: LIMITED_WORK,
      });
    });

    afterEach(async () => {
      jest.restoreAllMocks();
      await limitedKit.guard.verifyAndForget();
    });

    afterAll(async () => {
      await limitedKit.close();
    });

    it('refuses a mixed table that would copy more links than the limit before any assembly', async () => {
      const draft = await givenFiveProductsWithEdits(limitedKit);
      const assembling = jest.spyOn(limitedKit.targetAssembler, 'assemble');

      const closure = await draft.closeDependencies('commit', {
        fields: [titleOf(PRODUCTS, 'p1')],
      });

      expect(closure).toMatchObject({
        kind: 'tooLarge',
        blockers: [
          {
            code: 'tooLarge',
            tableId: PRODUCTS,
            message:
              'Assembling products copies 4 row links; the limit for one table is 3',
          },
        ],
      });
      expect(assembling).not.toHaveBeenCalled();
    });

    it('assembles an in-place revert of the same table, which copies no link', async () => {
      const draft = await givenFiveProductsWithEdits(limitedKit);

      const closure = await draft.closeDependencies('revert', {
        fields: [titleOf(PRODUCTS, 'p1')],
      });

      expect(closure).toMatchObject({ kind: 'closed', blockers: [] });
    });

    it.each<{
      fields: string;
      given: (kit: PartialChangesTestKit) => Promise<ChangesScenario>;
      selection: FieldRef[];
    }>([
      {
        fields: 'formula',
        given: givenTwoEditedOrders,
        selection: [priceOf('o1'), priceOf('o2')],
      },
      {
        fields: 'File',
        given: givenTwoEditedDocuments,
        selection: [titleOf(DOCUMENTS, 'd1'), titleOf(DOCUMENTS, 'd2')],
      },
    ])(
      'refuses more merged rows in tables with $fields fields than the per-row-work limit before any assembly',
      async ({ given, selection }) => {
        const draft = await given(limitedKit);
        const assembling = jest.spyOn(limitedKit.targetAssembler, 'assemble');

        const closure = await draft.closeDependencies('commit', {
          fields: selection,
        });

        expect(closure).toMatchObject({
          kind: 'tooLarge',
          blockers: [
            {
              code: 'tooLarge',
              message:
                'The operation merges 2 rows that need per-row work (formula fields or file registration); the limit for one operation is 1',
            },
          ],
        });
        expect(assembling).not.toHaveBeenCalled();
      },
    );
  });
});

async function givenFiveProductsWithEdits(
  kit: PartialChangesTestKit,
): Promise<ChangesScenario> {
  const draft = await ChangesScenario.committed(kit, {
    [PRODUCTS]: {
      schema: productSchema,
      rows: rowsOf(['p1', 'p2', 'p3', 'p4', 'p5'], (rowId) => ({
        title: rowId,
        price: 10,
      })),
    },
  });
  await draft.updateRow(PRODUCTS, 'p1', { title: 'renamed', price: 11 });
  await draft.updateRow(PRODUCTS, 'p2', { title: 'p2', price: 12 });
  await draft.createRows(PRODUCTS, { p6: { title: 'p6', price: 13 } });

  return draft;
}

async function givenTwoEditedOrders(
  kit: PartialChangesTestKit,
): Promise<ChangesScenario> {
  const draft = await ChangesScenario.committed(kit, {
    [ORDERS]: {
      schema: orderSchema,
      rows: rowsOf(['o1', 'o2'], () => ({ price: 2, quantity: 3, total: 0 })),
    },
  });

  for (const rowId of ['o1', 'o2']) {
    await draft.updateRow(ORDERS, rowId, { price: 5, quantity: 7, total: 0 });
  }

  return draft;
}

async function givenTwoEditedDocuments(
  kit: PartialChangesTestKit,
): Promise<ChangesScenario> {
  const draft = await ChangesScenario.committed(kit, {
    [DOCUMENTS]: {
      schema: documentSchema,
      rows: rowsOf(['d1', 'd2'], (rowId) => ({
        title: rowId,
        note: '',
        image: emptyFile,
      })),
    },
  });

  for (const rowId of ['d1', 'd2']) {
    const { data } = await draft.row('draft', DOCUMENTS, rowId);

    await draft.updateRow(DOCUMENTS, rowId, {
      ...(data as Record<string, InputJsonValue>),
      title: `${rowId} edited`,
      note: 'edited',
    });
  }

  return draft;
}

function rowsOf(
  rowIds: readonly string[],
  dataOf: (rowId: string) => InputJsonValue,
): Record<string, InputJsonValue> {
  return Object.fromEntries(rowIds.map((rowId) => [rowId, dataOf(rowId)]));
}
