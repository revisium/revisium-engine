import { SystemSchemaIds } from '@revisium/schema-toolkit/consts';
import {
  arr,
  num,
  numFormula,
  obj,
  ref,
  str,
} from '@revisium/schema-toolkit/mocks';
import objectHash from 'object-hash';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import {
  addField,
  moveField,
  removeField,
  replaceField,
} from 'src/__tests__/fixtures/ledger-steps';
import type { InputJsonValue } from 'src/engine-prisma-types';
import { ListingValidationError } from 'src/features/partial-changes/listing/listing-validation-error';
import type {
  DraftFieldChange,
  DraftRowItem,
  RowSelection,
} from 'src/features/partial-changes/queries/impl/get-draft-row-changes.query';
import {
  ChangeType,
  RowChangeDetailType,
  type RowChange,
} from 'src/features/revision-changes/types';
import { compareCodePoints } from 'src/features/share/utils/compare-code-points';
import { transactionModeOfSnapshotRead } from '../../__tests__/support/change-preview';
import { ChangesScenario } from '../../__tests__/support/changes-scenario';
import {
  readRowPageBeforeItsPairs,
  readRowPageWhileDraftChanges,
} from '../../__tests__/support/draft-read-races';
import {
  draftReadQueriesDuring,
  rowItemsOf,
} from '../../__tests__/support/draft-reading';
import {
  describedStructureRef,
  existenceRef,
  fieldRef,
  headSideDeletionRef,
  renameRef,
  rowColumnsRef,
  structureRef,
} from '../../__tests__/support/expected-unit-refs';

const PRODUCTS = 'products';
const ORDERS = 'orders';
const ITEMS = 'items';
const TAGS = 'tags';
const ARTICLES = 'articles';
const DOCUMENTS = 'documents';
const GOODS = 'goods';
const BOXES = 'boxes';
const LOGS = 'logs';
const LINES = 'lines';
const RELEASE_DATE = '2030-01-01T00:00:00.000Z';
const PAGE_SIZES = [1, 2, 7];

const productSchema = obj({ title: str(), price: num(), tags: arr(str()) });
const orderSchema = obj({
  price: num(),
  quantity: num(),
  total: numFormula('price * quantity'),
});
const itemSchema = obj({ name: str(), note: str() });
const labelSchema = obj({ label: str() });
const titleSchema = obj({ title: str() });
const boxSchema = obj({ dims: obj({ width: num(), height: num() }) });
const lineSchema = obj({ parts: arr(obj({ name: str() })) });
const logSchema = obj({
  title: str(),
  entries: arr(obj({ updated: ref(SystemSchemaIds.RowUpdatedAt) })),
});
const articleSchema = obj({
  title: str(),
  releasedAt: ref(SystemSchemaIds.RowPublishedAt),
});
const documentSchema = obj({
  title: str(),
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

describe('draft row changes', () => {
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

  describe('field changes', () => {
    it('gives an edited field its value change and field unit, and the row every unit of the row', async () => {
      const draft = await givenCommittedProducts();
      await draft.updateRow(PRODUCTS, 'p1', product('edited'));

      const [item] = await readRowItems(draft);
      const title = fieldRef(PRODUCTS, 'p1', '/title');

      expect(item).toEqual({
        tableId: PRODUCTS,
        rowId: 'p1',
        changeType: ChangeType.Modified,
        fields: [
          {
            path: '/title',
            changeType: RowChangeDetailType.FieldModified,
            oldValue: 'p1',
            newValue: 'edited',
            selection: { state: 'unit', unit: title },
          },
        ],
        columns: [],
        selection: {
          state: 'selectable',
          row: { rows: [{ tableId: PRODUCTS, rowId: 'p1' }] },
          units: [title],
        },
      });
    });

    it('marks a formula output that follows its edited input as computed, with its computed values', async () => {
      const draft = await ChangesScenario.committed(kit, {
        [ORDERS]: {
          schema: orderSchema,
          rows: { o1: { price: 2, quantity: 3, total: 0 } },
        },
      });
      await draft.updateRow(ORDERS, 'o1', { price: 5, quantity: 3, total: 0 });

      const [item] = await readRowItems(draft);

      expect(fieldsByPath(item)).toEqual([
        {
          path: '/price',
          changeType: RowChangeDetailType.FieldModified,
          oldValue: 2,
          newValue: 5,
          selection: { state: 'unit', unit: fieldRef(ORDERS, 'o1', '/price') },
        },
        {
          path: '/total',
          changeType: RowChangeDetailType.FieldModified,
          oldValue: 6,
          newValue: 15,
          selection: { state: 'computed' },
        },
      ]);
    });

    it('reads an edited array element at its own pointer and gives it the field unit of the whole array', async () => {
      const draft = await givenCommittedProducts();
      await draft.updateRow(PRODUCTS, 'p2', product('p2', 2, ['a', 'c', 'd']));

      const [item] = await readRowItems(draft);
      const tags = {
        state: 'unit',
        unit: fieldRef(PRODUCTS, 'p2', '/tags'),
      };

      expect(item?.fields).toEqual([
        {
          path: '/tags/1',
          changeType: RowChangeDetailType.FieldModified,
          oldValue: 'b',
          newValue: 'c',
          selection: tags,
        },
        {
          path: '/tags/2',
          changeType: RowChangeDetailType.FieldAdded,
          oldValue: null,
          newValue: 'd',
          selection: tags,
        },
      ]);
    });

    it('reads a removed array element with its Head value', async () => {
      const draft = await givenCommittedProducts();
      await draft.updateRow(PRODUCTS, 'p2', product('p2', 2, ['a']));

      const [item] = await readRowItems(draft);

      expect(item?.fields).toEqual([
        {
          path: '/tags/1',
          changeType: RowChangeDetailType.FieldRemoved,
          oldValue: 'b',
          newValue: null,
          selection: {
            state: 'unit',
            unit: fieldRef(PRODUCTS, 'p2', '/tags'),
          },
        },
      ]);
    });

    it('reads an added array element that is an object at its object pointer, selecting the array', async () => {
      const draft = await ChangesScenario.committed(kit, {
        [LINES]: {
          schema: lineSchema,
          rows: { l1: { parts: [{ name: 'a' }] } },
        },
      });
      await draft.updateRow(LINES, 'l1', {
        parts: [{ name: 'a' }, { name: 'b' }],
      });

      const [item] = await readRowItems(draft);

      expect(item?.fields).toEqual([
        {
          path: '/parts/1',
          changeType: RowChangeDetailType.FieldAdded,
          oldValue: null,
          newValue: { name: 'b' },
          selection: {
            state: 'unit',
            unit: fieldRef(LINES, 'l1', '/parts'),
          },
        },
      ]);
    });

    it('reads a nested field at its JSON Pointer', async () => {
      const draft = await ChangesScenario.committed(kit, {
        [BOXES]: {
          schema: boxSchema,
          rows: { b1: { dims: { width: 1, height: 2 } } },
        },
      });
      await draft.updateRow(BOXES, 'b1', { dims: { width: 3, height: 2 } });

      const [item] = await readRowItems(draft);

      expect(item?.fields).toEqual([
        {
          path: '/dims/width',
          changeType: RowChangeDetailType.FieldModified,
          oldValue: 1,
          newValue: 3,
          selection: {
            state: 'unit',
            unit: fieldRef(BOXES, 'b1', '/dims/width'),
          },
        },
      ]);
    });

    it('gives a created row one root entry with its whole data, going with its creation', async () => {
      const draft = await givenCommittedProducts();
      await draft.createRows(PRODUCTS, { p4: product('new') });

      const [item] = await readRowItems(draft);
      const creation = existenceRef('rowCreate', PRODUCTS, 'p4');

      expect(item).toMatchObject({
        rowId: 'p4',
        changeType: ChangeType.Added,
        fields: [
          {
            path: '',
            changeType: RowChangeDetailType.FieldAdded,
            oldValue: null,
            newValue: product('new'),
            selection: {
              state: 'goesWith',
              unit: creation,
              reason: 'rowExistence',
            },
          },
        ],
        columns: [],
        selection: { state: 'selectable', units: [creation] },
      });
    });

    it('gives a deleted row one root entry with its whole data, going with its deletion', async () => {
      const draft = await givenCommittedProducts();
      await draft.removeRow(PRODUCTS, 'p1');

      const [item] = await readRowItems(draft);
      const deletion = existenceRef('rowDelete', PRODUCTS, 'p1');

      expect(item).toMatchObject({
        rowId: 'p1',
        changeType: ChangeType.Removed,
        fields: [
          {
            path: '',
            changeType: RowChangeDetailType.FieldRemoved,
            oldValue: product('p1'),
            newValue: null,
            selection: {
              state: 'goesWith',
              unit: deletion,
              reason: 'rowExistence',
            },
          },
        ],
        selection: {
          state: 'selectable',
          row: { rows: [{ tableId: PRODUCTS, rowId: 'p1' }] },
          units: [deletion],
        },
      });
    });

    it('gives every changed part of an uploaded file the field unit of the whole file', async () => {
      const draft = await ChangesScenario.committed(kit, {
        [DOCUMENTS]: {
          schema: documentSchema,
          rows: { d1: { title: 'one', image: emptyFile } },
        },
      });
      await draft.uploadFile(DOCUMENTS, 'd1', 'image');

      const [item] = await readRowItems(draft);

      expect(item?.fields.length).toBeGreaterThan(1);
      expect(
        item?.fields.map(({ path, selection }) => [path, selection]),
      ).toEqual(
        item?.fields.map(({ path }) => [
          path,
          { state: 'unit', unit: fieldRef(DOCUMENTS, 'd1', '/image') },
        ]),
      );
      expect(item?.fields.every(({ path }) => path.startsWith('/image/'))).toBe(
        true,
      );
    });

    it('marks a system value that changed inside an array whose stored value is unchanged as computed', async () => {
      const draft = await ChangesScenario.committed(kit, {
        [LOGS]: {
          schema: logSchema,
          rows: { l1: { title: 'one', entries: [{ updated: '' }] } },
        },
      });
      await draft.updateRow(LOGS, 'l1', {
        title: 'edited',
        entries: [{ updated: '' }],
      });

      const [item] = await readRowItems(draft);

      expect(fieldViewsOf(item)).toEqual([
        [
          '/entries/0/updated',
          RowChangeDetailType.FieldModified,
          { state: 'computed' },
        ],
        [
          '/title',
          RowChangeDetailType.FieldModified,
          { state: 'unit', unit: fieldRef(LOGS, 'l1', '/title') },
        ],
      ]);
    });

    it('takes the units of a row from its stored values, before the formula values are computed', async () => {
      const draft = await ChangesScenario.committed(kit, {
        [PRODUCTS]: { schema: productSchema, rows: { p1: product('') } },
      });
      await draft.updateRow(PRODUCTS, 'p1', product('edited'));
      await rewriteDraftRowData(draft, PRODUCTS, 'p1', {
        ...product(''),
        title: null,
      });

      const [item] = await readRowItems(draft);
      const title = fieldRef(PRODUCTS, 'p1', '/title');

      expect(item).toMatchObject({
        fields: [],
        selection: { state: 'selectable', units: [title] },
      });
      expect(await draft.listEveryUnit()).toEqual([
        expect.objectContaining(title),
      ]);
    });

    it('says a row whose only stored difference is a formula output is computed', async () => {
      const draft = await givenOrderWithOnlyItsFormulaOutputRewritten();

      const [item] = await readRowItems(draft);

      expect(item).toMatchObject({
        selection: { state: 'computed', units: [] },
        fields: [],
        columns: [],
      });
    });
  });

  describe('structure changes', () => {
    it('lets a row that differs only in changed fields go with the structure, beside a row with its own field unit', async () => {
      const draft = await ChangesScenario.committed(kit, {
        [ITEMS]: {
          schema: itemSchema,
          rows: {
            i1: { name: 'one', note: '' },
            i2: { name: 'two', note: '' },
          },
        },
      });
      await draft.updateTable(ITEMS, [
        moveField('name', 'title'),
        addField('color', str()),
      ]);
      await draft.updateRow(ITEMS, 'i1', {
        title: 'one',
        note: 'edited',
        color: '',
      });

      const items = await readRowItems(draft);
      const goesWithStructure = {
        state: 'goesWith',
        unit: describedStructureRef(
          {
            table: 'changed',
            fields: [
              { path: '/color', change: 'added' },
              { path: '/title', change: 'moved', from: '/name' },
            ],
            views: false,
          },
          ITEMS,
        ),
        reason: 'structureBound',
      };

      expect(rowItemOf(items, 'i2')?.selection).toEqual({
        ...goesWithStructure,
        units: [],
      });
      expect(fieldViewsOf(rowItemOf(items, 'i2'))).toEqual([
        ['/color', RowChangeDetailType.FieldAdded, goesWithStructure],
        ['/name', RowChangeDetailType.FieldRemoved, goesWithStructure],
        ['/title', RowChangeDetailType.FieldAdded, goesWithStructure],
      ]);
      expect(rowItemOf(items, 'i1')?.selection).toEqual({
        state: 'selectable',
        row: { rows: [{ tableId: ITEMS, rowId: 'i1' }] },
        units: [fieldRef(ITEMS, 'i1', '/note')],
        structure: structureRef(ITEMS),
      });
      expect(fieldViewsOf(rowItemOf(items, 'i1'))).toEqual([
        ['/color', RowChangeDetailType.FieldAdded, goesWithStructure],
        ['/name', RowChangeDetailType.FieldRemoved, goesWithStructure],
        [
          '/note',
          RowChangeDetailType.FieldModified,
          { state: 'unit', unit: fieldRef(ITEMS, 'i1', '/note') },
        ],
        ['/title', RowChangeDetailType.FieldAdded, goesWithStructure],
      ]);
    });

    it.each([
      ['description', { ...str(), description: 'Shown in lists' }],
      ['default', { ...str(), default: 'untitled' }],
    ])(
      'does not list the rows that a %s-only schema update only rewrote with its schema hash',
      async (_change, title) => {
        const draft = await givenCommittedProducts();
        await draft.updateTable(PRODUCTS, [replaceField('title', title)]);

        const page = await draft.readDraftRowChanges({ first: 10 });

        expect(page.edges).toEqual([]);
        expect(page.pageInfo).toEqual({ hasNextPage: false, endCursor: null });
      },
    );

    it('lists a row of a table with a structure change whose meta also changed, with its rewritten schema hash going with the structure', async () => {
      const draft = await givenCommittedProducts();
      await draft.updateTable(PRODUCTS, [
        replaceField('title', { ...str(), description: 'Shown in lists' }),
      ]);
      await draft.writeRowColumns(PRODUCTS, 'p1', {
        meta: { note: 'checked' },
      });

      const items = await readRowItems(draft);
      const rowColumns = rowColumnsRef(PRODUCTS, 'p1', ['meta']);

      expect(items).toEqual([
        expect.objectContaining({
          rowId: 'p1',
          selection: {
            state: 'selectable',
            row: { rows: [{ tableId: PRODUCTS, rowId: 'p1' }] },
            units: [rowColumns],
            structure: structureRef(PRODUCTS),
          },
          columns: [
            expect.objectContaining({
              column: 'meta',
              newValue: { note: 'checked' },
              selection: { state: 'unit', unit: rowColumns },
            }),
            expect.objectContaining({
              column: 'schemaHash',
              selection: {
                state: 'goesWith',
                unit: expect.objectContaining(structureRef(PRODUCTS)),
                reason: 'structureBound',
              },
            }),
          ],
        }),
      ]);
    });

    it('lets the rows of a created table and their fields go with its structure, described as created', async () => {
      const draft = await givenCommittedProducts();
      await draft.createTable(TAGS, labelSchema);
      await draft.createRows(TAGS, { t1: { label: 'one' } });

      const [item] = await readRowItems(draft);
      const goesWithCreatedTable = {
        state: 'goesWith',
        unit: describedStructureRef(
          { table: 'created', fields: [], views: false },
          TAGS,
        ),
        reason: 'tableExistence',
      };

      expect(item).toEqual({
        tableId: TAGS,
        rowId: 't1',
        changeType: ChangeType.Added,
        fields: [
          {
            path: '',
            changeType: RowChangeDetailType.FieldAdded,
            oldValue: null,
            newValue: { label: 'one' },
            selection: goesWithCreatedTable,
          },
        ],
        columns: [],
        selection: { ...goesWithCreatedTable, units: [] },
      });
    });

    it('lets the rows of a replaced table and their fields go with its structure, described by the fields of both tables', async () => {
      const draft = await givenCommittedProducts();
      await draft.removeTable(PRODUCTS);
      await draft.createTable(PRODUCTS, labelSchema);
      await draft.createRows(PRODUCTS, { p9: { label: 'again' } });

      const items = await readRowItems(draft);
      const goesWithReplacedTable = {
        state: 'goesWith',
        unit: describedStructureRef(
          {
            table: 'replaced',
            fields: [
              { path: '/label', change: 'added' },
              { path: '/price', change: 'removed' },
              { path: '/tags', change: 'removed' },
              { path: '/title', change: 'removed' },
            ],
            views: false,
          },
          PRODUCTS,
        ),
        reason: 'tableExistence',
      };

      expect(
        items.map(({ rowId, changeType, selection }) => [
          rowId,
          changeType,
          selection,
        ]),
      ).toEqual([
        ['p1', ChangeType.Removed, { ...goesWithReplacedTable, units: [] }],
        ['p2', ChangeType.Removed, { ...goesWithReplacedTable, units: [] }],
        ['p3', ChangeType.Removed, { ...goesWithReplacedTable, units: [] }],
        ['p9', ChangeType.Added, { ...goesWithReplacedTable, units: [] }],
      ]);
      expect(items.flatMap(({ fields }) => fields)).toEqual(
        items.map(() =>
          expect.objectContaining({
            path: '',
            selection: goesWithReplacedTable,
          }),
        ),
      );
    });
  });

  describe('row ids and change types', () => {
    it('addresses each row item by the public ids of its row and table, with the change type of its row', async () => {
      const draft = await givenCommittedProducts();
      await draft.updateRow(PRODUCTS, 'p1', product('edited'));
      await draft.renameRow(PRODUCTS, 'p2', 'p20');
      await draft.removeRow(PRODUCTS, 'p3');

      const items = await readRowItems(draft);

      expect(items.map(idsOf)).toEqual([
        { tableId: PRODUCTS, rowId: 'p1', changeType: ChangeType.Modified },
        {
          tableId: PRODUCTS,
          rowId: 'p20',
          previousRowId: 'p2',
          changeType: ChangeType.Renamed,
        },
        { tableId: PRODUCTS, rowId: 'p3', changeType: ChangeType.Removed },
      ]);
    });

    it('addresses the rows of a renamed table by its Draft id and Head id, and of a removed table by its Head id', async () => {
      const draft = await givenCommittedProducts();
      await draft.createTable(TAGS, labelSchema);
      await draft.createRows(TAGS, { t1: { label: 'one' } });
      await draft.commit();
      await draft.renameTable(PRODUCTS, GOODS);
      await draft.updateRow(GOODS, 'p1', product('edited'));
      await draft.removeTable(TAGS);

      const items = await readRowItems(draft);

      expect(items.map(idsOf)).toEqual([
        {
          tableId: GOODS,
          previousTableId: PRODUCTS,
          rowId: 'p1',
          changeType: ChangeType.Modified,
        },
        { tableId: TAGS, rowId: 't1', changeType: ChangeType.Removed },
      ]);
      expect(rowItemOf(items, 'p1')?.selection).toEqual({
        state: 'selectable',
        row: { rows: [{ tableId: GOODS, rowId: 'p1' }] },
        units: [fieldRef(GOODS, 'p1', '/title')],
        structure: structureRef(GOODS, PRODUCTS),
      });
    });

    it('gives a renamed row its rename unit under the Draft id', async () => {
      const draft = await givenCommittedProducts();
      await draft.renameRow(PRODUCTS, 'p1', 'p10');

      const [item] = await readRowItems(draft);

      expect(item).toEqual({
        tableId: PRODUCTS,
        rowId: 'p10',
        previousRowId: 'p1',
        changeType: ChangeType.Renamed,
        fields: [],
        columns: [],
        selection: {
          state: 'selectable',
          row: { rows: [{ tableId: PRODUCTS, rowId: 'p10' }] },
          units: [renameRef(PRODUCTS, 'p10', 'p1')],
        },
      });
    });

    it('gives a renamed and edited row its rename and field units in one item', async () => {
      const draft = await givenCommittedProducts();
      await draft.renameRow(PRODUCTS, 'p1', 'p10');
      await draft.updateRow(PRODUCTS, 'p10', product('edited'));

      const [item] = await readRowItems(draft);

      expect(item).toMatchObject({
        changeType: ChangeType.RenamedAndModified,
        selection: {
          state: 'selectable',
          row: { rows: [{ tableId: PRODUCTS, rowId: 'p10' }] },
          units: [
            fieldRef(PRODUCTS, 'p10', '/title'),
            renameRef(PRODUCTS, 'p10', 'p1'),
          ],
        },
      });
    });

    it('reads a renamed row whose meta also changed as renamed and modified', async () => {
      const draft = await givenCommittedProducts();
      await draft.renameRow(PRODUCTS, 'p1', 'p10');
      await draft.writeRowColumns(PRODUCTS, 'p10', {
        meta: { note: 'checked' },
      });

      const [item] = await readRowItems(draft);

      expect(item).toMatchObject({
        changeType: ChangeType.RenamedAndModified,
        fields: [],
        columns: [expect.objectContaining({ column: 'meta' })],
      });
    });

    it('reads a renamed row of a table whose structure changed as renamed, its rewritten schema hash going with the structure', async () => {
      const draft = await givenCommittedProducts();
      await draft.renameRow(PRODUCTS, 'p1', 'p10');
      await draft.updateTable(PRODUCTS, [
        replaceField('title', { ...str(), description: 'Shown in lists' }),
      ]);

      const [item] = await readRowItems(draft);

      expect(item).toMatchObject({
        rowId: 'p10',
        changeType: ChangeType.Renamed,
        columns: [
          expect.objectContaining({
            column: 'schemaHash',
            selection: expect.objectContaining({
              state: 'goesWith',
              reason: 'structureBound',
            }),
          }),
        ],
      });
    });

    it('gives both items of a replaced row its one replace unit, the deleted row first', async () => {
      const draft = await givenCommittedProducts();
      await draft.removeRow(PRODUCTS, 'p1');
      await draft.createRows(PRODUCTS, { p1: product('reused') });

      const page = await draft.readDraftRowChanges({ first: 10 });
      const replaced = {
        state: 'selectable',
        row: { rows: [{ tableId: PRODUCTS, rowId: 'p1' }] },
        units: [existenceRef('rowReplace', PRODUCTS, 'p1')],
      };

      expect(
        page.edges.map(({ node }) => [node.changeType, node.selection]),
      ).toEqual([
        [ChangeType.Removed, replaced],
        [ChangeType.Added, replaced],
      ]);
      expect(new Set(page.edges.map(({ cursor }) => cursor)).size).toBe(1);
    });

    it("addresses a deleted row whose id a rename took over with side 'head', before the rename", async () => {
      const draft = await givenCommittedProducts();
      await draft.removeRow(PRODUCTS, 'p1');
      await draft.renameRow(PRODUCTS, 'p2', 'p1');

      const items = await readRowItems(draft);

      expect(
        items.map(({ changeType, selection }) => [changeType, selection]),
      ).toEqual([
        [
          ChangeType.Removed,
          {
            state: 'selectable',
            row: { rows: [{ tableId: PRODUCTS, rowId: 'p1', side: 'head' }] },
            units: [headSideDeletionRef(PRODUCTS, 'p1')],
          },
        ],
        [
          ChangeType.Renamed,
          {
            state: 'selectable',
            row: { rows: [{ tableId: PRODUCTS, rowId: 'p1' }] },
            units: [renameRef(PRODUCTS, 'p1', 'p2')],
          },
        ],
      ]);
    });
  });

  describe('row columns', () => {
    it('reports a row whose only change is publishedAt, owned by the field unit of its published-at field', async () => {
      const draft = await givenCommittedArticle();
      await draft.updateRow(ARTICLES, 'a1', {
        title: 'one',
        releasedAt: RELEASE_DATE,
      });

      const [item] = await readRowItems(draft);
      const releasedAt = fieldRef(ARTICLES, 'a1', '/releasedAt');

      expect(item).toMatchObject({
        changeType: ChangeType.Modified,
        selection: { state: 'selectable', units: [releasedAt] },
        fields: [
          {
            path: '/releasedAt',
            selection: { state: 'unit', unit: releasedAt },
          },
        ],
        columns: [
          {
            column: 'publishedAt',
            oldValue: expect.any(Date),
            newValue: new Date(RELEASE_DATE),
            selection: { state: 'unit', unit: releasedAt },
          },
        ],
      });
    });

    it('reports a row whose only change is meta with its rowColumns unit', async () => {
      const draft = await givenCommittedProducts();
      await draft.writeRowColumns(PRODUCTS, 'p1', {
        meta: { note: 'checked' },
      });

      const [item] = await readRowItems(draft);
      const rowColumns = rowColumnsRef(PRODUCTS, 'p1', ['meta']);

      expect(item).toMatchObject({
        changeType: ChangeType.Modified,
        selection: { state: 'selectable', units: [rowColumns] },
        fields: [],
        columns: [
          {
            column: 'meta',
            oldValue: {},
            newValue: { note: 'checked' },
            selection: { state: 'unit', unit: rowColumns },
          },
        ],
      });
    });

    it('reports a row whose only change is schemaHash under an unchanged structure with its rowColumns unit', async () => {
      const draft = await givenCommittedProducts();
      await draft.writeRowColumns(PRODUCTS, 'p1', { schemaHash: 'other' });

      const [item] = await readRowItems(draft);
      const rowColumns = rowColumnsRef(PRODUCTS, 'p1', ['schemaHash']);

      expect(item).toMatchObject({
        selection: { state: 'selectable', units: [rowColumns] },
        fields: [],
        columns: [
          {
            column: 'schemaHash',
            oldValue: expect.any(String),
            newValue: 'other',
            selection: { state: 'unit', unit: rowColumns },
          },
        ],
      });
    });

    it('gives a publishedAt change whose published-at field the structure removed its rowColumns unit, beside the structure', async () => {
      const draft = await givenCommittedArticle();
      await draft.updateRow(ARTICLES, 'a1', {
        title: 'one',
        releasedAt: RELEASE_DATE,
      });
      await draft.updateTable(ARTICLES, [removeField('releasedAt')]);

      const [item] = await readRowItems(draft);
      const rowColumns = rowColumnsRef(ARTICLES, 'a1', ['publishedAt']);
      const goesWithStructure = expect.objectContaining({
        state: 'goesWith',
        unit: expect.objectContaining(structureRef(ARTICLES)),
        reason: 'structureBound',
      });

      expect(item).toMatchObject({
        selection: {
          state: 'selectable',
          units: [rowColumns],
          structure: structureRef(ARTICLES),
        },
        fields: [
          {
            path: '/releasedAt',
            changeType: RowChangeDetailType.FieldRemoved,
            selection: goesWithStructure,
          },
        ],
        columns: [
          {
            column: 'publishedAt',
            selection: { state: 'unit', unit: rowColumns },
          },
          { column: 'schemaHash', selection: goesWithStructure },
        ],
      });
    });
  });

  describe('refused tables', () => {
    it('refuses a row of a refused table, each of its fields and each of its columns', async () => {
      const draft = await givenUnledgeredProductsWithAnEditedRow();
      await draft.writeRowColumns(PRODUCTS, 'p1', {
        meta: { note: 'checked' },
      });

      const page = await draft.readDraftRowChanges({ first: 10 });
      const refused = { state: 'refused', code: 'unledgeredTable' };

      expect(page.refusedTables).toEqual([
        { tableId: PRODUCTS, code: 'unledgeredTable' },
      ]);
      expect(rowItemsOf([page])).toEqual([
        expect.objectContaining({
          selection: { ...refused, units: [] },
          fields: [
            expect.objectContaining({ path: '/title', selection: refused }),
          ],
          columns: [
            expect.objectContaining({ column: 'meta', selection: refused }),
          ],
        }),
      ]);
    });
  });

  describe('rows without units of their own', () => {
    it.each<{
      row: string;
      state: RowSelection['state'];
      given: () => Promise<ChangesScenario>;
    }>([
      {
        row: 'a row of a refused table',
        state: 'refused',
        given: givenUnledgeredProductsWithAnEditedRow,
      },
      {
        row: 'a row of a created table',
        state: 'goesWith',
        given: givenCreatedTagsWithARow,
      },
      {
        row: 'a row that differs only in an added field',
        state: 'goesWith',
        given: givenProductsWithAnAddedField,
      },
      {
        row: 'a row whose only stored difference is a formula output',
        state: 'computed',
        given: givenOrderWithOnlyItsFormulaOutputRewritten,
      },
    ])('gives $row an empty list of units', async ({ state, given }) => {
      const draft = await given();

      const [item] = await readRowItems(draft);

      expect(item?.selection).toMatchObject({ state, units: [] });
    });

    async function givenCreatedTagsWithARow(): Promise<ChangesScenario> {
      const draft = await givenCommittedProducts();
      await draft.createTable(TAGS, labelSchema);
      await draft.createRows(TAGS, { t1: { label: 'one' } });

      return draft;
    }

    async function givenProductsWithAnAddedField(): Promise<ChangesScenario> {
      const draft = await givenCommittedProducts();
      await draft.updateTable(PRODUCTS, [addField('color', str())]);

      return draft;
    }
  });

  describe('table data', () => {
    it('counts in the table data rows of each table the distinct row selectors of its selectable rows', async () => {
      const draft = await givenCommittedProducts();
      await draft.updateRow(PRODUCTS, 'p1', product('edited'));
      await draft.renameRow(PRODUCTS, 'p2', 'p20');
      await draft.updateRow(PRODUCTS, 'p20', product('edited'));
      await draft.removeRow(PRODUCTS, 'p3');
      await draft.createRows(PRODUCTS, { p3: product('reused') });

      const items = await readRowItems(draft);
      const [table] = (await draft.readDraftTableChanges({ first: 10 })).edges;
      const rowSelectors = new Set(
        items.flatMap(({ selection }) =>
          selection.state === 'selectable'
            ? [JSON.stringify(selection.row)]
            : [],
        ),
      );

      expect(rowSelectors.size).toBe(3);
      expect(table?.node.selection).toMatchObject({
        tableData: { rows: rowSelectors.size },
      });
      expect((await draft.readDraftChangesSummary()).rowsWithUnits).toBe(
        rowSelectors.size,
      );
    });
  });

  describe('native diff', () => {
    it.each(PAGE_SIZES)(
      'lists every row change of the native diff on pages of %p, with its change type and its field changes at JSON Pointers',
      async (first) => {
        const draft = await givenAMixedDraft();

        const items = rowItemsOf(await draft.readEveryDraftRowPage({ first }));
        const native = await draft.readNativeRowChanges();

        expect(items.map(nativeViewOfItem).sort(byRowId)).toEqual(
          native.map(nativeViewOfChange).sort(byRowId),
        );
      },
    );
  });

  describe('order and paging', () => {
    it('orders the rows by their table, then by row id in code points, the Head-only row first, and pages them like one large page', async () => {
      const draft = await givenAMixedDraft();
      const all = await draft.readDraftRowChanges({ first: 5_000 });

      for (const first of PAGE_SIZES) {
        const pages = await draft.readEveryDraftRowPage({ first });

        expect(rowItemsOf(pages)).toEqual(rowItemsOf([all]));
      }

      expect(rowItemsOf([all]).map(nameOf)).toEqual([
        'articles/a1 MODIFIED',
        'products/P0 ADDED',
        'products/p1 REMOVED',
        'products/p1 ADDED',
        'products/p10 RENAMED_AND_MODIFIED',
        'products/p3 MODIFIED',
        'tags/t1 ADDED',
      ]);
    });

    it('never splits the two items of one row id across pages', async () => {
      const draft = await givenCommittedProducts();
      await draft.removeRow(PRODUCTS, 'p1');
      await draft.createRows(PRODUCTS, { p1: product('reused') });
      await draft.updateRow(PRODUCTS, 'p2', product('edited', 2, ['a', 'b']));

      const first = await draft.readDraftRowChanges({ first: 1 });
      const second = await draft.readDraftRowChanges({
        first: 1,
        after: first.pageInfo.endCursor,
      });

      expect(rowItemsOf([first]).map(nameOf)).toEqual([
        'products/p1 REMOVED',
        'products/p1 ADDED',
      ]);
      expect(first.pageInfo.hasNextPage).toBe(true);
      expect(rowItemsOf([second]).map(nameOf)).toEqual([
        'products/p2 MODIFIED',
      ]);
      expect(second.pageInfo.hasNextPage).toBe(false);
    });

    it('says a next page follows when the page ends with the last row of a table and a later table has a row', async () => {
      const draft = await givenCommittedProducts();
      await draft.updateRow(PRODUCTS, 'p1', product('edited'));
      await draft.createTable(TAGS, labelSchema);
      await draft.createRows(TAGS, { t1: { label: 'one' } });

      const page = await draft.readDraftRowChanges({ first: 1 });

      expect(rowItemsOf([page]).map(nameOf)).toEqual(['products/p1 MODIFIED']);
      expect(page.pageInfo.hasNextPage).toBe(true);
    });

    it('says no next page follows when the later tables have no reported row', async () => {
      const draft = await givenCommittedProducts();
      await draft.updateRow(PRODUCTS, 'p1', product('edited'));
      await draft.createTable(TAGS, labelSchema);

      const page = await draft.readDraftRowChanges({ first: 1 });

      expect(rowItemsOf([page]).map(nameOf)).toEqual(['products/p1 MODIFIED']);
      expect(page.pageInfo.hasNextPage).toBe(false);
    });

    it('returns an empty page without a cursor or a total when nothing changed', async () => {
      const draft = await givenCommittedProducts();

      const page = await draft.readDraftRowChanges({ first: 10 });

      expect(page).toEqual({
        headRevisionId: await draft.revisionId('head'),
        draftRevisionId: await draft.revisionId('draft'),
        refusedTables: [],
        edges: [],
        pageInfo: { hasNextPage: false, endCursor: null },
      });
    });
  });

  describe('validation', () => {
    it.each<[string, Record<string, unknown>]>([
      ['first of 0', { first: 0 }],
      ['first of 5,001', { first: 5_001 }],
      ['first of 1.5', { first: 1.5 }],
      ['an offset cursor', { first: 10, after: '10' }],
      [
        'a cursor of the table read',
        { first: 10, after: cursorOf({ v: 1, tableId: 'a', headOnly: false }) },
      ],
      [
        'a cursor of another version',
        {
          first: 10,
          after: cursorOf({ v: 2, tableId: 'a', headOnly: false, rowId: 'r' }),
        },
      ],
      ['an after that is not a string', { first: 10, after: 1 }],
      [
        'a cursor whose row id holds the NUL character',
        {
          first: 10,
          after: cursorOf({
            v: 1,
            tableId: 'a',
            headOnly: false,
            rowId: 'r\u0000',
          }),
        },
      ],
    ])('refuses %s before reading the snapshot', async (_input, options) => {
      const draft = await givenCommittedProducts();
      const readSnapshot = jest.spyOn(kit.snapshotReader, 'readSnapshot');

      try {
        await expect(
          draft.readDraftRowChanges(options as { first: number }),
        ).rejects.toThrow(ListingValidationError);
        expect(readSnapshot).not.toHaveBeenCalled();
      } finally {
        readSnapshot.mockRestore();
      }
    });

    it('refuses a cursor of the row read in the table read', async () => {
      const draft = await givenCommittedProducts();
      await draft.updateRow(PRODUCTS, 'p1', product('edited'));
      const { pageInfo } = await draft.readDraftRowChanges({ first: 1 });

      await expect(
        draft.readDraftTableChanges({ first: 1, after: pageInfo.endCursor }),
      ).rejects.toThrow(ListingValidationError);
    });

    it('treats a null after as absent', async () => {
      const draft = await givenCommittedProducts();
      await draft.updateRow(PRODUCTS, 'p1', product('edited'));

      const page = await draft.readDraftRowChanges({ first: 10, after: null });

      expect(page).toEqual(await draft.readDraftRowChanges({ first: 10 }));
    });

    it('raises the native not-found error for an unknown branch', async () => {
      const draft = await givenCommittedProducts();

      await expect(
        kit.partialChangesApi.draftRowChanges({
          branch: { ...draft.branch, branchName: 'missing' },
          first: 10,
        }),
      ).rejects.toThrow(
        'A branch with this name does not exist in the project',
      );
    });
  });

  describe('snapshot and cost', () => {
    it('reads one snapshot in a read-only repeatable-read transaction', async () => {
      const draft = await givenCommittedProducts();
      await draft.updateRow(PRODUCTS, 'p1', product('edited'));

      const mode = await transactionModeOfSnapshotRead(kit, () =>
        draft.readDraftRowChanges({ first: 10 }),
      );

      expect(mode).toEqual({ readOnly: 'on', isolation: 'repeatable read' });
    });

    it('describes the snapshot of its row pairs when the Draft changes before it reads their versions', async () => {
      const draft = await givenCommittedProducts();
      await draft.updateRow(PRODUCTS, 'p1', product('edited'));
      await draft.renameRow(PRODUCTS, 'p2', 'p20');
      const before = await draft.readDraftRowChanges({ first: 10 });

      const page = await readRowPageWhileDraftChanges(
        kit,
        () => draft.readDraftRowChanges({ first: 10 }),
        async () => {
          await draft.updateRow(PRODUCTS, 'p1', product('edited again'));
          await draft.renameRow(PRODUCTS, 'p20', 'p21');
          await draft.removeRow(PRODUCTS, 'p3');
        },
      );

      expect(page).toEqual(before);
      expect(await draft.readDraftRowChanges({ first: 10 })).not.toEqual(
        before,
      );
    });

    it("reads the tables from the cursor's table on, and past a full page only those up to the first one with a row", async () => {
      const draft = await ChangesScenario.committed(kit, {
        [ARTICLES]: { schema: titleSchema, rows: { a1: { title: 'one' } } },
        [TAGS]: { schema: titleSchema, rows: { t1: { title: 'one' } } },
      });
      await draft.updateRow(ARTICLES, 'a1', { title: 'edited' });
      await draft.createTable(BOXES, titleSchema);
      await draft.createTable(ITEMS, titleSchema);
      await draft.createRows(ITEMS, { i1: { title: 'one' } });
      await draft.updateRow(TAGS, 't1', { title: 'edited' });
      const tables = await draft.linkSetsOf([ARTICLES, BOXES, ITEMS, TAGS]);

      const first = await draftReadQueriesDuring(kit, tables, () =>
        draft.readDraftRowChanges({ first: 1 }),
      );
      const second = await draftReadQueriesDuring(kit, tables, () =>
        draft.readDraftRowChanges({
          first: 1,
          after: first.result.pageInfo.endCursor,
        }),
      );
      const third = await draftReadQueriesDuring(kit, tables, () =>
        draft.readDraftRowChanges({
          first: 1,
          after: second.result.pageInfo.endCursor,
        }),
      );

      expect(rowItemsOf([first.result]).map(nameOf)).toEqual([
        'articles/a1 MODIFIED',
      ]);
      expect(first.result.pageInfo.hasNextPage).toBe(true);
      expect(first.linkSetReads).toEqual({
        [ARTICLES]: 1,
        [BOXES]: 1,
        [ITEMS]: 1,
        [TAGS]: 0,
      });
      expect(rowItemsOf([second.result]).map(nameOf)).toEqual([
        'items/i1 ADDED',
      ]);
      expect(second.result.pageInfo.hasNextPage).toBe(true);
      expect(second.linkSetReads).toEqual({
        [ARTICLES]: 1,
        [BOXES]: 1,
        [ITEMS]: 1,
        [TAGS]: 1,
      });
      expect(rowItemsOf([third.result]).map(nameOf)).toEqual([
        'tags/t1 MODIFIED',
      ]);
      expect(third.result.pageInfo.hasNextPage).toBe(false);
      expect(third.linkSetReads).toEqual({
        [ARTICLES]: 0,
        [BOXES]: 0,
        [ITEMS]: 1,
        [TAGS]: 1,
      });
    });

    it('describes the snapshot it listed when the Draft changes its rows and a schema before the first pair query', async () => {
      const draft = await givenCommittedProducts();
      await draft.updateRow(PRODUCTS, 'p1', product('edited'));
      const before = await draft.readDraftRowChanges({ first: 10 });

      const page = await readRowPageBeforeItsPairs(
        kit,
        () => draft.readDraftRowChanges({ first: 10 }),
        async () => {
          await draft.updateRow(PRODUCTS, 'p2', product('edited'));
          await draft.renameRow(PRODUCTS, 'p3', 'p30');
          await draft.updateTable(PRODUCTS, [addField('color', str())]);
        },
      );

      expect(page).toEqual(before);
      expect(await draft.readDraftRowChanges({ first: 10 })).not.toEqual(
        before,
      );
    });

    it('reads the row links of the tables until the page is full, and no native diff', async () => {
      const draft = await givenCommittedProducts();
      await draft.updateRow(PRODUCTS, 'p1', product('edited'));
      await draft.updateRow(PRODUCTS, 'p2', product('edited'));
      await draft.createTable(TAGS, labelSchema);
      await draft.createRows(TAGS, { t1: { label: 'one' } });

      const { result, linkSetReads, nativeDiffReads } =
        await draftReadQueriesDuring(
          kit,
          await draft.linkSetsOf([PRODUCTS, TAGS]),
          () => draft.readDraftRowChanges({ first: 1 }),
        );

      expect(rowItemsOf([result]).map(nameOf)).toEqual([
        'products/p1 MODIFIED',
      ]);
      expect(result.pageInfo.hasNextPage).toBe(true);
      expect(linkSetReads).toEqual({ [PRODUCTS]: 1, [TAGS]: 0 });
      expect(nativeDiffReads).toEqual([]);
    });
  });

  async function readRowItems(draft: ChangesScenario): Promise<DraftRowItem[]> {
    return rowItemsOf([await draft.readDraftRowChanges({ first: 100 })]);
  }

  function givenCommittedProducts(): Promise<ChangesScenario> {
    return ChangesScenario.committed(kit, {
      [PRODUCTS]: {
        schema: productSchema,
        rows: {
          p1: product('p1'),
          p2: product('p2', 2, ['a', 'b']),
          p3: product('p3'),
        },
      },
    });
  }

  function givenCommittedArticle(): Promise<ChangesScenario> {
    return ChangesScenario.committed(kit, {
      [ARTICLES]: {
        schema: articleSchema,
        rows: { a1: { title: 'one', releasedAt: '' } },
      },
    });
  }

  // Rows created, deleted, replaced, renamed and edited, and an edited published-at field, across three tables.
  async function givenAMixedDraft(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [ARTICLES]: {
        schema: articleSchema,
        rows: { a1: { title: 'one', releasedAt: '' } },
      },
      [PRODUCTS]: {
        schema: productSchema,
        rows: {
          p1: product('p1'),
          p2: product('p2', 2, ['a', 'b']),
          p3: product('p3'),
        },
      },
    });
    await draft.updateRow(ARTICLES, 'a1', {
      title: 'edited',
      releasedAt: RELEASE_DATE,
    });
    await draft.removeRow(PRODUCTS, 'p1');
    await draft.createRows(PRODUCTS, {
      p1: product('reused'),
      P0: product('upper'),
    });
    await draft.renameRow(PRODUCTS, 'p2', 'p10');
    await draft.updateRow(PRODUCTS, 'p10', product('p2', 2, ['a', 'c', 'd']));
    await draft.updateRow(PRODUCTS, 'p3', product('p3', 3));
    await draft.createTable(TAGS, labelSchema);
    await draft.createRows(TAGS, { t1: { label: 'one' } });

    return draft;
  }

  // Native writes store no null for a string, so the Draft's own row version is rewritten in place.
  async function rewriteDraftRowData(
    draft: ChangesScenario,
    tableId: string,
    rowId: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const row = await draft.row('draft', tableId, rowId);

    await kit.prisma.row.update({
      where: { versionId: row.versionId },
      data: { data: data as InputJsonValue, hash: objectHash(data) },
    });
  }

  async function givenOrderWithOnlyItsFormulaOutputRewritten(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [ORDERS]: {
        schema: orderSchema,
        rows: { o1: { price: 2, quantity: 3, total: 6 } },
      },
    });
    await draft.writeRowBelowNativeValidation(ORDERS, 'o1', {
      price: 2,
      quantity: 3,
      total: 7,
    });

    return draft;
  }

  async function givenUnledgeredProductsWithAnEditedRow(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [TAGS]: { schema: labelSchema },
    });
    await draft.createTable(PRODUCTS, titleSchema);
    await draft.createRows(PRODUCTS, { p1: { title: 'one' } });
    await draft.dropFromDraftLedger('init', PRODUCTS);
    await draft.commit();
    await draft.updateRow(PRODUCTS, 'p1', { title: 'edited' });

    return draft;
  }
});

interface IdsView {
  readonly tableId: string;
  readonly previousTableId?: string;
  readonly rowId: string;
  readonly previousRowId?: string;
  readonly changeType: ChangeType;
}

interface NativeRowView {
  readonly rowId: string;
  readonly changeType: ChangeType;
  readonly fields: readonly (readonly [string, string, unknown, unknown])[];
}

type FieldView = readonly [string, string, unknown];

function product(title: string, price = 1, tags: string[] = []) {
  return { title, price, tags };
}

function idsOf({
  tableId,
  previousTableId,
  rowId,
  previousRowId,
  changeType,
}: DraftRowItem): IdsView {
  return {
    tableId,
    ...(previousTableId === undefined ? {} : { previousTableId }),
    rowId,
    ...(previousRowId === undefined ? {} : { previousRowId }),
    changeType,
  };
}

function nameOf({ tableId, rowId, changeType }: DraftRowItem): string {
  return `${tableId}/${rowId} ${changeType}`;
}

function rowItemOf(
  items: readonly DraftRowItem[],
  rowId: string,
): DraftRowItem | undefined {
  return items.find((item) => item.rowId === rowId);
}

function fieldsByPath(item: DraftRowItem | undefined): DraftFieldChange[] {
  return [...(item?.fields ?? [])].sort((left, right) =>
    compareCodePoints(left.path, right.path),
  );
}

function fieldViewsOf(item: DraftRowItem | undefined): FieldView[] {
  return fieldsByPath(item).map(({ path, changeType, selection }) => [
    path,
    changeType,
    selection,
  ]);
}

function nativeViewOfItem({
  rowId,
  changeType,
  fields,
}: DraftRowItem): NativeRowView {
  return {
    rowId,
    changeType,
    fields: fields.map(
      ({ path, changeType: fieldChange, oldValue, newValue }) => [
        path,
        fieldChange,
        oldValue,
        newValue,
      ],
    ),
  };
}

function nativeViewOfChange(change: RowChange): NativeRowView {
  const row = change.row ?? change.fromRow;

  return {
    rowId: row?.id ?? '',
    changeType: change.changeType,
    fields: change.fieldChanges.map(
      ({ fieldPath, changeType, oldValue, newValue }) => [
        fieldPath === '' ? '' : `/${fieldPath.replaceAll('.', '/')}`,
        changeType,
        oldValue ?? null,
        newValue ?? null,
      ],
    ),
  };
}

function byRowId(left: NativeRowView, right: NativeRowView): number {
  return (
    compareCodePoints(left.rowId, right.rowId) ||
    compareCodePoints(left.changeType, right.changeType)
  );
}

function cursorOf(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}
