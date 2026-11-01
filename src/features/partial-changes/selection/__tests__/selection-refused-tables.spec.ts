import { num, obj, str } from '@revisium/schema-toolkit/mocks';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import type { RefusedTable } from 'src/features/partial-changes/head-schema/head-schema-check';
import type { Selection } from 'src/features/partial-changes/selection/selection';
import { addField } from 'src/features/share/ledger-replay/__tests__/support/ledger-steps';
import type { AddressedUnit } from '../../__tests__/support/catalogue-reading';
import {
  ChangesScenario,
  type TableFixture,
} from '../../__tests__/support/changes-scenario';
import { completeAsyncMigrationInPlace } from '../../__tests__/support/head-schema-damage';
import type { BlockerView } from '../../__tests__/support/selection-resolving';

const CATEGORIES = 'categories';
const PRODUCTS = 'products';
const GOODS = 'goods';
const ARCHIVE = 'archive';

const categories: TableFixture = {
  schema: obj({ title: str() }),
  rows: { c1: { title: 'first' } },
};
const productSchema = obj({ code: str() });
const productRows = { p1: { code: 'one' } };
const goodSchema = obj({ price: num() });
const addColor = [addField('color', str())];
const damagedMessage =
  'products is refused: its Head schema does not match its Head ledger';

const categoryEdit: AddressedUnit = {
  kind: 'field',
  tableId: CATEGORIES,
  rowId: 'c1',
  path: '/title',
};
const productRename: AddressedUnit = {
  kind: 'rowRename',
  tableId: PRODUCTS,
  rowId: 'p9',
  previousRowId: 'p1',
};

interface RefusalCase {
  readonly damage: string;
  readonly given: () => Promise<ChangesScenario>;
  readonly refusal: RefusedTable;
  readonly message: string;
}

describe('SelectionResolver: refused tables', () => {
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

  const refusalCases: RefusalCase[] = [
    {
      damage: 'an async migration completed in place',
      given: givenProductsMigratedInPlace,
      refusal: { tableId: PRODUCTS, code: 'headSchemaInconsistent' },
      message: damagedMessage,
    },
    {
      damage: 'a Head ledger without the init of the table',
      given: givenProductsWithoutInit,
      refusal: { tableId: PRODUCTS, code: 'unledgeredTable' },
      message: 'products is refused: it has no intact ledger lineage',
    },
  ];

  it.each(refusalCases)(
    'blocks a selector of the table left by $damage with its code instead of reporting it unmatched',
    async ({ given, refusal, message }) => {
      const draft = await given();

      const resolution = await draft.resolveSelection({
        renames: [{ tableId: PRODUCTS, rowId: 'p9' }],
        fields: [{ tableId: CATEGORIES, rowId: 'c1', path: '/title' }],
      });

      expect(resolution.selected).toEqual([categoryEdit]);
      expect(resolution.blockers).toEqual([refusalBlocker(refusal, message)]);
      expect(resolution.unmatched).toEqual({});
    },
  );

  it.each(refusalCases)(
    'blocks an excluded selector of the table left by $damage',
    async ({ given, refusal, message }) => {
      const draft = await given();

      const resolution = await draft.resolveSelection({
        fields: [{ tableId: CATEGORIES, rowId: 'c1', path: '/title' }],
        exclude: { tableData: [PRODUCTS] },
      });

      expect(resolution.blockers).toEqual([refusalBlocker(refusal, message)]);
      expect(resolution.unmatched).toEqual({});
    },
  );

  it.each(refusalCases)(
    'blocks all: true with an exclusion by the table left by $damage',
    async ({ given, refusal, message }) => {
      const draft = await given();

      const resolution = await draft.resolveSelection({
        all: true,
        exclude: {
          fields: [{ tableId: CATEGORIES, rowId: 'c1', path: '/title' }],
        },
      });

      expect(resolution.blockers).toEqual([refusalBlocker(refusal, message)]);
    },
  );

  it.each(
    refusalCases.flatMap((refusalCase) => [
      {
        ...refusalCase,
        addition: 'an empty exclusion',
        selection: { all: true, exclude: {} } as Selection,
      },
      {
        ...refusalCase,
        addition: 'an empty inclusion array',
        selection: { all: true, rows: [] } as Selection,
      },
    ]),
  )(
    'blocks all: true with $addition by the table left by $damage',
    async ({ given, refusal, message, selection }) => {
      const draft = await given();

      const resolution = await draft.resolveSelection(selection);

      expect(resolution.blockers).toEqual([refusalBlocker(refusal, message)]);
    },
  );

  it.each(refusalCases)(
    'exempts exactly { all: true } and selects the units of the table left by $damage',
    async ({ given }) => {
      const draft = await given();

      const resolution = await draft.resolveSelection({ all: true });

      expect(resolution.blockers).toEqual([]);
      expect(resolution.selected).toEqual(
        expect.arrayContaining([categoryEdit, productRename]),
      );
    },
  );

  it('resolves an id that a healthy table took over from a refused one to the healthy table', async () => {
    const draft = await givenRefusedIdTakenOverByAHealthyTable();

    const resolution = await draft.resolveSelection({
      fields: [{ tableId: PRODUCTS, rowId: 'g1', path: '/price' }],
    });

    expect(resolution).toEqual({
      selected: [
        { kind: 'field', tableId: PRODUCTS, rowId: 'g1', path: '/price' },
      ],
      excluded: [],
      required: [],
      blockers: [],
      unmatched: {},
    });
  });

  it("blocks the refused table that held the id in Head when it is addressed with side: 'head'", async () => {
    const draft = await givenRefusedIdTakenOverByAHealthyTable();

    const resolution = await draft.resolveSelection({
      tables: [{ tableId: PRODUCTS, side: 'head' }],
    });

    expect(resolution.blockers).toEqual([
      refusalBlocker(
        { tableId: ARCHIVE, code: 'headSchemaInconsistent' },
        'archive is refused: its Head schema does not match its Head ledger',
      ),
    ]);
    expect(resolution.unmatched).toEqual({});
  });

  it('blocks a row of a table created at the id of a removed refused table, whose structure unit it shares', async () => {
    const draft = await ChangesScenario.committed(kit, {
      [PRODUCTS]: { schema: productSchema, rows: productRows },
    });
    await completeAsyncMigrationInPlace(kit, draft, PRODUCTS, addColor);
    await draft.removeTable(PRODUCTS);
    await draft.createTable(PRODUCTS, productSchema);
    await draft.createRows(PRODUCTS, productRows);

    const resolution = await draft.resolveSelection({
      rows: [{ tableId: PRODUCTS, rowId: 'p1' }],
    });

    expect(resolution.required).toEqual([]);
    expect(resolution.blockers).toEqual([
      refusalBlocker(
        { tableId: PRODUCTS, code: 'headSchemaInconsistent' },
        damagedMessage,
      ),
    ]);
    expect(resolution.unmatched).toEqual({});
  });

  async function givenRefusedIdTakenOverByAHealthyTable(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [PRODUCTS]: { schema: productSchema, rows: productRows },
      [GOODS]: { schema: goodSchema, rows: { g1: { price: 1 } } },
    });
    await completeAsyncMigrationInPlace(kit, draft, PRODUCTS, addColor);
    await draft.renameTable(PRODUCTS, ARCHIVE);
    await draft.renameTable(GOODS, PRODUCTS);
    await draft.updateRow(PRODUCTS, 'g1', { price: 2 });

    return draft;
  }

  async function givenProductsMigratedInPlace(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [CATEGORIES]: categories,
      [PRODUCTS]: { schema: productSchema, rows: productRows },
    });
    await completeAsyncMigrationInPlace(kit, draft, PRODUCTS, addColor);

    return withEditsOfBothTables(draft);
  }

  async function givenProductsWithoutInit(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [CATEGORIES]: categories,
    });
    await draft.createTable(PRODUCTS, productSchema);
    await draft.createRows(PRODUCTS, productRows);
    await draft.dropFromDraftLedger('init', PRODUCTS);
    await draft.commit();

    return withEditsOfBothTables(draft);
  }

  async function withEditsOfBothTables(
    draft: ChangesScenario,
  ): Promise<ChangesScenario> {
    await draft.renameRow(PRODUCTS, 'p1', 'p9');
    await draft.updateRow(CATEGORIES, 'c1', { title: 'edited' });

    return draft;
  }
});

function refusalBlocker(refusal: RefusedTable, message: string): BlockerView {
  return { code: refusal.code, tableId: refusal.tableId, message };
}
