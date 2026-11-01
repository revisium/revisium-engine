import { num, obj, str } from '@revisium/schema-toolkit/mocks';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import type { ChangeOperation } from 'src/features/partial-changes/assembly/outcome-rules';
import type { FieldRef } from 'src/features/partial-changes/selection/selection';
import { addField } from 'src/features/share/ledger-replay/__tests__/support/ledger-steps';
import { ChangesScenario } from '../../__tests__/support/changes-scenario';
import { expectEveryDifferenceOwnedOnce } from '../../__tests__/support/column-ownership';

const CATEGORIES = 'categories';
const PRODUCTS = 'products';
const LOGS = 'logs';

const categorySchema = obj({ title: str() });
const productSchema = obj({
  title: str(),
  price: num(),
  category: str({ foreignKey: CATEGORIES }),
});
const logSchema = obj({ entry: str() });

const titleOfC1: FieldRef = {
  tableId: CATEGORIES,
  rowId: 'c1',
  path: '/title',
};

describe('TargetAssembler: table outcomes in tables of one structure', () => {
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

  it.each<{ operation: ChangeOperation; version: 'head' | 'draft' }>([
    { operation: 'commit', version: 'draft' },
    { operation: 'revert', version: 'head' },
  ])(
    'links the $version version of a table whose every unit a $operation applies',
    async ({ operation, version }) => {
      const draft = await givenEditedCatalog();

      const target = await draft.assembleTarget(operation, {
        tableData: [PRODUCTS],
      });

      expect(target.tableOf(PRODUCTS)).toMatchObject({
        outcome: 'other',
        version,
        removedLinks: [],
        addedLinks: [],
        newRows: [],
        relinkCandidate: true,
      });
    },
  );

  it.each<{
    operation: ChangeOperation;
    version: 'head' | 'draft';
    removedLinks: string[];
    addedLinks: string[];
    mergedTitle: string;
  }>([
    {
      operation: 'commit',
      version: 'head',
      removedLinks: ['head p1', 'head p2'],
      addedLinks: ['draft p3'],
      mergedTitle: 'uno',
    },
    {
      operation: 'revert',
      version: 'draft',
      removedLinks: ['draft p1', 'draft p3'],
      addedLinks: ['head p2'],
      mergedTitle: 'one',
    },
  ])(
    'plans a mixed table as the $version version with link changes in a $operation',
    async ({ operation, version, removedLinks, addedLinks, mergedTitle }) => {
      const draft = await givenEditedCatalog();

      const target = await draft.assembleTarget(operation, {
        fields: [{ tableId: PRODUCTS, rowId: 'p1', path: '/title' }],
        rows: [
          { tableId: PRODUCTS, rowId: 'p2' },
          { tableId: PRODUCTS, rowId: 'p3' },
        ],
      });

      expect(target.tableOf(PRODUCTS)).toMatchObject({
        outcome: 'mixed',
        version,
        removedLinks,
        addedLinks,
        newRows: [
          expect.objectContaining({
            id: 'p1',
            data: expect.objectContaining({ title: mergedTitle }),
          }),
        ],
        relinkCandidate: false,
      });
    },
  );

  it.each<{ operation: ChangeOperation; version: 'head' | 'draft' }>([
    { operation: 'commit', version: 'head' },
    { operation: 'revert', version: 'draft' },
  ])(
    'keeps the $version version of a table whose units a $operation leaves',
    async ({ operation, version }) => {
      const draft = await givenEditedCatalog();

      const target = await draft.assembleTarget(operation, {
        fields: [titleOfC1],
      });

      expect(target.tableOf(PRODUCTS)).toMatchObject({
        outcome: 'base',
        version,
        removedLinks: [],
        addedLinks: [],
        newRows: [],
        relinkCandidate: false,
      });
    },
  );

  it('marks a read table whose only Draft difference is a content-equal row version as a relink candidate', async () => {
    const draft = await givenEditedCatalog();
    await givenContentEqualCategory(draft);

    const target = await draft.assembleTarget('commit', {
      tableData: [PRODUCTS],
    });

    expect(target.tableOf(CATEGORIES)).toEqual({
      outcome: 'unchanged',
      version: 'head',
      rows: [],
      removedLinks: [],
      addedLinks: [],
      newRows: [],
      relinkCandidate: true,
    });
  });

  it('leaves an unread table out of the plan', async () => {
    const draft = await givenEditedCatalog();

    const target = await draft.assembleTarget('commit', {
      fields: [titleOfC1],
    });

    expect(target.tableIds).toEqual([CATEGORIES, PRODUCTS]);
  });

  it.each<{ operation: ChangeOperation }>([
    { operation: 'commit' },
    { operation: 'revert' },
  ])(
    'refuses an applied structure unit in a $operation',
    async ({ operation }) => {
      const draft = await givenEditedCatalog();
      await draft.updateTable(LOGS, [addField('level', str())]);

      await expect(
        draft.assembleTarget(operation, { tables: [LOGS] }),
      ).rejects.toThrow(/structure/);
    },
  );

  async function givenEditedCatalog(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [CATEGORIES]: {
        schema: categorySchema,
        rows: { c1: { title: 'books' } },
      },
      [PRODUCTS]: {
        schema: productSchema,
        rows: {
          p1: { title: 'one', price: 10, category: 'c1' },
          p2: { title: 'two', price: 20, category: 'c1' },
          p4: { title: 'four', price: 40, category: 'c1' },
        },
      },
      [LOGS]: { schema: logSchema, rows: { l1: { entry: 'started' } } },
    });
    await draft.updateRow(CATEGORIES, 'c1', { title: 'novels' });
    await draft.updateRow(PRODUCTS, 'p1', {
      title: 'uno',
      price: 11,
      category: 'c1',
    });
    await draft.removeRow(PRODUCTS, 'p2');
    await draft.createRows(PRODUCTS, {
      p3: { title: 'three', price: 30, category: 'c1' },
    });
    await draft.updateRow(PRODUCTS, 'p4', {
      title: 'four',
      price: 41,
      category: 'c1',
    });
    await draft.updateRow(PRODUCTS, 'p4', {
      title: 'four',
      price: 40,
      category: 'c1',
    });
    await draft.updateRow(LOGS, 'l1', { entry: 'finished' });
    expectEveryDifferenceOwnedOnce(
      await draft.readCatalogue([CATEGORIES, PRODUCTS, LOGS]),
    );

    return draft;
  }

  async function givenContentEqualCategory(
    draft: ChangesScenario,
  ): Promise<void> {
    await draft.updateRow(CATEGORIES, 'c1', { title: 'books' });
  }
});
