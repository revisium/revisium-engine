import { SystemSchemaIds } from '@revisium/schema-toolkit/consts';
import { num, numFormula, obj, ref, str } from '@revisium/schema-toolkit/mocks';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import type { InputJsonValue } from 'src/engine-prisma-types';
import type { ChangeOperation } from 'src/features/partial-changes/assembly/outcome-rules';
import type {
  FieldRef,
  Selection,
} from 'src/features/partial-changes/selection/selection';
import { addField } from 'src/features/share/ledger-replay/__tests__/support/ledger-steps';
import { SystemTables } from 'src/features/share/system-tables.consts';
import type { TableViewsData } from 'src/features/views/types';
import { ChangesScenario } from '../../__tests__/support/changes-scenario';

const MAX_MIXED_TABLE_LINKS = 3;
const MAX_PER_ROW_WORK = 1;
const LIMITED_WORK = {
  PARTIAL_CHANGES_MAX_MIXED_TABLE_LINKS: String(MAX_MIXED_TABLE_LINKS),
  PARTIAL_CHANGES_MAX_PER_ROW_WORK: String(MAX_PER_ROW_WORK),
};

const PRODUCTS = 'products';
const CATEGORIES = 'categories';
const ORDERS = 'orders';
const DOCUMENTS = 'documents';

const productSchema = obj({ title: str(), price: num() });
const categorySchema = obj({ title: str() });
const shelfSchema = obj({
  title: str(),
  category: str({ foreignKey: CATEGORIES }),
});
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

const SCHEMA_HASH_OF_P1_AND_TITLE_OF_P2: Selection = {
  rowColumns: [{ tableId: PRODUCTS, rowId: 'p1' }],
  fields: [{ tableId: PRODUCTS, rowId: 'p2', path: '/title' }],
};
const FIVE_IDS = ['1', '2', '3', '4', '5'];
const MIXED_CASE_TABLE_IDS = ['apple', '_mixed', 'Zebra'];

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
    { operation: 'commit', linksCopied: 5, linksAdded: 2 },
    { operation: 'revert', linksCopied: 0, linksAdded: 1 },
  ])(
    'counts the changed and merged rows and the links of a mixed table in a $operation, a merged row as a copied link and an in-place revert copying no link',
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
      mixedTables: [{ tableId: ORDERS, linksCopied: 2, linksAdded: 2 }],
    });
  });

  it('counts the Head link that a merged row replaces as copied, an upper bound of the links the assembly copies', async () => {
    const draft = await givenRowColumnsEditNextToFieldEdit(kit);

    const closure = await draft.closeDependencies(
      'commit',
      SCHEMA_HASH_OF_P1_AND_TITLE_OF_P2,
    );
    const target = await draft.assembleTarget(
      'commit',
      SCHEMA_HASH_OF_P1_AND_TITLE_OF_P2,
    );

    expect(closure.estimate.mixedTables).toEqual([
      { tableId: PRODUCTS, linksCopied: 4, linksAdded: 2 },
    ]);
    expect(target.tableOf(PRODUCTS)).toMatchObject({
      removedLinks: ['head p1', 'head p2'],
      addedLinks: ['draft p2'],
      newRows: [expect.objectContaining({ id: 'p1', schemaHash: 'edited' })],
    });
  });

  it('lists the mixed tables in code-point order of their ids', async () => {
    const draft = await givenEditedTablesWithMixedCaseIds(kit);

    const closure = await draft.closeDependencies('commit', {
      fields: MIXED_CASE_TABLE_IDS.map((tableId) => titleOf(tableId, 'r1')),
    });

    expect(closure.estimate.mixedTables.map(({ tableId }) => tableId)).toEqual([
      'Zebra',
      '_mixed',
      'apple',
    ]);
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
              'Assembling products copies up to 5 row links; the limit for one table is 3',
          },
        ],
      });
      expect(assembling).not.toHaveBeenCalled();
    });

    it('refuses before any assembly when a merge that may collapse leaves the copied links above the limit', async () => {
      const draft = await givenRowColumnsEditNextToFieldEdit(limitedKit);
      const assembling = jest.spyOn(limitedKit.targetAssembler, 'assemble');

      const closure = await draft.closeDependencies(
        'commit',
        SCHEMA_HASH_OF_P1_AND_TITLE_OF_P2,
      );

      expect(closure).toMatchObject({
        kind: 'tooLarge',
        blockers: [
          {
            code: 'tooLarge',
            tableId: PRODUCTS,
            message:
              'Assembling products copies up to 4 row links; the limit for one table is 3',
          },
        ],
      });
      expect(assembling).not.toHaveBeenCalled();
    });

    it.each<{
      tables: string;
      given: (kit: PartialChangesTestKit) => Promise<ChangesScenario>;
      selection: Selection;
      blockers: { tableId: SystemTables; message: string }[];
    }>([
      {
        tables: 'the shared schemas',
        given: givenFiveSharedSchemasWithTwoEdited,
        selection: { sharedSchemas: ['s1'] },
        blockers: [tooLargeSystemTable(SystemTables.SharedSchemas, 4)],
      },
      {
        tables: 'the views',
        given: givenFiveTableViewsWithTwoEdited,
        selection: { views: ['t1'] },
        blockers: [tooLargeSystemTable(SystemTables.Views, 4)],
      },
      {
        tables: 'the schemas and the migrations',
        given: givenFiveTablesWithTwoStructuresEdited,
        selection: { tables: ['t1'] },
        blockers: [
          tooLargeSystemTable(SystemTables.Migration, 5),
          tooLargeSystemTable(SystemTables.Schema, 4),
        ],
      },
    ])(
      'refuses before any assembly when a partial selection would copy more links of $tables than the limit',
      async ({ given, selection, blockers }) => {
        const draft = await given(limitedKit);
        const assembling = jest.spyOn(limitedKit.targetAssembler, 'assemble');

        const closure = await draft.closeDependencies('commit', selection);

        expect(closure).toMatchObject({
          kind: 'tooLarge',
          blockers: blockers.map((blocker) => ({
            code: 'tooLarge',
            ...blocker,
          })),
        });
        expect(assembling).not.toHaveBeenCalled();
      },
    );

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

    it('estimates again before the assembly a required addition needs, and refuses that assembly', async () => {
      const draft = await givenShelfMovedToCreatedCategory(limitedKit);
      const assembling = jest.spyOn(limitedKit.targetAssembler, 'assemble');

      const closure = await draft.closeDependencies('commit', {
        fields: [{ tableId: 'shelves', rowId: 's1', path: '/category' }],
      });

      expect(closure).toMatchObject({
        kind: 'tooLarge',
        required: [
          { unit: { kind: 'rowCreate', tableId: CATEGORIES, rowId: 'c9' } },
        ],
        blockers: [
          {
            code: 'tooLarge',
            tableId: CATEGORIES,
            message:
              'Assembling categories copies up to 4 row links; the limit for one table is 3',
          },
        ],
      });
      expect(assembling).toHaveBeenCalledTimes(1);
    });
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

async function givenEditedTablesWithMixedCaseIds(
  kit: PartialChangesTestKit,
): Promise<ChangesScenario> {
  const draft = await ChangesScenario.committed(
    kit,
    Object.fromEntries(
      MIXED_CASE_TABLE_IDS.map((tableId) => [
        tableId,
        { schema: productSchema, rows: { r1: { title: 'one', price: 1 } } },
      ]),
    ),
  );

  for (const tableId of MIXED_CASE_TABLE_IDS) {
    await draft.updateRow(tableId, 'r1', { title: 'uno', price: 2 });
  }

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

async function givenRowColumnsEditNextToFieldEdit(
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
  await draft.updateRow(PRODUCTS, 'p1', { title: 'renamed', price: 10 });
  await draft.writeRowColumns(PRODUCTS, 'p1', { schemaHash: 'edited' });
  await draft.updateRow(PRODUCTS, 'p2', { title: 'renamed', price: 10 });

  return draft;
}

async function givenShelfMovedToCreatedCategory(
  kit: PartialChangesTestKit,
): Promise<ChangesScenario> {
  const draft = await ChangesScenario.committed(kit, {
    [CATEGORIES]: {
      schema: categorySchema,
      rows: rowsOf(['c1', 'c2', 'c3', 'c4'], (rowId) => ({ title: rowId })),
    },
    shelves: {
      schema: shelfSchema,
      rows: { s1: { title: 's1', category: 'c1' } },
    },
  });
  await draft.updateRow(CATEGORIES, 'c2', { title: 'edited' });
  await draft.createRows(CATEGORIES, { c9: { title: 'c9' } });
  await draft.updateRow('shelves', 's1', { title: 's1', category: 'c9' });

  return draft;
}

async function givenFiveSharedSchemasWithTwoEdited(
  kit: PartialChangesTestKit,
): Promise<ChangesScenario> {
  const draft = await ChangesScenario.committed(kit, {
    [PRODUCTS]: { schema: productSchema },
  });

  for (const id of FIVE_IDS) {
    await draft.createSharedSchema(`s${id}`, obj({ title: str() }));
  }

  await draft.commit();
  await draft.updateSharedSchema('s1', obj({ title: str(), note: str() }));
  await draft.updateSharedSchema('s2', obj({ title: str(), note: str() }));

  return draft;
}

async function givenFiveTableViewsWithTwoEdited(
  kit: PartialChangesTestKit,
): Promise<ChangesScenario> {
  const draft = await givenFiveTables(kit);

  for (const id of FIVE_IDS) {
    await draft.updateViews(`t${id}`, tableViews('All'));
  }

  await draft.commit();
  await draft.updateViews('t1', tableViews('Renamed'));
  await draft.updateViews('t2', tableViews('Renamed'));

  return draft;
}

async function givenFiveTablesWithTwoStructuresEdited(
  kit: PartialChangesTestKit,
): Promise<ChangesScenario> {
  const draft = await givenFiveTables(kit);
  await draft.updateTable('t1', [addField('note', str())]);
  await draft.updateTable('t2', [addField('note', str())]);

  return draft;
}

function givenFiveTables(kit: PartialChangesTestKit): Promise<ChangesScenario> {
  return ChangesScenario.committed(
    kit,
    Object.fromEntries(
      FIVE_IDS.map((id) => [`t${id}`, { schema: obj({ title: str() }) }]),
    ),
  );
}

function tableViews(name: string): TableViewsData {
  return {
    version: 1,
    defaultViewId: 'default',
    views: [{ id: 'default', name, columns: [{ field: 'data.title' }] }],
  };
}

function tooLargeSystemTable(
  tableId: SystemTables,
  linksCopied: number,
): { tableId: SystemTables; message: string } {
  return {
    tableId,
    message: `Assembling ${tableId} copies up to ${linksCopied} row links; the limit for one table is 3`,
  };
}

function rowsOf(
  rowIds: readonly string[],
  dataOf: (rowId: string) => InputJsonValue,
): Record<string, InputJsonValue> {
  return Object.fromEntries(rowIds.map((rowId) => [rowId, dataOf(rowId)]));
}
