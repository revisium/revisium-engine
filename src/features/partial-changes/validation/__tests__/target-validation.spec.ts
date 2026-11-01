import { num, obj, str } from '@revisium/schema-toolkit/mocks';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import type { ChangeOperation } from 'src/features/partial-changes/assembly/outcome-rules';
import type {
  FieldRef,
  Selection,
} from 'src/features/partial-changes/selection/selection';
import {
  addField,
  removeField,
} from 'src/features/share/ledger-replay/__tests__/support/ledger-steps';
import { ChangesScenario } from '../../__tests__/support/changes-scenario';
import {
  completeAsyncMigrationInPlace,
  recordLedgerRepair,
} from '../../__tests__/support/head-schema-damage';

const PRODUCTS = 'products';
const CATEGORIES = 'categories';
const TAGS = 'tags';

const productSchema = obj({ title: str(), price: num() });
const categorySchema = obj({ title: str() });
const tagSchema = obj({ label: str() });
const labelSchema = obj({ name: str() });

const addColor = [addField('color', str())];

const priceOfP1: FieldRef = { tableId: PRODUCTS, rowId: 'p1', path: '/price' };
const titleOfP1: FieldRef = { tableId: PRODUCTS, rowId: 'p1', path: '/title' };
const titleOfC1: FieldRef = {
  tableId: CATEGORIES,
  rowId: 'c1',
  path: '/title',
};

interface ToleranceCase {
  readonly source: string;
  readonly given: () => Promise<ChangesScenario>;
  readonly operation: ChangeOperation;
  readonly selection: Selection;
}

describe('TargetValidator', () => {
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

  describe('merged rows', () => {
    it('blocks a merged row that fails its target schema as invalidRow, naming its unit and row', async () => {
      const draft = await givenProductWithInvalidPrice();

      const blockers = await draft.validateTarget('commit', {
        fields: [priceOfP1],
      });

      expect(blockers).toEqual([
        {
          code: 'invalidRow',
          tableId: PRODUCTS,
          rowId: 'p1',
          message:
            'products/p1 does not match the schema of the new Head: /price must be number',
          unit: { kind: 'field', ...priceOfP1 },
        },
      ]);
    });

    it('accepts a merged row that matches its target schema', async () => {
      const draft = await givenProductWithInvalidPrice();

      const blockers = await draft.validateTarget('commit', {
        fields: [titleOfP1],
      });

      expect(blockers).toEqual([]);
    });
  });

  describe('a Draft structure that its history does not record', () => {
    it('blocks committing it as unrecordedStructureChange', async () => {
      const draft = await givenUnrecordedProducts();

      const blockers = await draft.validateTarget('commit', { all: true });

      expect(blockers).toEqual([
        {
          code: 'unrecordedStructureChange',
          tableId: PRODUCTS,
          message:
            'The Draft structure of products is not reproduced by its schema history and migrations: its commit is refused, and Head rows cannot be migrated into it',
        },
      ]);
    });

    it('allows reverting it', async () => {
      const draft = await givenUnrecordedProducts();

      const blockers = await draft.validateTarget('revert', {
        tables: [PRODUCTS],
      });

      expect(blockers).toEqual([]);
    });
  });

  describe('the published migrations in the Draft ledger', () => {
    it.each([
      {
        alteration: 'missing',
        alter: (draft: ChangesScenario) =>
          draft.dropFromDraftLedger('init', CATEGORIES),
      },
      {
        alteration: 'changed',
        alter: (draft: ChangesScenario) =>
          draft.alterPublishedMigration('init', CATEGORIES, {
            schema: labelSchema,
          }),
      },
    ])(
      'blocks a Draft ledger whose published migration is $alteration as ledgerInconsistent',
      async ({ alter }) => {
        const draft = await givenEditedCatalog();
        await alter(draft);

        const blockers = await draft.validateTarget('commit', {
          fields: [titleOfC1],
        });

        expect(blockers).toEqual([
          {
            code: 'ledgerInconsistent',
            message:
              'A published migration is missing or changed in the Draft ledger',
          },
        ]);
      },
    );
  });

  describe('replaying the resulting ledgers', () => {
    it('blocks a revert whose resulting ledger does not replay as ledgerInconsistent', async () => {
      const draft = await givenForeignKeyAddedAndRemovedAgain();

      const blockers = await draft.validateTarget('revert', {
        tables: [TAGS],
      });

      expect(blockers).toEqual([
        {
          code: 'ledgerInconsistent',
          tableId: PRODUCTS,
          message:
            'The migration ledger of the reverted Draft cannot replay products: Foreign key target "tags" does not exist',
        },
      ]);
    });

    it('blocks a commit whose new Head ledger does not replay as ledgerInconsistent', async () => {
      const draft = await givenForeignKeyAddedAndRemovedAgain();

      const blockers = await draft.validateTarget('commit', {
        all: true,
        exclude: { tables: [TAGS] },
      });

      expect(blockers).toEqual([
        {
          code: 'ledgerInconsistent',
          tableId: PRODUCTS,
          message:
            'The migration ledger of the new Head cannot replay products: Foreign key target "tags" does not exist',
        },
      ]);
    });

    it('accepts a revert whose resulting ledger replays to its schemas', async () => {
      const draft = await givenForeignKeyAddedAndRemovedAgain();

      const blockers = await draft.validateTarget('revert', {
        tables: [TAGS, PRODUCTS],
      });

      expect(blockers).toEqual([]);
    });

    const toleranceCases: ToleranceCase[] = [
      {
        source:
          'a Draft structure that its history does not record, kept by a revert of another table',
        given: givenUnrecordedProducts,
        operation: 'revert',
        selection: { fields: [titleOfC1] },
      },
      {
        source:
          'a Draft structure that its history does not record, left in the remaining Draft by a commit of another table',
        given: givenUnrecordedProducts,
        operation: 'commit',
        selection: { fields: [titleOfC1] },
      },
      {
        source: 'a damaged Head table, published again by { all: true }',
        given: givenUnpublishedHeadDamage,
        operation: 'commit',
        selection: { all: true },
      },
      {
        source:
          'a damaged Head table, restored by { all: true } over its unpublished repair',
        given: givenUnpublishedRepair,
        operation: 'revert',
        selection: { all: true },
      },
    ];

    it.each(toleranceCases)(
      'tolerates an inconsistency the source already has: $source',
      async ({ given, operation, selection }) => {
        const draft = await given();

        const blockers = await draft.validateTarget(operation, selection);

        expect(blockers).toEqual([]);
      },
    );

    it.each<ChangeOperation>(['commit', 'revert'])(
      'leaves out the tables of a project without a migration table on %s',
      async (operation) => {
        const draft = await ChangesScenario.committedWithoutLedger(kit, {
          [PRODUCTS]: productFixture(),
        });
        await draft.updateRow(PRODUCTS, 'p1', { title: 'uno', price: 1 });

        const blockers = await draft.validateTarget(operation, { all: true });

        expect(blockers).toEqual([]);
      },
    );

    it('leaves out a table created in the Draft without its init migration', async () => {
      const draft = await givenEditedCatalog();
      await draft.createTable(TAGS, tagSchema);
      await draft.dropFromDraftLedger('init', TAGS);

      const blockers = await draft.validateTarget('commit', { all: true });

      expect(blockers).toEqual([]);
    });
  });

  async function givenProductWithInvalidPrice(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [PRODUCTS]: productFixture(),
    });
    await draft.updateRow(PRODUCTS, 'p1', { title: 'uno', price: 1 });
    await draft.writeInvalidRow(PRODUCTS, 'p1', { title: 'uno', price: 'ten' });

    return draft;
  }

  async function givenEditedCatalog(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [PRODUCTS]: productFixture(),
      [CATEGORIES]: {
        schema: categorySchema,
        rows: { c1: { title: 'first' } },
      },
    });
    await draft.updateRow(CATEGORIES, 'c1', { title: 'renamed' });

    return draft;
  }

  async function givenUnrecordedProducts(): Promise<ChangesScenario> {
    const draft = await givenEditedCatalog();
    await draft.updateTable(PRODUCTS, [addField('weight', num())]);
    await completeAsyncMigrationInPlace(kit, draft, PRODUCTS, addColor);
    expect(
      (await draft.readCatalogue([PRODUCTS])).structureOf(PRODUCTS),
    ).toMatchObject({ recorded: false });

    return draft;
  }

  async function givenUnpublishedHeadDamage(): Promise<ChangesScenario> {
    const draft = await givenEditedCatalog();
    await completeAsyncMigrationInPlace(kit, draft, PRODUCTS, addColor);

    return draft;
  }

  async function givenUnpublishedRepair(): Promise<ChangesScenario> {
    const draft = await givenUnpublishedHeadDamage();
    await recordLedgerRepair(draft, PRODUCTS, addColor);

    return draft;
  }

  async function givenForeignKeyAddedAndRemovedAgain(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [PRODUCTS]: { schema: productSchema },
    });
    await draft.createTable(TAGS, tagSchema);
    await draft.updateTable(PRODUCTS, [
      addField('tag', str({ foreignKey: TAGS })),
    ]);
    await draft.updateTable(PRODUCTS, [removeField('tag')]);

    return draft;
  }
});

function productFixture() {
  return {
    schema: productSchema,
    rows: { p1: { title: 'one', price: 1 } },
  };
}
