import { SystemSchemaIds } from '@revisium/schema-toolkit/consts';
import {
  arr,
  num,
  numFormula,
  obj,
  ref,
  str,
} from '@revisium/schema-toolkit/mocks';
import type { JsonSchema } from '@revisium/schema-toolkit/types';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import type { InputJsonValue } from 'src/engine-prisma-types';
import type { ChangeOperation } from 'src/features/partial-changes/assembly/outcome-rules';
import type { Selection } from 'src/features/partial-changes/selection/selection';
import { addField } from 'src/features/share/ledger-replay/__tests__/support/ledger-steps';
import { ChangesScenario } from '../../__tests__/support/changes-scenario';
import { expectEveryDifferenceOwnedOnce } from '../../__tests__/support/column-ownership';

const PRODUCTS = 'products';
const ARTICLES = 'articles';
const ORDERS = 'orders';
const VALUES = 'values';
const RELEASE_DATE = '2030-01-01T00:00:00.000Z';

const productSchema = obj({ title: str(), price: num() });
const publishedAt = () => ref(SystemSchemaIds.RowPublishedAt);
const articleSchema = obj({
  title: str(),
  releasedAt: publishedAt(),
  reviewedAt: publishedAt(),
});
const orderSchema = obj({
  price: num(),
  quantity: num(),
  total: numFormula('price * quantity'),
});

const product = (rowId: string) => ({ tableId: PRODUCTS, rowId });
const titleOfP1 = { tableId: PRODUCTS, rowId: 'p1', path: '/title' };
const priceOfO1 = { tableId: ORDERS, rowId: 'o1', path: '/price' };
const rootOfR2 = { tableId: VALUES, rowId: 'r2', path: '' };

describe('TargetAssembler: row outcomes in a table of one structure', () => {
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
    version: 'head' | 'draft';
    merged: { title: string; price: number };
  }>([
    {
      operation: 'commit',
      version: 'head',
      merged: { title: 'uno', price: 10 },
    },
    {
      operation: 'revert',
      version: 'draft',
      merged: { title: 'one', price: 11 },
    },
  ])(
    'merges one field of a row into the $version version in a $operation',
    async ({ operation, version, merged }) => {
      const draft = await givenEditedProducts();

      const target = await draft.assembleTarget(operation, {
        fields: [titleOfP1],
      });

      expect(target.tableOf(PRODUCTS)).toMatchObject({
        outcome: 'mixed',
        version,
        removedLinks: [`${version} p1`],
        addedLinks: [],
        newRows: [{ id: 'p1', data: merged }],
      });
      expect(target.tableOf(PRODUCTS)?.rows).toContainEqual({
        head: 'p1',
        draft: 'p1',
        target: 'merged',
      });
    },
  );

  it.each<{
    unit: string;
    operation: ChangeOperation;
    selection: Selection;
    removedLinks: string[];
    addedLinks: string[];
  }>([
    {
      unit: 'a created row',
      operation: 'commit',
      selection: { rows: [product('p3')] },
      removedLinks: [],
      addedLinks: ['draft p3'],
    },
    {
      unit: 'a created row',
      operation: 'revert',
      selection: { rows: [product('p3')] },
      removedLinks: ['draft p3'],
      addedLinks: [],
    },
    {
      unit: 'a deleted row',
      operation: 'commit',
      selection: { rows: [product('p2')] },
      removedLinks: ['head p2'],
      addedLinks: [],
    },
    {
      unit: 'a deleted row',
      operation: 'revert',
      selection: { rows: [product('p2')] },
      removedLinks: [],
      addedLinks: ['head p2'],
    },
    {
      unit: 'a replaced row',
      operation: 'commit',
      selection: { rows: [product('p6')] },
      removedLinks: ['head p6'],
      addedLinks: ['draft p6'],
    },
    {
      unit: 'a replaced row',
      operation: 'revert',
      selection: { rows: [product('p6')] },
      removedLinks: ['draft p6'],
      addedLinks: ['head p6'],
    },
    {
      unit: 'a renamed row',
      operation: 'commit',
      selection: { renames: [product('p5')] },
      removedLinks: ['head p4'],
      addedLinks: ['draft p5'],
    },
    {
      unit: 'a renamed row',
      operation: 'revert',
      selection: { renames: [product('p5')] },
      removedLinks: ['draft p5'],
      addedLinks: ['head p4'],
    },
  ])(
    'takes $unit whole from the other side in a $operation',
    async ({ operation, selection, removedLinks, addedLinks }) => {
      const draft = await givenEditedProducts();

      const target = await draft.assembleTarget(operation, selection);

      expect(target.tableOf(PRODUCTS)).toMatchObject({
        outcome: 'mixed',
        removedLinks,
        addedLinks,
        newRows: [],
      });
    },
  );

  it('keeps every unselected row of a mixed table on the base side', async () => {
    const draft = await givenEditedProducts();

    const target = await draft.assembleTarget('commit', {
      rows: [product('p3')],
    });

    expect(target.tableOf(PRODUCTS)?.rows).toEqual([
      { head: 'p1', draft: 'p1', target: 'head' },
      { head: 'p2', target: 'head' },
      { draft: 'p3', target: 'draft' },
      { head: 'p4', draft: 'p5', target: 'head' },
      { draft: 'p6', target: 'absent' },
      { head: 'p6', target: 'head' },
    ]);
  });

  it.each<{
    operation: ChangeOperation;
    dataFrom: 'head' | 'draft';
    columnsFrom: 'head' | 'draft';
  }>([
    { operation: 'commit', dataFrom: 'head', columnsFrom: 'draft' },
    { operation: 'revert', dataFrom: 'draft', columnsFrom: 'head' },
  ])(
    'takes meta and publishedAt of a rowColumns unit from the $columnsFrom version in a $operation',
    async ({ operation, dataFrom, columnsFrom }) => {
      const draft = await givenArticleWithEditedColumns();
      const data = await draft.row(dataFrom, ARTICLES, 'a1');
      const columns = await draft.row(columnsFrom, ARTICLES, 'a1');

      const target = await draft.assembleTarget(operation, {
        rowColumns: [{ tableId: ARTICLES, rowId: 'a1' }],
      });

      expect(target.tableOf(ARTICLES)?.newRows).toEqual([
        expect.objectContaining({
          id: 'a1',
          data: data.data,
          hash: data.hash,
          meta: columns.meta,
          publishedAt: columns.publishedAt,
        }),
      ]);
    },
  );

  it.each<{
    operation: ChangeOperation;
    merged: { price: number; quantity: number; total: number };
  }>([
    { operation: 'commit', merged: { price: 5, quantity: 3, total: 15 } },
    { operation: 'revert', merged: { price: 2, quantity: 4, total: 8 } },
  ])(
    'recomputes a formula that reads an applied and a kept field in a $operation',
    async ({ operation, merged }) => {
      const draft = await givenEditedOrder();

      const target = await draft.assembleTarget(operation, {
        fields: [priceOfO1],
      });

      expect(target.tableOf(ORDERS)?.newRows).toEqual([
        expect.objectContaining({ id: 'o1', data: merged }),
      ]);
    },
  );

  it('gives a merged row the hash and schema hash a native writer gives its data', async () => {
    const draft = await givenEditedOrder();

    const target = await draft.assembleTarget('commit', {
      fields: [priceOfO1],
    });
    await draft.updateRow(ORDERS, 'o1', { price: 5, quantity: 3, total: 0 });

    const written = await draft.row('draft', ORDERS, 'o1');
    expect(target.tableOf(ORDERS)?.newRows).toEqual([
      expect.objectContaining({
        data: written.data,
        hash: written.hash,
        schemaHash: written.schemaHash,
      }),
    ]);
  });

  it.each<{
    operation: ChangeOperation;
    selection: Selection;
    outcome: string;
    removedLinks: string[];
    addedLinks: string[];
  }>([
    {
      operation: 'commit',
      selection: { rowColumns: [{ tableId: ARTICLES, rowId: 'a1' }] },
      outcome: 'base',
      removedLinks: [],
      addedLinks: [],
    },
    {
      operation: 'revert',
      selection: {
        fields: [{ tableId: ARTICLES, rowId: 'a1', path: '/title' }],
      },
      outcome: 'mixed',
      removedLinks: ['draft a1'],
      addedLinks: ['head a1'],
    },
  ])(
    'links the Head version instead of a merged row equal to it in a $operation',
    async ({ operation, selection, outcome, removedLinks, addedLinks }) => {
      const draft = await givenArticleWithForeignSchemaHash();

      const target = await draft.assembleTarget(operation, selection);

      expect(target.tableOf(ARTICLES)).toMatchObject({
        outcome,
        rows: [{ head: 'a1', draft: 'a1', target: 'head' }],
        removedLinks,
        addedLinks,
        newRows: [],
      });
    },
  );

  it.each<{
    operation: ChangeOperation;
    version: 'head' | 'draft';
    merged: Record<string, unknown>;
  }>([
    {
      operation: 'commit',
      version: 'head',
      merged: { title: 'uno', price: 10 },
    },
    {
      operation: 'revert',
      version: 'draft',
      merged: { title: 'one', price: 10, color: 'red' },
    },
  ])(
    'merges a field into the $version structure when the structure unit is not applied in a $operation',
    async ({ operation, version, merged }) => {
      const draft = await givenProductsWithStructureChange();
      const structureSideRow = await draft.row(version, PRODUCTS, 'p1');

      const target = await draft.assembleTarget(operation, {
        fields: [titleOfP1],
      });

      expect(target.tableOf(PRODUCTS)).toMatchObject({
        outcome: 'mixed',
        version,
        newRows: [
          {
            id: 'p1',
            data: merged,
            schemaHash: structureSideRow.schemaHash,
          },
        ],
      });
    },
  );

  it.each<{
    row: string;
    operation: ChangeOperation;
    schema: JsonSchema;
    committed: InputJsonValue;
    edited: InputJsonValue;
    removedLinks: string[];
    merged: { id: string; data: InputJsonValue };
  }>([
    {
      row: 'a scalar',
      operation: 'commit',
      schema: str(),
      committed: 'one',
      edited: 'two',
      removedLinks: ['head r1'],
      merged: { id: 'r1', data: 'two' },
    },
    {
      row: 'a scalar',
      operation: 'revert',
      schema: str(),
      committed: 'one',
      edited: 'two',
      removedLinks: ['draft r2'],
      merged: { id: 'r2', data: 'one' },
    },
    {
      row: 'an array',
      operation: 'commit',
      schema: arr(str()),
      committed: ['a', 'b'],
      edited: ['a', 'c'],
      removedLinks: ['head r1'],
      merged: { id: 'r1', data: ['a', 'c'] },
    },
    {
      row: 'an array',
      operation: 'revert',
      schema: arr(str()),
      committed: ['a', 'b'],
      edited: ['a', 'c'],
      removedLinks: ['draft r2'],
      merged: { id: 'r2', data: ['a', 'b'] },
    },
  ])(
    'merges the root value of $row row independently of its rename in a $operation',
    async ({ operation, schema, committed, edited, removedLinks, merged }) => {
      const draft = await givenRenamedRowWithEditedValue(
        schema,
        committed,
        edited,
      );

      const target = await draft.assembleTarget(operation, {
        fields: [rootOfR2],
      });

      expect(target.tableOf(VALUES)).toMatchObject({
        outcome: 'mixed',
        removedLinks,
        addedLinks: [],
        newRows: [merged],
      });
    },
  );

  it.each<{ operation: ChangeOperation; selection: Selection }>([
    { operation: 'commit', selection: { rows: [product('p3')] } },
    { operation: 'revert', selection: { rows: [product('p2')] } },
  ])(
    'refuses to move a row between structures in a $operation',
    async ({ operation, selection }) => {
      const draft = await givenProductsWithStructureChange();

      await expect(draft.assembleTarget(operation, selection)).rejects.toThrow(
        /between structures/,
      );
    },
  );

  async function givenEditedProducts(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [PRODUCTS]: {
        schema: productSchema,
        rows: {
          p1: { title: 'one', price: 10 },
          p2: { title: 'two', price: 20 },
          p4: { title: 'four', price: 40 },
          p6: { title: 'six', price: 60 },
        },
      },
    });
    await draft.updateRow(PRODUCTS, 'p1', { title: 'uno', price: 11 });
    await draft.removeRow(PRODUCTS, 'p2');
    await draft.createRows(PRODUCTS, { p3: { title: 'three', price: 30 } });
    await draft.renameRow(PRODUCTS, 'p4', 'p5');
    await draft.removeRow(PRODUCTS, 'p6');
    await draft.createRows(PRODUCTS, { p6: { title: 'new six', price: 66 } });
    expectEveryDifferenceOwnedOnce(await draft.readCatalogue([PRODUCTS]));

    return draft;
  }

  async function givenProductsWithStructureChange(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [PRODUCTS]: {
        schema: productSchema,
        rows: {
          p1: { title: 'one', price: 10 },
          p2: { title: 'two', price: 20 },
        },
      },
    });
    await draft.updateTable(PRODUCTS, [addField('color', str())]);
    await draft.updateRow(PRODUCTS, 'p1', {
      title: 'uno',
      price: 10,
      color: 'red',
    });
    await draft.removeRow(PRODUCTS, 'p2');
    await draft.createRows(PRODUCTS, {
      p3: { title: 'three', price: 30, color: 'blue' },
    });
    expectEveryDifferenceOwnedOnce(await draft.readCatalogue([PRODUCTS]));

    return draft;
  }

  async function givenArticleWithEditedColumns(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [ARTICLES]: {
        schema: articleSchema,
        rows: { a1: { title: 'one', releasedAt: '', reviewedAt: '' } },
      },
    });
    await draft.updateRow(ARTICLES, 'a1', {
      title: 'two',
      releasedAt: RELEASE_DATE,
      reviewedAt: '',
    });
    await draft.writeRowColumns(ARTICLES, 'a1', { meta: { note: 'one' } });
    expectEveryDifferenceOwnedOnce(await draft.readCatalogue([ARTICLES]));

    return draft;
  }

  async function givenArticleWithForeignSchemaHash(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [ARTICLES]: {
        schema: articleSchema,
        rows: { a1: { title: 'one', releasedAt: '', reviewedAt: '' } },
      },
    });
    await draft.updateRow(ARTICLES, 'a1', {
      title: 'two',
      releasedAt: '',
      reviewedAt: '',
    });
    await draft.writeRowColumns(ARTICLES, 'a1', { schemaHash: 'foreign' });
    expectEveryDifferenceOwnedOnce(await draft.readCatalogue([ARTICLES]));

    return draft;
  }

  async function givenRenamedRowWithEditedValue(
    schema: JsonSchema,
    committed: InputJsonValue,
    edited: InputJsonValue,
  ): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [VALUES]: { schema, rows: { r1: committed } },
    });
    await draft.renameRow(VALUES, 'r1', 'r2');
    await draft.updateRow(VALUES, 'r2', edited);
    expectEveryDifferenceOwnedOnce(await draft.readCatalogue([VALUES]));

    return draft;
  }

  async function givenEditedOrder(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [ORDERS]: {
        schema: orderSchema,
        rows: { o1: { price: 2, quantity: 3, total: 0 } },
      },
    });
    await draft.updateRow(ORDERS, 'o1', { price: 5, quantity: 4, total: 0 });
    expectEveryDifferenceOwnedOnce(await draft.readCatalogue([ORDERS]));

    return draft;
  }
});
