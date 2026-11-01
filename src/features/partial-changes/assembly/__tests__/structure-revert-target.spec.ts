import { num, obj, str } from '@revisium/schema-toolkit/mocks';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import {
  addField,
  moveField,
} from 'src/features/share/ledger-replay/__tests__/support/ledger-steps';
import {
  ChangesScenario,
  type TableFixture,
} from '../../__tests__/support/changes-scenario';
import { expectEveryDifferenceOwnedOnce } from '../../__tests__/support/column-ownership';
import { completeAsyncMigrationInPlace } from '../../__tests__/support/head-schema-damage';

const PRODUCTS = 'products';
const LOGS = 'logs';
const TAGS = 'tags';
const GOODS = 'goods';
const ALPHA = 'alpha';
const BETA = 'beta';
const GAMMA = 'gamma';
const DRAFTS = 'drafts';

const productSchema = obj({ title: str(), price: num() });
const logSchema = obj({ entry: str() });
const tagSchema = obj({ label: str() });

const products: TableFixture = {
  schema: productSchema,
  rows: { p1: { title: 'one', price: 10 }, p2: { title: 'two', price: 20 } },
};
const logs: TableFixture = {
  schema: logSchema,
  rows: { l1: { entry: 'started' } },
};
const tags: TableFixture = {
  schema: tagSchema,
  rows: { t1: { label: 'old' } },
};

describe('TargetAssembler: reverting structure units', () => {
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

  describe('rows of a table whose structure is reverted', () => {
    it('maps the remaining Draft rows of a field added and filled back to the Head structure', async () => {
      const draft = await givenProductsWithAddedField();

      const target = await draft.assembleTarget('revert', {
        tables: [PRODUCTS],
      });

      expect(target.tableOf(PRODUCTS)).toEqual({
        outcome: 'mixed',
        version: 'head',
        rows: [
          { head: 'p1', draft: 'p1', target: 'merged' },
          { draft: 'p3', target: 'merged' },
        ],
        removedLinks: ['head p1'],
        addedLinks: [],
        newRows: [
          expect.objectContaining({
            id: 'p1',
            data: { title: 'uno', price: 10 },
          }),
          expect.objectContaining({
            id: 'p3',
            data: { title: 'three', price: 30 },
          }),
        ],
        relinkCandidate: false,
      });
    });

    it('takes the Head values of a renamed field and keeps an edit of an unchanged field', async () => {
      const draft = await givenProductsWithRenamedField();

      const target = await draft.assembleTarget('revert', {
        tables: [PRODUCTS],
      });

      expect(target.tableOf(PRODUCTS)).toMatchObject({
        outcome: 'mixed',
        version: 'head',
        removedLinks: ['head p1'],
        addedLinks: [],
        newRows: [
          expect.objectContaining({
            id: 'p1',
            data: { title: 'one', price: 11 },
          }),
        ],
      });
    });

    it.each<{
      change: string;
      given: () => Promise<ChangesScenario>;
      tableId: string;
      plan: {
        outcome: string;
        version?: 'head';
        relinkCandidate: boolean;
      };
    }>([
      {
        change: 'a created table',
        given: () => givenTagsCreated(),
        tableId: TAGS,
        plan: { outcome: 'absent', relinkCandidate: false },
      },
      {
        change: 'a removed table',
        given: () => givenTagsRemoved(),
        tableId: TAGS,
        plan: { outcome: 'present', version: 'head', relinkCandidate: false },
      },
      {
        change: 'a renamed table',
        given: () => givenProductsRenamed(),
        tableId: GOODS,
        plan: { outcome: 'base', version: 'head', relinkCandidate: true },
      },
    ])(
      'plans $change with its Head existence',
      async ({ given, tableId, plan }) => {
        const draft = await given();

        const target = await draft.assembleTarget('revert', {
          tables: [tableId],
        });

        expect(target.tableOf(tableId)).toEqual({
          ...plan,
          rows: [],
          removedLinks: [],
          addedLinks: [],
          newRows: [],
        });
      },
    );

    it('links the Head versions of two swapped tables', async () => {
      const draft = await givenSwappedTables();

      const target = await draft.assembleTarget('revert', {
        tables: [ALPHA, BETA],
      });

      for (const tableId of [ALPHA, BETA]) {
        expect(target.tableOf(tableId)).toMatchObject({
          outcome: 'base',
          version: 'head',
        });
      }
    });

    it('plans no table for a table created and removed inside the Draft', async () => {
      const draft = await givenTransientTable();

      const target = await draft.assembleTarget('revert', {
        tables: [DRAFTS],
      });

      expect(target.tableIds).toEqual([]);
    });

    it('leaves the tables of other kept units out of the plan', async () => {
      const draft = await givenProductsWithAddedField();

      const target = await draft.assembleTarget('revert', {
        tables: [PRODUCTS],
      });

      expect(target.tableIds).toEqual([PRODUCTS]);
    });
  });

  describe('a Draft structure that its history does not record', () => {
    it('allows the revert of the structure and maps its rows to the Head structure', async () => {
      const draft = await givenUnrecordedDraftStructure();

      const target = await draft.assembleTarget('revert', {
        tables: [PRODUCTS],
      });

      expect(target.blockers).toEqual([]);
      expect(target.tableOf(PRODUCTS)).toMatchObject({
        outcome: 'base',
        version: 'head',
      });
    });
  });

  async function givenCommitted(
    tables: Readonly<Record<string, TableFixture>>,
  ): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [LOGS]: logs,
      ...tables,
    });
    await draft.updateTable(LOGS, [addField('level', str())]);

    return draft;
  }

  async function givenProductsWithAddedField(): Promise<ChangesScenario> {
    const draft = await givenCommitted({ [PRODUCTS]: products });
    await draft.updateTable(PRODUCTS, [addField('color', str())]);
    await draft.updateRow(PRODUCTS, 'p1', {
      title: 'uno',
      price: 10,
      color: 'red',
    });
    await draft.createRows(PRODUCTS, {
      p3: { title: 'three', price: 30, color: 'blue' },
    });
    expectEveryDifferenceOwnedOnce(await draft.readCatalogue([PRODUCTS]));

    return draft;
  }

  async function givenProductsWithRenamedField(): Promise<ChangesScenario> {
    const draft = await givenCommitted({ [PRODUCTS]: products });
    await draft.updateTable(PRODUCTS, [moveField('title', 'name')]);
    await draft.updateRow(PRODUCTS, 'p1', { name: 'one', price: 11 });
    expectEveryDifferenceOwnedOnce(await draft.readCatalogue([PRODUCTS]));

    return draft;
  }

  async function givenTagsCreated(): Promise<ChangesScenario> {
    const draft = await givenCommitted({});
    await draft.createTable(TAGS, tagSchema);
    await draft.createRows(TAGS, { t1: { label: 'new' } });

    return draft;
  }

  async function givenTagsRemoved(): Promise<ChangesScenario> {
    const draft = await givenCommitted({ [TAGS]: tags });
    await draft.removeTable(TAGS);

    return draft;
  }

  async function givenProductsRenamed(): Promise<ChangesScenario> {
    const draft = await givenCommitted({ [PRODUCTS]: products });
    await draft.renameTable(PRODUCTS, GOODS);

    return draft;
  }

  async function givenSwappedTables(): Promise<ChangesScenario> {
    const draft = await givenCommitted({ [ALPHA]: tags, [BETA]: tags });
    await draft.renameTable(ALPHA, GAMMA);
    await draft.renameTable(BETA, ALPHA);
    await draft.renameTable(GAMMA, BETA);

    return draft;
  }

  async function givenTransientTable(): Promise<ChangesScenario> {
    const draft = await givenCommitted({});
    await draft.createTable(DRAFTS, tagSchema);
    await draft.removeTable(DRAFTS);

    return draft;
  }

  async function givenUnrecordedDraftStructure(): Promise<ChangesScenario> {
    const draft = await givenCommitted({ [PRODUCTS]: products });
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
