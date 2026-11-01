import { num, obj, str } from '@revisium/schema-toolkit/mocks';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import type { RevisionSide } from 'src/features/draft-revision/commands/impl/target-write-plan';
import type {
  ChangeOperation,
  TableOutcome,
} from 'src/features/partial-changes/assembly/outcome-rules';
import type { Selection } from 'src/features/partial-changes/selection/selection';
import { removeField } from 'src/features/share/ledger-replay/__tests__/support/ledger-steps';
import { SystemTables } from 'src/features/share/system-tables.consts';
import type { TableViewsData } from 'src/features/views/types';
import { ChangesScenario } from '../../__tests__/support/changes-scenario';

const PRODUCTS = 'products';
const GOODS = 'goods';
const LOGS = 'logs';
const ADDRESS = 'address';
const PHONE = 'phone';
const EMAIL = 'email';

const productSchema = obj({ code: str(), price: num() });
const logSchema = obj({ entry: str() });
const addressSchema = obj({ city: str() });
const editedAddressSchema = obj({ city: str(), street: str() });
const phoneSchema = obj({ number: str() });
const emailSchema = obj({ address: str() });

describe('SystemTargetAssembler: system rows of the target', () => {
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

  describe('views', () => {
    it('reverts a views unit to the Head views row and keeps the views edit of another table', async () => {
      const draft = await givenEditedViewsOfTwoTables();

      const target = await draft.assembleTarget('revert', {
        views: [PRODUCTS],
      });

      expect(target.systemTableOf(SystemTables.Views)).toEqual({
        outcome: 'mixed',
        version: 'draft',
        rows: ['views logs', 'views products'],
        removedLinks: ['draft views products'],
        addedLinks: ['head views products'],
        newRows: [],
        relinkCandidate: false,
      });
    });

    it('marks the views table a relink candidate when its last unit is reverted', async () => {
      const draft = await givenEditedViewsOfTwoTables();

      const target = await draft.assembleTarget('revert', {
        views: [PRODUCTS, LOGS],
      });

      expect(target.systemTableOf(SystemTables.Views)).toMatchObject({
        outcome: 'other',
        version: 'head',
        relinkCandidate: true,
      });
    });

    it('migrates the Head views with a committed structure while a views edit stays in the Draft', async () => {
      const draft = await givenCommittedProductsWithViews();
      await draft.updateTable(PRODUCTS, [removeField('price')]);
      const migratedViews = await draftViewsOf(draft, PRODUCTS);
      await draft.updateViews(PRODUCTS, tableViews('Renamed', ['code']));

      const target = await draft.assembleTarget('commit', {
        tables: [PRODUCTS],
      });

      expect(target.systemTableOf(SystemTables.Views)).toMatchObject({
        outcome: 'mixed',
        version: 'head',
        removedLinks: ['head views products'],
        addedLinks: [],
        newRows: [
          expect.objectContaining({ id: PRODUCTS, data: migratedViews }),
        ],
      });
    });

    it('keeps the views edit of a renamed table under its Head id when the rename is reverted', async () => {
      const draft = await givenCommittedProductsWithViews();
      await draft.renameTable(PRODUCTS, GOODS);
      await draft.updateViews(GOODS, tableViews('Renamed', ['code']));

      const target = await draft.assembleTarget('revert', {
        tables: [GOODS],
      });

      expect(target.systemTableOf(SystemTables.Views)).toMatchObject({
        outcome: 'mixed',
        version: 'draft',
        removedLinks: ['draft views goods'],
        addedLinks: [],
        newRows: [
          expect.objectContaining({
            id: PRODUCTS,
            data: tableViews('Renamed', ['code']),
          }),
        ],
      });
    });

    it.each<{
      operation: ChangeOperation;
      selection: Selection;
      tableVersion: RevisionSide;
      views: { outcome: TableOutcome; version: RevisionSide };
    }>([
      {
        operation: 'commit',
        selection: { all: true },
        tableVersion: 'draft',
        views: { outcome: 'other', version: 'draft' },
      },
      {
        operation: 'commit',
        selection: { tableData: [PRODUCTS] },
        tableVersion: 'draft',
        views: { outcome: 'base', version: 'head' },
      },
      {
        operation: 'revert',
        selection: { all: true },
        tableVersion: 'head',
        views: { outcome: 'other', version: 'head' },
      },
      {
        operation: 'revert',
        selection: { tableData: [PRODUCTS] },
        tableVersion: 'head',
        views: { outcome: 'base', version: 'draft' },
      },
    ])(
      'keeps the base structure side of a table without structure or views units and takes its views from the $views.version in a $operation of $selection',
      async ({ operation, selection, tableVersion, views }) => {
        const draft = await givenContentEqualViewsNextToEditedRow();

        const target = await draft.assembleTarget(operation, selection);

        expect(target.tableOf(PRODUCTS)).toMatchObject({
          outcome: 'other',
          version: tableVersion,
        });
        expect(target.systemTableOf(SystemTables.Views)).toMatchObject(views);
      },
    );
  });

  describe('rows without units', () => {
    it.each(Object.values(SystemTables))(
      'links the Draft version of %s when a commit applies exactly { all: true }, as native does',
      async (tableId) => {
        const draft = await givenEditedSystemTables();

        const target = await draft.assembleTarget('commit', { all: true });

        expect(target.systemTableOf(tableId)).toMatchObject({
          outcome: 'other',
          version: 'draft',
          relinkCandidate: true,
        });
      },
    );

    it('keeps the Head version of a shared schema whose Draft copy is content-equal in a partial commit', async () => {
      const draft = await givenEditedSystemTables();

      const target = await draft.assembleTarget('commit', {
        views: [PRODUCTS],
      });

      expect(target.systemTableOf(SystemTables.SharedSchemas)).toMatchObject({
        outcome: 'base',
        version: 'head',
      });
    });
  });

  describe('a system table on one side only', () => {
    it('links the empty shared-schema table the Draft alone holds into Head in a commit of exactly { all: true }, as native commit keeps it', async () => {
      const draft = await givenEmptySharedSchemaTableInDraft();

      const target = await draft.assembleTarget('commit', { all: true });

      expect(target.systemTableOf(SystemTables.SharedSchemas)).toEqual({
        outcome: 'base',
        version: 'draft',
        rows: [],
        removedLinks: [],
        addedLinks: [],
        newRows: [],
        relinkCandidate: true,
      });
    });

    it.each<{ operation: ChangeOperation; selection: Selection }>([
      { operation: 'revert', selection: { all: true } },
      {
        operation: 'commit',
        selection: {
          fields: [{ tableId: PRODUCTS, rowId: 'p1', path: '/code' }],
        },
      },
    ])(
      'plans no empty shared-schema table the Draft alone holds in a $operation of $selection',
      async ({ operation, selection }) => {
        const draft = await givenEmptySharedSchemaTableInDraft();

        const target = await draft.assembleTarget(operation, selection);

        expect(target.systemTableOf(SystemTables.SharedSchemas)).toMatchObject({
          outcome: 'absent',
          version: undefined,
          rows: [],
        });
      },
    );

    it('plans no views table in a revert of exactly { all: true }, as native revert leaves none', async () => {
      const draft = await givenViewsTableCreatedInDraft();

      const target = await draft.assembleTarget('revert', { all: true });
      await draft.revertNatively();

      expect(target.systemTableOf(SystemTables.Views)).toEqual({
        outcome: 'absent',
        rows: [],
        removedLinks: [],
        addedLinks: [],
        newRows: [],
        relinkCandidate: true,
      });
      expect(await draft.hasTable('draft', SystemTables.Views)).toBe(false);
    });

    it.each<{
      operation: ChangeOperation;
      units: string;
      selection: Selection;
    }>([
      {
        operation: 'revert',
        units: 'its views unit',
        selection: { views: [PRODUCTS] },
      },
      {
        operation: 'commit',
        units: 'another unit',
        selection: {
          fields: [{ tableId: PRODUCTS, rowId: 'p1', path: '/code' }],
        },
      },
    ])(
      'plans no views table when a $operation of $units leaves no row on the views table the Draft alone holds',
      async ({ operation, selection }) => {
        const draft = await givenViewsTableCreatedInDraft();

        const target = await draft.assembleTarget(operation, selection);

        expect(target.systemTableOf(SystemTables.Views)).toMatchObject({
          outcome: 'absent',
          version: undefined,
          rows: [],
          removedLinks: [],
          addedLinks: [],
          newRows: [],
        });
      },
    );
  });

  describe('shared schemas', () => {
    it('reverts a shared schema and keeps the other shared schema changes', async () => {
      const draft = await givenCommittedSharedSchemas();
      await draft.updateSharedSchema(ADDRESS, editedAddressSchema);
      await draft.createSharedSchema(EMAIL, emailSchema);

      const target = await draft.assembleTarget('revert', {
        sharedSchemas: [ADDRESS],
      });

      expect(target.systemTableOf(SystemTables.SharedSchemas)).toEqual({
        outcome: 'mixed',
        version: 'draft',
        rows: [
          'sharedSchema address',
          'sharedSchema email',
          'sharedSchema phone',
        ],
        removedLinks: ['draft sharedSchema address'],
        addedLinks: ['head sharedSchema address'],
        newRows: [],
        relinkCandidate: false,
      });
    });

    it('commits a created shared schema alone', async () => {
      const draft = await givenCommittedSharedSchemas();
      await draft.updateSharedSchema(ADDRESS, editedAddressSchema);
      await draft.createSharedSchema(EMAIL, emailSchema);

      const target = await draft.assembleTarget('commit', {
        sharedSchemas: [EMAIL],
      });

      expect(target.systemTableOf(SystemTables.SharedSchemas)).toMatchObject({
        outcome: 'mixed',
        version: 'head',
        removedLinks: [],
        addedLinks: ['draft sharedSchema email'],
      });
    });
  });

  async function givenViewsTableCreatedInDraft(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [PRODUCTS]: {
        schema: productSchema,
        rows: { p1: { code: 'one', price: 1 } },
      },
    });
    expect(await draft.hasTable('head', SystemTables.Views)).toBe(false);
    await draft.updateRow(PRODUCTS, 'p1', { code: 'uno', price: 1 });
    await draft.updateViews(PRODUCTS, tableViews('All', ['code']));

    return draft;
  }

  async function givenEmptySharedSchemaTableInDraft(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [PRODUCTS]: {
        schema: productSchema,
        rows: { p1: { code: 'one', price: 1 } },
      },
    });
    expect(await draft.hasTable('head', SystemTables.SharedSchemas)).toBe(
      false,
    );
    await draft.createSharedSchema(ADDRESS, addressSchema);
    await draft.removeSharedSchema(ADDRESS);
    await draft.updateRow(PRODUCTS, 'p1', { code: 'uno', price: 1 });

    return draft;
  }

  async function givenEditedViewsOfTwoTables(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [PRODUCTS]: { schema: productSchema },
      [LOGS]: { schema: logSchema },
    });
    await draft.updateViews(PRODUCTS, tableViews('All', ['code']));
    await draft.updateViews(LOGS, tableViews('All', ['entry']));
    await draft.commit();
    await draft.updateViews(PRODUCTS, tableViews('Renamed', ['code']));
    await draft.updateViews(LOGS, tableViews('Renamed', ['entry']));

    return draft;
  }

  async function givenEditedSystemTables(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [PRODUCTS]: { schema: productSchema },
      [LOGS]: { schema: logSchema },
    });
    await draft.updateViews(PRODUCTS, tableViews('All', ['code']));
    await draft.createSharedSchema(ADDRESS, addressSchema);
    await draft.commit();
    await draft.updateViews(PRODUCTS, tableViews('Renamed', ['code']));
    await draft.updateTable(LOGS, [removeField('entry')]);
    await draft.updateSharedSchema(ADDRESS, editedAddressSchema);
    await draft.updateSharedSchema(ADDRESS, addressSchema);

    return draft;
  }

  async function givenCommittedProductsWithViews(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [PRODUCTS]: {
        schema: productSchema,
        rows: { p1: { code: 'one', price: 1 } },
      },
    });
    await draft.updateViews(PRODUCTS, tableViews('All', ['code', 'price']));
    await draft.commit();

    return draft;
  }

  async function givenContentEqualViewsNextToEditedRow(): Promise<ChangesScenario> {
    const draft = await givenCommittedProductsWithViews();
    await draft.updateViews(PRODUCTS, tableViews('Renamed', ['code']));
    await draft.updateViews(PRODUCTS, tableViews('All', ['code', 'price']));
    await draft.updateRow(PRODUCTS, 'p1', { code: 'uno', price: 1 });

    return draft;
  }

  async function givenCommittedSharedSchemas(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [PRODUCTS]: { schema: productSchema },
    });
    await draft.createSharedSchema(ADDRESS, addressSchema);
    await draft.createSharedSchema(PHONE, phoneSchema);
    await draft.commit();

    return draft;
  }

  async function draftViewsOf(
    draft: ChangesScenario,
    tableId: string,
  ): Promise<unknown> {
    const row = await draft.row('draft', SystemTables.Views, tableId);

    return row.data;
  }
});

function tableViews(name: string, fields: string[]): TableViewsData {
  return {
    version: 1,
    defaultViewId: 'default',
    views: [
      {
        id: 'default',
        name,
        columns: fields.map((field) => ({ field: `data.${field}` })),
      },
    ],
  };
}
