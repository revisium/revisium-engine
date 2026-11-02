import { obj, str } from '@revisium/schema-toolkit/mocks';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import type { RefusalCode } from 'src/features/partial-changes/head-schema/head-schema-check';
import type { ChangeOperation } from 'src/features/partial-changes/plan/change-operation';
import type {
  RowRef,
  Selection,
} from 'src/features/partial-changes/selection/selection';
import {
  addField,
  replaceField,
} from 'src/features/share/ledger-replay/__tests__/support/ledger-steps';
import type { TableViewsData } from 'src/features/views/types';
import {
  ChangesScenario,
  type TableFixture,
} from '../../__tests__/support/changes-scenario';
import { withSelectorsOf } from '../../__tests__/support/dependency-closing';
import { completeAsyncMigrationInPlace } from '../../__tests__/support/head-schema-damage';

const ALPHA = 'alpha';
const BETA = 'beta';
const GAMMA = 'gamma';
const CATEGORIES = 'categories';
const KINDS = 'kinds';
const PRODUCTS = 'products';
const BRANDS = 'brands';
const OFFERS = 'offers';

const titleSchema = obj({ title: str() });
const categoryReferrerSchema = obj({
  title: str(),
  category: str({ foreignKey: CATEGORIES }),
});

const structureOf = (tableId: string) => ({
  kind: 'structure',
  tableId,
  selector: { tables: [tableId] },
});
const renamedStructureOf = (tableId: string, previousTableId: string) => ({
  kind: 'structure',
  tableId,
  previousTableId,
  selector: { tables: [tableId] },
});
const createdRow = ({ tableId, rowId }: RowRef) => ({
  kind: 'rowCreate',
  tableId,
  rowId,
  selector: { rows: [{ tableId, rowId }] },
});
const deletedRow = ({ tableId, rowId }: RowRef) => ({
  kind: 'rowDelete',
  tableId,
  rowId,
  selector: { rows: [{ tableId, rowId }] },
});
const viewsOf = (tableId: string) => ({
  kind: 'views',
  tableId,
  selector: { views: [tableId] },
});

type Given = (kit: PartialChangesTestKit) => Promise<ChangesScenario>;
type Tables = Readonly<Record<string, TableFixture>>;
type Committing = (
  kit: PartialChangesTestKit,
  tables: Tables,
) => Promise<ChangesScenario>;

interface Refusal {
  readonly damage: string;
  readonly code: RefusalCode;
  readonly committedRefusing: (tableId: string) => Committing;
}

const OPERATIONS: ChangeOperation[] = ['commit', 'revert'];

const REFUSAL_REASONS: Readonly<Record<RefusalCode, string>> = {
  headSchemaInconsistent: 'its Head schema does not match its Head ledger',
  unledgeredTable: 'it has no intact ledger lineage',
};

const MIGRATIONS_IN_PLACE: Refusal[] = [
  {
    damage: 'an async migration completed in place and not yet published',
    code: 'headSchemaInconsistent',
    committedRefusing: migratedInPlace,
  },
  {
    damage: 'an async migration completed in place and published natively',
    code: 'headSchemaInconsistent',
    committedRefusing: publishedAfterMigrationInPlace,
  },
];

const REFUSALS: Refusal[] = [
  ...MIGRATIONS_IN_PLACE,
  {
    damage: 'a Head ledger without the init of the table',
    code: 'unledgeredTable',
    committedRefusing: withoutInit,
  },
];

const committedIntact: Committing = (kit, tables) =>
  ChangesScenario.committed(kit, tables);

describe('DependencyClosure: structures, views and rows that come with a structure', () => {
  let kit: PartialChangesTestKit;

  beforeAll(async () => {
    kit = await createPartialChangesTestKit();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await kit.guard.verifyAndForget();
  });

  afterAll(async () => {
    await kit.close();
  });

  describe('two tables holding one id in the target', () => {
    it.each<{
      operation: ChangeOperation;
      selected: string;
      required: Record<string, unknown>;
      tableId: string;
      target: string;
    }>([
      {
        operation: 'commit',
        selected: BETA,
        required: renamedStructureOf(ALPHA, BETA),
        tableId: BETA,
        target: 'new Head',
      },
      {
        operation: 'commit',
        selected: ALPHA,
        required: renamedStructureOf(BETA, ALPHA),
        tableId: ALPHA,
        target: 'new Head',
      },
      {
        operation: 'revert',
        selected: BETA,
        required: renamedStructureOf(ALPHA, BETA),
        tableId: ALPHA,
        target: 'reverted Draft',
      },
    ])(
      'requires the other half of a table id swap when $selected is selected in a $operation',
      async ({ operation, selected, required, tableId, target }) => {
        const draft = await givenSwappedTables(kit);

        const closure = await draft.closeDependencies(operation, {
          tables: [selected],
        });

        expect(closure.required).toEqual([
          {
            unit: required,
            reason: {
              code: 'idOccupied',
              tableId,
              because: `the table id ${tableId} would be held by two tables in the ${target}`,
            },
          },
        ]);
        expect(closure.blockers).toEqual([]);
      },
    );
  });

  describe('a target schema that references a table the target does not contain', () => {
    it('requires the created table that a committed schema references', async () => {
      const draft = await givenProductsReferencingCreatedBrands(kit);

      const closure = await draft.closeDependencies('commit', {
        tables: [PRODUCTS],
      });

      expect(closure.required).toEqual([
        {
          unit: structureOf(BRANDS),
          reason: {
            code: 'referencedTableMissing',
            tableId: PRODUCTS,
            because:
              'the schema of products references the table brands, which exists only in the Draft',
          },
        },
      ]);
      expect(closure.blockers).toEqual([]);
    });

    it('requires reverting the kept schema that still references a reverted created table', async () => {
      const draft = await givenProductsReferencingCreatedBrands(kit);

      const closure = await draft.closeDependencies('revert', {
        tables: [BRANDS],
      });

      expect(closure.required).toEqual([
        {
          unit: structureOf(PRODUCTS),
          reason: {
            code: 'referrerStillReferences',
            tableId: PRODUCTS,
            because:
              'the schema of products references the table brands, which the reverted Draft no longer contains',
          },
        },
      ]);
      expect(closure.blockers).toEqual([]);
    });

    it.each<{
      selected: string;
      required: Record<string, unknown>;
      code: string;
      because: string;
    }>([
      {
        selected: KINDS,
        required: structureOf(PRODUCTS),
        code: 'referrerStillReferences',
        because:
          'the schema of products references the table categories, which the new Head no longer contains',
      },
      {
        selected: PRODUCTS,
        required: renamedStructureOf(KINDS, CATEGORIES),
        code: 'referencedTableMissing',
        because:
          'the schema of products references the table kinds, which exists only in the Draft',
      },
    ])(
      'commits a table rename and the referrer schema it rewrote together when $selected is selected',
      async ({ selected, required, code, because }) => {
        const draft = await givenRenamedCategoriesUnderProducts(kit);

        const closure = await draft.closeDependencies('commit', {
          tables: [selected],
        });

        expect(closure.required).toEqual([
          { unit: required, reason: { code, tableId: PRODUCTS, because } },
        ]);
        expect(closure.blockers).toEqual([]);
      },
    );

    it.each<{ operation: ChangeOperation; tableId: string; target: string }>([
      { operation: 'commit', tableId: BETA, target: 'new Head' },
      { operation: 'revert', tableId: ALPHA, target: 'reverted Draft' },
    ])(
      'requires the referrer schema a table swap rewrote in a $operation of the swap',
      async ({ operation, tableId, target }) => {
        const draft = await givenSwappedTablesUnderProducts(kit);

        const closure = await draft.closeDependencies(operation, {
          tables: [ALPHA, BETA],
        });

        expect(closure.required).toEqual([
          {
            unit: structureOf(PRODUCTS),
            reason: {
              code: 'referrerStillReferences',
              tableId: PRODUCTS,
              because: `the schema of products references the table ${tableId}, which is another table in the ${target}`,
            },
          },
        ]);
        expect(closure.blockers).toEqual([]);
      },
    );

    it('requires the swap that a committed referrer schema means', async () => {
      const draft = await givenSwappedTablesUnderProducts(kit);

      const closure = await draft.closeDependencies('commit', {
        tables: [PRODUCTS],
      });

      expect(closure.required).toEqual([
        {
          unit: renamedStructureOf(ALPHA, BETA),
          reason: {
            code: 'referencedTableMissing',
            tableId: PRODUCTS,
            because:
              'the schema of products references the table alpha, which is another table in the new Head',
          },
        },
        {
          unit: renamedStructureOf(BETA, ALPHA),
          reason: {
            code: 'idOccupied',
            tableId: ALPHA,
            because:
              'the table id alpha would be held by two tables in the new Head',
          },
        },
      ]);
      expect(closure.blockers).toEqual([]);
    });
  });

  describe('views against the target structure', () => {
    it.each<{
      operation: ChangeOperation;
      selection: Selection;
      required: Record<string, unknown>;
    }>([
      {
        operation: 'commit',
        selection: { views: [PRODUCTS] },
        required: structureOf(PRODUCTS),
      },
      {
        operation: 'revert',
        selection: { tables: [PRODUCTS] },
        required: viewsOf(PRODUCTS),
      },
    ])(
      'requires the unit the views of a new field need in a $operation',
      async ({ operation, selection, required }) => {
        const draft = await givenViewsOfNewField(kit);

        const closure = await draft.closeDependencies(operation, selection);

        expect(closure.required).toEqual([
          {
            unit: required,
            reason: {
              code: 'viewsDoNotFitStructure',
              tableId: PRODUCTS,
              because:
                'the Draft views of products do not fit its Head structure',
            },
          },
        ]);
        expect(closure.blockers).toEqual([]);
      },
    );

    it.each<{
      operation: ChangeOperation;
      selection: Selection;
      required: Record<string, unknown>;
      target: string;
    }>([
      {
        operation: 'commit',
        selection: { views: [OFFERS] },
        required: structureOf(OFFERS),
        target: 'new Head',
      },
      {
        operation: 'revert',
        selection: { tables: [OFFERS] },
        required: viewsOf(OFFERS),
        target: 'reverted Draft',
      },
    ])(
      'keeps the views of a created table together with the table in a $operation',
      async ({ operation, selection, required, target }) => {
        const draft = await givenCreatedOffersWithViews(kit);

        const closure = await draft.closeDependencies(operation, selection);

        expect(closure.required).toEqual([
          {
            unit: required,
            reason: {
              code: 'viewsDoNotFitStructure',
              tableId: OFFERS,
              because: `the Draft views of offers belong to a table the ${target} does not contain`,
            },
          },
        ]);
        expect(closure.blockers).toEqual([]);
      },
    );

    it('blocks committed views of a created table whose structure is excluded as requiredExcluded', async () => {
      const draft = await givenCreatedOffersWithViews(kit);

      const closure = await draft.closeDependencies('commit', {
        views: [OFFERS],
        exclude: { tables: [OFFERS] },
      });

      expect(closure.required).toEqual([]);
      expect(closure.blockers).toEqual([
        {
          code: 'requiredExcluded',
          tableId: OFFERS,
          message: 'offers is required but excluded',
          unit: structureOf(OFFERS),
          reason: {
            code: 'viewsDoNotFitStructure',
            tableId: OFFERS,
            because:
              'the Draft views of offers belong to a table the new Head does not contain',
          },
        },
      ]);
    });

    it('blocks views that do not fit the structure of their own side as invalidViews', async () => {
      const draft = await givenViewsOfMissingField(kit);

      const closure = await draft.closeDependencies('commit', {
        tables: [PRODUCTS],
        views: [PRODUCTS],
      });

      expect(closure.required).toEqual([]);
      expect(closure.blockers).toEqual([
        {
          code: 'invalidViews',
          tableId: PRODUCTS,
          message: 'The Draft views of products do not fit its Draft structure',
        },
      ]);
    });
  });

  describe('rows that come with a structure', () => {
    it('requires the creation of a row that a committed created table references', async () => {
      const draft = await givenCreatedOffersOfCreatedCategory(kit);

      const closure = await draft.closeDependencies('commit', {
        tables: [OFFERS],
      });

      expect(closure.required).toEqual([
        {
          unit: createdRow({ tableId: CATEGORIES, rowId: 'c9' }),
          reason: {
            code: 'referencedRowMissing',
            tableId: OFFERS,
            rowId: 'o2',
            because:
              'offers/o2 references categories/c9, which exists only in the Draft',
          },
        },
      ]);
      expect(closure.blockers).toEqual([]);
    });

    it('reads the references of a created table once, not on every pass', async () => {
      const draft = await givenCreatedOffersOfCreatedCategory(kit);
      const referenceReads = jest.spyOn(
        kit.snapshotReader,
        'readUnresolvedReferences',
      );

      const closure = await draft.closeDependencies('commit', {
        tables: [OFFERS],
      });

      expect(closure.required).toHaveLength(1);
      expect(referenceReads).toHaveBeenCalledTimes(1);
    });

    it('requires restoring a deleted row that a restored table references', async () => {
      const draft = await givenRemovedOffersOfDeletedCategory(kit);

      const closure = await draft.closeDependencies('revert', {
        tables: [OFFERS],
      });

      expect(closure.required).toEqual([
        {
          unit: deletedRow({ tableId: CATEGORIES, rowId: 'c1' }),
          reason: {
            code: 'referencedRowMissing',
            tableId: OFFERS,
            rowId: 'o1',
            because:
              'offers/o1 references categories/c1, which exists only in Head',
          },
        },
      ]);
      expect(closure.blockers).toEqual([]);
    });

    it.each<{
      operation: ChangeOperation;
      required: Record<string, unknown>;
      because: string;
    }>([
      {
        operation: 'commit',
        required: createdRow({ tableId: BRANDS, rowId: 'c1' }),
        because:
          'products/p1 references brands/c1, which exists only in the Draft',
      },
      {
        operation: 'revert',
        required: deletedRow({ tableId: CATEGORIES, rowId: 'c1' }),
        because:
          'products/p1 references categories/c1, which exists only in Head',
      },
    ])(
      'requires the rows that a foreign key changed by the structure needs in a $operation',
      async ({ operation, required, because }) => {
        const draft = await givenProductsReferencingBrandsInstead(kit);

        const closure = await draft.closeDependencies(operation, {
          tables: [PRODUCTS],
        });

        expect(closure.required).toEqual([
          {
            unit: required,
            reason: {
              code: 'referencedRowMissing',
              tableId: PRODUCTS,
              rowId: 'p1',
              because,
            },
          },
        ]);
        expect(closure.blockers).toEqual([]);
      },
    );

    it('blocks a created table whose row references a row of neither revision as danglingInSource', async () => {
      const draft = await givenCreatedOfferOfMissingCategory(kit);

      const closure = await draft.closeDependencies('commit', {
        tables: [OFFERS],
      });

      expect(closure.required).toEqual([]);
      expect(closure.blockers).toEqual([
        {
          code: 'danglingInSource',
          tableId: OFFERS,
          rowId: 'o1',
          message:
            'No unit can restore consistency: offers/o1 references categories/c404, which the new Head does not contain',
          unit: structureOf(OFFERS),
        },
      ]);
    });
  });

  describe('a structure that only a refused table could give', () => {
    it.each(inEveryOperation(REFUSALS))(
      'blocks the other half of a table id swap in a $operation with the code of the half left by $damage',
      async ({ operation, code, committedRefusing }) => {
        const draft = await givenSwappedTables(kit, committedRefusing(ALPHA));

        const closure = await draft.closeDependencies(operation, {
          tables: [ALPHA],
        });

        expect(closure.required).toEqual([]);
        expect(closure.blockers).toEqual([refusalOf(BETA, code)]);
      },
    );

    it.each(inEveryOperation(REFUSALS))(
      'blocks a table rename in a $operation with the code of a referrer left by $damage that keeps the old reference',
      async ({ operation, code, committedRefusing }) => {
        const draft = await givenRenamedCategoriesUnderProducts(
          kit,
          committedRefusing(PRODUCTS),
        );

        const closure = await draft.closeDependencies(operation, {
          tables: [KINDS],
        });

        expect(closure.required).toEqual([]);
        expect(closure.blockers).toEqual([refusalOf(PRODUCTS, code)]);
      },
    );

    it.each(inEveryOperation(MIGRATIONS_IN_PLACE))(
      'blocks the referrer schema a rename rewrote in a $operation with the code of the renamed table left by $damage',
      async ({ operation, code, committedRefusing }) => {
        const draft = await givenRenamedCategoriesUnderProducts(
          kit,
          committedRefusing(CATEGORIES),
        );

        const closure = await draft.closeDependencies(operation, {
          tables: [PRODUCTS],
        });

        expect(closure.required).toEqual([]);
        expect(closure.blockers).toEqual([refusalOf(KINDS, code)]);
      },
    );

    it('blocks a committed schema that references a table created in the Draft without its init with unledgeredTable', async () => {
      const draft = await givenProductsReferencingBrandsCreatedWithoutInit(kit);

      const closure = await draft.closeDependencies('commit', {
        tables: [PRODUCTS],
      });

      expect(closure.required).toEqual([]);
      expect(closure.blockers).toEqual([refusalOf(BRANDS, 'unledgeredTable')]);
    });
  });

  it('blocks a required structure that the selection excludes as requiredExcluded, naming the unit and its reason', async () => {
    const draft = await givenProductsReferencingCreatedBrands(kit);

    const closure = await draft.closeDependencies('commit', {
      tables: [PRODUCTS],
      exclude: { tables: [BRANDS] },
    });

    expect(closure.required).toEqual([]);
    expect(closure.blockers).toEqual([
      {
        code: 'requiredExcluded',
        tableId: BRANDS,
        message: 'brands is required but excluded',
        unit: structureOf(BRANDS),
        reason: {
          code: 'referencedTableMissing',
          tableId: PRODUCTS,
          because:
            'the schema of products references the table brands, which exists only in the Draft',
        },
      },
    ]);
  });

  it.each<{
    name: string;
    operation: ChangeOperation;
    given: Given;
    selection: Selection;
  }>([
    {
      name: 'the other half of a table swap',
      operation: 'commit',
      given: givenSwappedTables,
      selection: { tables: [BETA] },
    },
    {
      name: 'a referenced created table',
      operation: 'commit',
      given: givenProductsReferencingCreatedBrands,
      selection: { tables: [PRODUCTS] },
    },
    {
      name: 'a referrer schema a rename rewrote',
      operation: 'commit',
      given: givenRenamedCategoriesUnderProducts,
      selection: { tables: [KINDS] },
    },
    {
      name: 'a referrer schema a table swap rewrote',
      operation: 'commit',
      given: givenSwappedTablesUnderProducts,
      selection: { tables: [ALPHA, BETA] },
    },
    {
      name: 'the swap a committed referrer schema means',
      operation: 'commit',
      given: givenSwappedTablesUnderProducts,
      selection: { tables: [PRODUCTS] },
    },
    {
      name: 'a referrer schema a reverted table swap rewrote',
      operation: 'revert',
      given: givenSwappedTablesUnderProducts,
      selection: { tables: [ALPHA, BETA] },
    },
    {
      name: 'the structure that views need',
      operation: 'commit',
      given: givenViewsOfNewField,
      selection: { views: [PRODUCTS] },
    },
    {
      name: 'the table that committed views belong to',
      operation: 'commit',
      given: givenCreatedOffersWithViews,
      selection: { views: [OFFERS] },
    },
    {
      name: 'the views of a reverted created table',
      operation: 'revert',
      given: givenCreatedOffersWithViews,
      selection: { tables: [OFFERS] },
    },
    {
      name: 'a row that a created table references',
      operation: 'commit',
      given: givenCreatedOffersOfCreatedCategory,
      selection: { tables: [OFFERS] },
    },
    {
      name: 'a row that a restored table references',
      operation: 'revert',
      given: givenRemovedOffersOfDeletedCategory,
      selection: { tables: [OFFERS] },
    },
    {
      name: 'a row that a reverted foreign key references',
      operation: 'revert',
      given: givenProductsReferencingBrandsInstead,
      selection: { tables: [PRODUCTS] },
    },
  ])(
    'closes with nothing required once the selectors of $name are added (AS-67)',
    async ({ operation, given, selection }) => {
      const draft = await given(kit);
      const { required } = await draft.closeDependencies(operation, selection);

      const closure = await draft.closeDependencies(
        operation,
        withSelectorsOf(selection, required),
      );

      expect(required).not.toEqual([]);
      expect(closure.required).toEqual([]);
      expect(closure.blockers).toEqual([]);
    },
  );
});

function inEveryOperation(
  refusals: readonly Refusal[],
): (Refusal & { readonly operation: ChangeOperation })[] {
  return refusals.flatMap((refusal) =>
    OPERATIONS.map((operation) => ({ ...refusal, operation })),
  );
}

function refusalOf(tableId: string, code: RefusalCode) {
  return {
    code,
    tableId,
    message: `${tableId} is refused: ${REFUSAL_REASONS[code]}`,
  };
}

async function givenSwappedTables(
  kit: PartialChangesTestKit,
  committed: Committing = committedIntact,
): Promise<ChangesScenario> {
  const draft = await committed(kit, {
    [ALPHA]: { schema: titleSchema, rows: { a1: { title: 'a1' } } },
    [BETA]: { schema: titleSchema, rows: { b1: { title: 'b1' } } },
  });
  await draft.renameTable(ALPHA, GAMMA);
  await draft.renameTable(BETA, ALPHA);
  await draft.renameTable(GAMMA, BETA);

  return draft;
}

async function givenSwappedTablesUnderProducts(
  kit: PartialChangesTestKit,
): Promise<ChangesScenario> {
  const draft = await ChangesScenario.committed(kit, {
    [ALPHA]: { schema: titleSchema },
    [BETA]: { schema: titleSchema },
    [PRODUCTS]: {
      schema: obj({ title: str(), part: str({ foreignKey: BETA }) }),
    },
  });
  await draft.renameTable(ALPHA, GAMMA);
  await draft.renameTable(BETA, ALPHA);
  await draft.renameTable(GAMMA, BETA);

  return draft;
}

async function givenProductsReferencingCreatedBrands(
  kit: PartialChangesTestKit,
): Promise<ChangesScenario> {
  const draft = await ChangesScenario.committed(kit, {
    [PRODUCTS]: { schema: titleSchema },
  });
  await draft.createTable(BRANDS, titleSchema);
  await draft.updateTable(PRODUCTS, [
    addField('brand', str({ foreignKey: BRANDS })),
  ]);

  return draft;
}

async function givenProductsReferencingBrandsCreatedWithoutInit(
  kit: PartialChangesTestKit,
): Promise<ChangesScenario> {
  const draft = await givenProductsReferencingCreatedBrands(kit);
  await draft.dropFromDraftLedger('init', BRANDS);

  return draft;
}

async function givenRenamedCategoriesUnderProducts(
  kit: PartialChangesTestKit,
  committed: Committing = committedIntact,
): Promise<ChangesScenario> {
  const draft = await committed(kit, {
    [CATEGORIES]: { schema: titleSchema, rows: { c1: { title: 'c1' } } },
    [PRODUCTS]: {
      schema: categoryReferrerSchema,
      rows: { p1: { title: 'p1', category: 'c1' } },
    },
  });
  await draft.renameTable(CATEGORIES, KINDS);

  return draft;
}

async function givenViewsOfNewField(
  kit: PartialChangesTestKit,
): Promise<ChangesScenario> {
  const draft = await givenProductsWithViews(kit);
  await draft.updateTable(PRODUCTS, [addField('color', str())]);
  await draft.updateViews(PRODUCTS, tableViews(['title', 'color']));

  return draft;
}

async function givenViewsOfMissingField(
  kit: PartialChangesTestKit,
): Promise<ChangesScenario> {
  const draft = await givenProductsWithViews(kit);
  await draft.updateTable(PRODUCTS, [addField('color', str())]);
  await draft.writeInvalidViews(PRODUCTS, tableViews(['title', 'missing']));

  return draft;
}

async function givenProductsWithViews(
  kit: PartialChangesTestKit,
): Promise<ChangesScenario> {
  const draft = await ChangesScenario.committed(kit, {
    [PRODUCTS]: { schema: titleSchema },
  });
  await draft.updateViews(PRODUCTS, tableViews(['title']));
  await draft.commit();

  return draft;
}

async function givenCreatedOffersWithViews(
  kit: PartialChangesTestKit,
): Promise<ChangesScenario> {
  const draft = await ChangesScenario.committed(kit, {});
  await draft.createTable(OFFERS, titleSchema);
  await draft.updateViews(OFFERS, tableViews(['title']));

  return draft;
}

async function givenCreatedOffersOfCreatedCategory(
  kit: PartialChangesTestKit,
): Promise<ChangesScenario> {
  const draft = await ChangesScenario.committed(kit, {
    [CATEGORIES]: { schema: titleSchema, rows: { c1: { title: 'c1' } } },
  });
  await draft.createRows(CATEGORIES, { c9: { title: 'c9' } });
  await draft.createTable(OFFERS, categoryReferrerSchema);
  await draft.createRows(OFFERS, {
    o1: { title: 'o1', category: 'c1' },
    o2: { title: 'o2', category: 'c9' },
  });

  return draft;
}

async function givenRemovedOffersOfDeletedCategory(
  kit: PartialChangesTestKit,
): Promise<ChangesScenario> {
  const draft = await ChangesScenario.committed(kit, {
    [CATEGORIES]: {
      schema: titleSchema,
      rows: { c1: { title: 'c1' }, c2: { title: 'c2' } },
    },
    [OFFERS]: {
      schema: categoryReferrerSchema,
      rows: { o1: { title: 'o1', category: 'c1' } },
    },
  });
  await draft.removeTable(OFFERS);
  await draft.removeRow(CATEGORIES, 'c1');

  return draft;
}

async function givenProductsReferencingBrandsInstead(
  kit: PartialChangesTestKit,
): Promise<ChangesScenario> {
  const draft = await ChangesScenario.committed(kit, {
    [CATEGORIES]: { schema: titleSchema, rows: { c1: { title: 'c1' } } },
    [BRANDS]: { schema: titleSchema },
    [PRODUCTS]: {
      schema: categoryReferrerSchema,
      rows: { p1: { title: 'p1', category: 'c1' } },
    },
  });
  await draft.createRows(BRANDS, { c1: { title: 'brand c1' } });
  await draft.updateTable(PRODUCTS, [
    replaceField('category', str({ foreignKey: BRANDS })),
  ]);
  await draft.removeRow(CATEGORIES, 'c1');

  return draft;
}

async function givenCreatedOfferOfMissingCategory(
  kit: PartialChangesTestKit,
): Promise<ChangesScenario> {
  const draft = await ChangesScenario.committed(kit, {
    [CATEGORIES]: { schema: titleSchema, rows: { c1: { title: 'c1' } } },
  });
  await draft.createTable(OFFERS, categoryReferrerSchema);
  await draft.createRows(OFFERS, { o1: { title: 'o1', category: 'c1' } });
  await draft.writeDanglingReference(OFFERS, 'o1', {
    title: 'o1',
    category: 'c404',
  });

  await expect(draft.row('draft', OFFERS, 'o1')).resolves.toMatchObject({
    data: { category: 'c404' },
  });

  return draft;
}

function migratedInPlace(refusedTableId: string): Committing {
  return async (kit, tables) => {
    const draft = await ChangesScenario.committed(kit, tables);
    await completeAsyncMigrationInPlace(kit, draft, refusedTableId, [
      addField('color', str()),
    ]);

    return draft;
  };
}

function publishedAfterMigrationInPlace(refusedTableId: string): Committing {
  return async (kit, tables) => {
    const draft = await migratedInPlace(refusedTableId)(kit, tables);
    await draft.commit();

    return draft;
  };
}

function withoutInit(refusedTableId: string): Committing {
  return async (kit, tables) => {
    const draft = await ChangesScenario.committed(kit, {});

    for (const [tableId, { schema, rows }] of Object.entries(tables)) {
      await draft.createTable(tableId, schema);
      await draft.createRows(tableId, rows ?? {});
    }

    await draft.dropFromDraftLedger('init', refusedTableId);
    await draft.commit();

    return draft;
  };
}

function tableViews(fields: readonly string[]): TableViewsData {
  return {
    version: 1,
    defaultViewId: 'default',
    views: [
      {
        id: 'default',
        name: 'All',
        columns: fields.map((field) => ({ field: `data.${field}` })),
      },
    ],
  };
}
