import { SystemSchemaIds } from '@revisium/schema-toolkit/consts';
import { num, numFormula, obj, ref, str } from '@revisium/schema-toolkit/mocks';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import type { ChangeOperation } from 'src/features/partial-changes/plan/change-operation';
import type { Selection } from 'src/features/partial-changes/selection/selection';
import type { JsonPatch } from '@revisium/schema-toolkit/types';
import type { InputJsonValue } from 'src/engine-prisma-types';
import {
  addField,
  moveField,
  removeField,
  replaceField,
} from 'src/features/share/ledger-replay/__tests__/support/ledger-steps';
import { ChangesScenario } from '../../__tests__/support/changes-scenario';
import { expectEveryDifferenceOwnedOnce } from '../../__tests__/support/column-ownership';
import {
  completeAsyncMigrationInPlace,
  recordLedgerRepair,
} from '../../__tests__/support/head-schema-damage';

const PRODUCTS = 'products';
const ORDERS = 'orders';
const DOCUMENTS = 'documents';

const productSchema = obj({ title: str(), price: num() });
const orderSchema = obj({
  price: num(),
  quantity: num(),
  total: numFormula('price * quantity'),
});
const documentSchema = obj({ title: str() });

const product = (rowId: string) => ({ tableId: PRODUCTS, rowId });
const order = (rowId: string) => ({ tableId: ORDERS, rowId });

describe('TargetAssembler: rows moving between structures', () => {
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

  it('commits a created row without its structure into the Head structure and defers its changed fields', async () => {
    const draft = await givenProductsWithAddedField();

    const target = await draft.assembleTarget('commit', {
      rows: [product('p3')],
    });

    expect(target.tableOf(PRODUCTS)).toMatchObject({
      outcome: 'mixed',
      version: 'head',
      rows: [
        { head: 'p2', target: 'head' },
        { draft: 'p3', target: 'merged' },
      ],
      removedLinks: [],
      addedLinks: [],
      newRows: [
        expect.objectContaining({
          id: 'p3',
          data: { title: 'three', price: 30 },
          schemaHash: (await draft.row('head', PRODUCTS, 'p1')).schemaHash,
        }),
      ],
    });
    expect(target.deferred).toEqual([
      {
        unit: { kind: 'rowCreate', tableId: PRODUCTS, rowId: 'p3' },
        paths: ['/color'],
        structure: { kind: 'structure', tableId: PRODUCTS },
      },
    ]);
  });

  it.each<{
    change: string;
    patches: JsonPatch[];
    created: InputJsonValue;
    paths: string[];
  }>([
    {
      change: 'a removed field',
      patches: [removeField('price')],
      created: { title: 'three' },
      paths: ['/price'],
    },
    {
      change: 'a renamed field',
      patches: [moveField('title', 'name')],
      created: { price: 30, name: 'three' },
      paths: ['/name', '/title'],
    },
  ])(
    'defers $change of a created row committed without its structure',
    async ({ patches, created, paths }) => {
      const draft = await givenProductsWithCreatedRowAfter(patches, created);

      const target = await draft.assembleTarget('commit', {
        rows: [product('p3')],
      });

      expect(target.deferred).toEqual([
        {
          unit: { kind: 'rowCreate', tableId: PRODUCTS, rowId: 'p3' },
          paths,
          structure: { kind: 'structure', tableId: PRODUCTS },
        },
      ]);
    },
  );

  it('defers no computed field of a created row committed without its structure', async () => {
    const draft = await givenProductsWithCreatedRowAfter(
      [addField('doubled', numFormula('price * 2'))],
      { title: 'three', price: 30, doubled: 0 },
    );

    const target = await draft.assembleTarget('commit', {
      rows: [product('p3')],
    });

    expect(target.deferred).toEqual([]);
  });

  it('defers nothing when a created row is committed with its structure', async () => {
    const draft = await givenProductsWithAddedField();

    const target = await draft.assembleTarget('commit', {
      tables: [PRODUCTS],
      rows: [product('p3')],
    });

    expect(target.deferred).toEqual([]);
    expect(target.tableOf(PRODUCTS)?.rows).toContainEqual({
      draft: 'p3',
      target: 'draft',
    });
  });

  it.each<{
    operation: ChangeOperation;
    selection: Selection;
    removedLinks: string[];
  }>([
    {
      operation: 'commit',
      selection: { tables: [PRODUCTS] },
      removedLinks: ['draft p3'],
    },
    {
      operation: 'revert',
      selection: { rows: [product('p2')] },
      removedLinks: [],
    },
  ])(
    'migrates a Head row into the Draft structure in a $operation',
    async ({ operation, selection, removedLinks }) => {
      const draft = await givenProductsWithAddedField();

      const target = await draft.assembleTarget(operation, selection);

      expect(target.tableOf(PRODUCTS)).toMatchObject({
        outcome: 'mixed',
        version: 'draft',
        removedLinks,
        addedLinks: [],
        newRows: [
          expect.objectContaining({
            id: 'p2',
            data: { title: 'two', price: 20, color: '' },
            schemaHash: (await draft.row('draft', PRODUCTS, 'p1')).schemaHash,
          }),
        ],
      });
      expect(target.deferred).toEqual([]);
    },
  );

  it.each<{
    operation: ChangeOperation;
    selection: Selection;
    moved: { id: string; data: Record<string, number> };
  }>([
    {
      operation: 'commit',
      selection: { rows: [order('o3')] },
      moved: { id: 'o3', data: { price: 4, quantity: 5, total: 20 } },
    },
    {
      operation: 'revert',
      selection: { rows: [order('o2')] },
      moved: { id: 'o2', data: { price: 2, quantity: 3, total: 60 } },
    },
  ])(
    'computes the formulas of a row moved in a $operation with the formulas of its target structure',
    async ({ operation, selection, moved }) => {
      const draft = await givenOrdersWithChangedFormula();

      const target = await draft.assembleTarget(operation, selection);

      expect(target.tableOf(ORDERS)?.newRows).toEqual([
        expect.objectContaining(moved),
      ]);
    },
  );

  it('migrates a restored Head row through a Draft history that renamed a field and then removed it', async () => {
    const draft = await givenProductsWhosePriceWasRenamedThenRemoved();

    const target = await draft.assembleTarget('revert', {
      rows: [product('p2')],
    });

    expect(target.tableOf(PRODUCTS)?.newRows).toEqual([
      expect.objectContaining({ id: 'p2', data: { title: 'two' } }),
    ]);
  });

  it('gives a Head row restored into a Draft structure with a new File field the file a native migration gives', async () => {
    const draft = await givenDocumentsWithAddedFile();
    const migrated = await draft.row('draft', DOCUMENTS, 'd1');

    const target = await draft.assembleTarget('revert', {
      rows: [{ tableId: DOCUMENTS, rowId: 'd2' }],
    });

    expect(target.tableOf(DOCUMENTS)?.newRows).toEqual([
      expect.objectContaining({
        id: 'd2',
        data: {
          title: 'second',
          image: {
            ...(migrated.data as { image: object }).image,
            fileId: expect.stringMatching(/.+/),
          },
        },
      }),
    ]);
  });

  it('commits exactly { all: true } on a repaired damaged table without migrating a Head row', async () => {
    const draft = await givenRepairedDamagedTable();

    const target = await draft.assembleTarget('commit', { all: true });

    expect(target.blockers).toEqual([]);
    expect(target.tableOf(PRODUCTS)).toMatchObject({
      outcome: 'base',
      version: 'draft',
    });
  });

  describe('a Draft structure that its history does not record', () => {
    it('blocks a commit that would migrate a Head row into it', async () => {
      const draft = await givenUnrecordedDraftStructure();
      await draft.removeRow(PRODUCTS, 'p2');

      const target = await draft.assembleTarget('commit', {
        tables: [PRODUCTS],
      });

      expect(target.blockers).toEqual([
        expect.objectContaining({
          code: 'unrecordedStructureChange',
          tableId: PRODUCTS,
        }),
      ]);
    });

    it('blocks a revert that would migrate a Head row into it', async () => {
      const draft = await givenUnrecordedDraftStructure();
      await draft.removeRow(PRODUCTS, 'p2');

      const target = await draft.assembleTarget('revert', {
        rows: [product('p2')],
      });

      expect(target.blockers).toEqual([
        expect.objectContaining({
          code: 'unrecordedStructureChange',
          tableId: PRODUCTS,
        }),
      ]);
    });
  });

  async function givenProductsWithAddedField(): Promise<ChangesScenario> {
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
    await draft.removeRow(PRODUCTS, 'p2');
    await draft.createRows(PRODUCTS, {
      p3: { title: 'three', price: 30, color: 'blue' },
    });
    expectEveryDifferenceOwnedOnce(await draft.readCatalogue([PRODUCTS]));

    return draft;
  }

  async function givenProductsWhosePriceWasRenamedThenRemoved(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [PRODUCTS]: {
        schema: productSchema,
        rows: {
          p1: { title: 'one', price: 10 },
          p2: { title: 'two', price: 20 },
        },
      },
    });
    await draft.updateTable(PRODUCTS, [moveField('price', 'cost')]);
    await draft.updateTable(PRODUCTS, [removeField('cost')]);
    await draft.removeRow(PRODUCTS, 'p2');

    return draft;
  }

  async function givenProductsWithCreatedRowAfter(
    patches: JsonPatch[],
    created: InputJsonValue,
  ): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [PRODUCTS]: {
        schema: productSchema,
        rows: { p1: { title: 'one', price: 10 } },
      },
    });
    await draft.updateTable(PRODUCTS, patches);
    await draft.createRows(PRODUCTS, { p3: created });
    expectEveryDifferenceOwnedOnce(await draft.readCatalogue([PRODUCTS]));

    return draft;
  }

  async function givenRepairedDamagedTable(): Promise<ChangesScenario> {
    const addColor = [addField('color', str())];
    const draft = await ChangesScenario.committed(kit, {
      [PRODUCTS]: {
        schema: productSchema,
        rows: { p1: { title: 'one', price: 10 } },
      },
    });
    await completeAsyncMigrationInPlace(kit, draft, PRODUCTS, addColor);
    await recordLedgerRepair(draft, PRODUCTS, addColor);
    expect(
      (await draft.readWholeDraftCatalogue()).structureOf(PRODUCTS),
    ).toMatchObject({ recorded: true });

    return draft;
  }

  async function givenOrdersWithChangedFormula(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [ORDERS]: {
        schema: orderSchema,
        rows: {
          o1: { price: 1, quantity: 1, total: 0 },
          o2: { price: 2, quantity: 3, total: 0 },
        },
      },
    });
    await draft.updateTable(ORDERS, [
      replaceField('total', numFormula('price * quantity * 10')),
    ]);
    await draft.removeRow(ORDERS, 'o2');
    await draft.createRows(ORDERS, {
      o3: { price: 4, quantity: 5, total: 0 },
    });
    expectEveryDifferenceOwnedOnce(await draft.readCatalogue([ORDERS]));

    return draft;
  }

  async function givenDocumentsWithAddedFile(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [DOCUMENTS]: {
        schema: documentSchema,
        rows: { d1: { title: 'first' }, d2: { title: 'second' } },
      },
    });
    await draft.updateTable(DOCUMENTS, [
      addField('image', ref(SystemSchemaIds.File)),
    ]);
    await draft.removeRow(DOCUMENTS, 'd2');

    return draft;
  }

  async function givenUnrecordedDraftStructure(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [PRODUCTS]: {
        schema: productSchema,
        rows: {
          p1: { title: 'one', price: 10 },
          p2: { title: 'two', price: 20 },
        },
      },
    });
    await draft.updateTable(PRODUCTS, [addField('weight', num())]);
    await completeAsyncMigrationInPlace(kit, draft, PRODUCTS, [
      addField('color', str()),
    ]);
    expect(
      (await draft.readCatalogue([PRODUCTS])).structureOf(PRODUCTS),
    ).toMatchObject({ recorded: false });

    return draft;
  }
});
