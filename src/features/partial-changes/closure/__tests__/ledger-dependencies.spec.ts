import { num, obj, str } from '@revisium/schema-toolkit/mocks';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import type { ChangesBlocked } from 'src/features/partial-changes/commands/impl/apply-changes';
import type { RefusalCode } from 'src/features/partial-changes/head-schema/head-schema-check';
import type { ChangeOperation } from 'src/features/partial-changes/plan/change-operation';
import type { Blocker } from 'src/features/partial-changes/planning/plan-refs';
import type { Selection } from 'src/features/partial-changes/selection/selection';
import {
  addField,
  moveField,
  removeField,
} from 'src/__tests__/fixtures/ledger-steps';
import { branchContentsOf } from 'src/__tests__/fixtures/branch-content';
import type { TableFixture } from 'src/__tests__/fixtures/branch-scenario';
import { completeAsyncMigrationInPlace } from 'src/__tests__/fixtures/head-schema-damage';
import {
  migrationIdOf,
  storedSchemasOf,
} from 'src/__tests__/fixtures/stored-ledger';
import { ChangesScenario } from '../../__tests__/support/changes-scenario';
import { withSelectorsOf } from '../../__tests__/support/dependency-closing';
import { replayedSchemasOf } from '../../__tests__/support/ledger-replaying';

const NOTES = 'notes';
const MEMOS = 'memos';
const ARCHIVE = 'archive';
const LINKS = 'links';
const CATEGORIES = 'categories';
const KINDS = 'kinds';
const PRODUCTS = 'products';
const TAGS = 'tags';
const REVIEWS = 'reviews';
const ORDERS = 'orders';
const BRANDS = 'brands';

const titleSchema = obj({ title: str() });
const linkSchemaTo = (tableId: string) =>
  obj({ title: str(), target: str({ foreignKey: tableId }) });
const targetIn = (tableId: string) =>
  addField('target', str({ foreignKey: tableId }));

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

type Given = (kit: PartialChangesTestKit) => Promise<ChangesScenario>;
type Tables = Readonly<Record<string, TableFixture>>;
type Committing = (
  kit: PartialChangesTestKit,
  tables: Tables,
) => Promise<ChangesScenario>;

const committedIntact: Committing = (kit, tables) =>
  ChangesScenario.committed(kit, tables);

const REFUSAL_REASONS: Readonly<Record<RefusalCode, string>> = {
  headSchemaInconsistent: 'its Head schema does not match its Head ledger',
  unledgeredTable: 'it has no intact ledger lineage',
};

const refusalOf = (tableId: string, code: RefusalCode): Blocker => ({
  code,
  tableId,
  message: `${tableId} is refused: ${REFUSAL_REASONS[code]}`,
});

interface LedgerDependency {
  readonly name: string;
  readonly given: Given;
  readonly operation: ChangeOperation;
  readonly selection: Selection;
}

interface RefusedDependency extends LedgerDependency {
  readonly refusal: Blocker;
}

const REFUSED_DEPENDENCIES: RefusedDependency[] = [
  {
    name: 'a created table whose init references a table without a ledger lineage',
    given: (kit) => givenReviewsOfProducts(kit, withoutInit(PRODUCTS)),
    operation: 'commit',
    selection: { tables: [REVIEWS] },
    refusal: refusalOf(PRODUCTS, 'unledgeredTable'),
  },
  {
    name: 'an update that gives a table a key to a table without a ledger lineage',
    given: givenOrdersGivenAKeyToUnledgeredProducts,
    operation: 'commit',
    selection: { tables: [ORDERS] },
    refusal: refusalOf(PRODUCTS, 'unledgeredTable'),
  },
  {
    name: 'a created table whose init references a table whose Head ledger fails to replay',
    given: givenReviewsOfProductsOfUnledgeredCategories,
    operation: 'commit',
    selection: { tables: [REVIEWS] },
    refusal: refusalOf(PRODUCTS, 'headSchemaInconsistent'),
  },
  {
    name: 'a table created while a damaged table had another id',
    given: (kit) =>
      givenLinksCreatedWhileNotesWasRenamed(kit, migratedInPlace(NOTES)),
    operation: 'commit',
    selection: { tables: [LINKS] },
    refusal: refusalOf(NOTES, 'headSchemaInconsistent'),
  },
  {
    name: 'a table created while a table without a ledger lineage had another id',
    given: (kit) =>
      givenLinksCreatedWhileNotesWasRenamed(kit, withoutInit(NOTES)),
    operation: 'commit',
    selection: { tables: [LINKS] },
    refusal: refusalOf(NOTES, 'unledgeredTable'),
  },
  {
    name: 'a created table that only pending migrations of a damaged table referenced',
    given: givenDamagedProductsThatReferencedBrandsOnlyInPendingMigrations,
    operation: 'revert',
    selection: { tables: [BRANDS] },
    refusal: refusalOf(PRODUCTS, 'headSchemaInconsistent'),
  },
];

const REVERTS: LedgerDependency[] = [
  {
    name: 'the renames of a table referenced by a table created in between',
    given: givenLinksCreatedWhileNotesWasRenamed,
    operation: 'revert',
    selection: { tables: [NOTES] },
  },
  {
    name: 'the rename of a table referenced by a table created and removed in between',
    given: givenLinksCreatedAndRemovedWhileCategoriesWasRenamed,
    operation: 'revert',
    selection: { tables: [KINDS] },
  },
  {
    name: 'the removal of a table whose id a rotation of renames took',
    given: givenTablesRotatedIntoRemovedNotes,
    operation: 'revert',
    selection: { tables: [NOTES] },
  },
  {
    name: 'the rename that vacated an id a referenced created table took',
    given: givenProductsReferencingNotesCreatedInPlaceOfArchive,
    operation: 'revert',
    selection: { tables: [ARCHIVE] },
  },
  {
    name: 'the rename of a table that only pending migrations of another table referenced',
    given: givenProductsThatReferencedKindsOnlyInPendingMigrations,
    operation: 'revert',
    selection: { tables: [KINDS] },
  },
];

const COMMITS: LedgerDependency[] = [
  {
    name: 'a table created while the table it references had another id',
    given: givenLinksCreatedWhileNotesWasRenamed,
    operation: 'commit',
    selection: { tables: [LINKS] },
  },
  {
    name: 'the renames of a table referenced by a table created in between',
    given: givenLinksCreatedWhileNotesWasRenamed,
    operation: 'commit',
    selection: { tables: [NOTES] },
  },
  {
    name: 'a table created and removed while the table it references had another id',
    given: givenLinksCreatedAndRemovedWhileCategoriesWasRenamed,
    operation: 'commit',
    selection: { tables: [LINKS] },
  },
  {
    name: 'a rotation of renames into the id of a removed table',
    given: givenTablesRotatedIntoRemovedNotes,
    operation: 'commit',
    selection: { tables: [PRODUCTS] },
  },
  {
    name: 'two tables that held one id in turn, without the referrer of the first',
    given: givenProductsReferencingNotesBeforeItsIdWasReused,
    operation: 'commit',
    selection: { tables: [NOTES, MEMOS] },
  },
  {
    name: 'a table whose pending migrations alone referenced a renamed table',
    given: givenProductsThatReferencedKindsOnlyInPendingMigrations,
    operation: 'commit',
    selection: { tables: [PRODUCTS] },
  },
];

describe('DependencyClosure: pending migrations that need a table id another unit provides at their step', () => {
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

  describe('a table created while the table it references had another id', () => {
    it('requires reverting the created table when the renames are reverted', async () => {
      const draft = await givenLinksCreatedWhileNotesWasRenamed(kit);
      const initOfLinks = await migrationIdOf(draft, 'init', LINKS);

      const closure = await draft.closeDependencies('revert', {
        tables: [NOTES],
      });

      expect(closure.required).toEqual([
        {
          unit: structureOf(LINKS),
          reason: {
            code: 'referrerStillReferences',
            tableId: LINKS,
            because: `the migration ${initOfLinks} of links references the table memos, which the reverted Draft ledger does not hold at that step`,
          },
        },
      ]);
      expect(closure.blockers).toEqual([]);
    });

    it('requires the renames when the created table is committed', async () => {
      const draft = await givenLinksCreatedWhileNotesWasRenamed(kit);
      const initOfLinks = await migrationIdOf(draft, 'init', LINKS);

      const closure = await draft.closeDependencies('commit', {
        tables: [LINKS],
      });

      expect(closure.required).toEqual([
        {
          unit: structureOf(NOTES),
          reason: {
            code: 'referencedTableMissing',
            tableId: LINKS,
            because: `the migration ${initOfLinks} of links references the table memos, which the new Head ledger does not hold at that step`,
          },
        },
      ]);
      expect(closure.blockers).toEqual([]);
    });

    it('requires the created table when the renames are committed', async () => {
      const draft = await givenLinksCreatedWhileNotesWasRenamed(kit);
      const initOfLinks = await migrationIdOf(draft, 'init', LINKS);

      const closure = await draft.closeDependencies('commit', {
        tables: [NOTES],
      });

      expect(closure.required).toEqual([
        {
          unit: structureOf(LINKS),
          reason: {
            code: 'referrerStillReferences',
            tableId: LINKS,
            because: `the migration ${initOfLinks} of links references the table memos, which the remaining Draft ledger does not hold at that step`,
          },
        },
      ]);
      expect(closure.blockers).toEqual([]);
    });

    it('blocks a required table that the selection excludes as requiredExcluded', async () => {
      const draft = await givenLinksCreatedWhileNotesWasRenamed(kit);
      const initOfLinks = await migrationIdOf(draft, 'init', LINKS);

      const closure = await draft.closeDependencies('revert', {
        tables: [NOTES],
        exclude: { tables: [LINKS] },
      });

      expect(closure.required).toEqual([]);
      expect(closure.blockers).toEqual([
        {
          code: 'requiredExcluded',
          tableId: LINKS,
          message: 'links is required but excluded',
          unit: structureOf(LINKS),
          reason: {
            code: 'referrerStillReferences',
            tableId: LINKS,
            because: `the migration ${initOfLinks} of links references the table memos, which the reverted Draft ledger does not hold at that step`,
          },
        },
      ]);
    });
  });

  describe('a table created and removed while the table it references had another id', () => {
    it('requires reverting the removed table when the rename is reverted', async () => {
      const draft =
        await givenLinksCreatedAndRemovedWhileCategoriesWasRenamed(kit);
      const initOfLinks = await migrationIdOf(draft, 'init', LINKS);

      const closure = await draft.closeDependencies('revert', {
        tables: [KINDS],
      });

      expect(closure.required).toEqual([
        {
          unit: structureOf(LINKS),
          reason: {
            code: 'referrerStillReferences',
            tableId: LINKS,
            because: `the migration ${initOfLinks} of links references the table kinds, which the reverted Draft ledger does not hold at that step`,
          },
        },
      ]);
      expect(closure.blockers).toEqual([]);
    });

    it('requires the rename when the removed table is committed', async () => {
      const draft =
        await givenLinksCreatedAndRemovedWhileCategoriesWasRenamed(kit);
      const initOfLinks = await migrationIdOf(draft, 'init', LINKS);

      const closure = await draft.closeDependencies('commit', {
        tables: [LINKS],
      });

      expect(closure.required).toEqual([
        {
          unit: renamedStructureOf(KINDS, CATEGORIES),
          reason: {
            code: 'referencedTableMissing',
            tableId: LINKS,
            because: `the migration ${initOfLinks} of links references the table kinds, which the new Head ledger does not hold at that step`,
          },
        },
      ]);
      expect(closure.blockers).toEqual([]);
    });
  });

  describe('tables rotated into the id of a removed table', () => {
    it('requires reverting the renames into the restored ids when the removal is reverted', async () => {
      const draft = await givenTablesRotatedIntoRemovedNotes(kit);
      const renameOfCategories = await migrationIdOf(
        draft,
        'rename',
        CATEGORIES,
      );

      const closure = await draft.closeDependencies('revert', {
        tables: [NOTES],
      });

      expect(closure.required).toEqual([
        {
          unit: renamedStructureOf(CATEGORIES, PRODUCTS),
          reason: {
            code: 'idOccupied',
            tableId: CATEGORIES,
            because:
              'the table id categories would be held by two tables in the reverted Draft',
          },
        },
        {
          unit: renamedStructureOf(PRODUCTS, CATEGORIES),
          reason: {
            code: 'idOccupied',
            tableId: NOTES,
            because: `the migration ${renameOfCategories} of categories takes the table id notes, which the reverted Draft ledger already holds at that step`,
          },
        },
      ]);
      expect(closure.blockers).toEqual([]);
    });

    it('requires the removal whose id the committed renames take', async () => {
      const draft = await givenTablesRotatedIntoRemovedNotes(kit);
      const renameOfCategories = await migrationIdOf(
        draft,
        'rename',
        CATEGORIES,
      );

      const closure = await draft.closeDependencies('commit', {
        tables: [PRODUCTS],
      });

      expect(closure.required).toEqual([
        {
          unit: renamedStructureOf(CATEGORIES, PRODUCTS),
          reason: {
            code: 'idOccupied',
            tableId: PRODUCTS,
            because:
              'the table id products would be held by two tables in the new Head',
          },
        },
        {
          unit: structureOf(NOTES),
          reason: {
            code: 'idOccupied',
            tableId: NOTES,
            because: `the migration ${renameOfCategories} of categories takes the table id notes, which the new Head ledger already holds at that step`,
          },
        },
      ]);
      expect(closure.blockers).toEqual([]);
    });
  });

  describe('a table id that another table holds at the step', () => {
    it('requires the referrer that the remaining Draft would resolve to the other table when both tables are committed', async () => {
      const draft =
        await givenProductsReferencingNotesBeforeItsIdWasReused(kit);
      const updateOfProducts = await migrationIdOf(draft, 'update', PRODUCTS);

      const closure = await draft.closeDependencies('commit', {
        tables: [NOTES, MEMOS],
      });

      expect(closure.required).toEqual([
        {
          unit: structureOf(PRODUCTS),
          reason: {
            code: 'referrerStillReferences',
            tableId: PRODUCTS,
            because: `the migration ${updateOfProducts} of products references the table notes, which is another table in the remaining Draft ledger at that step`,
          },
        },
      ]);
      expect(closure.blockers).toEqual([]);
    });

    it('requires reverting the referrer of a created table when the table whose id it took is restored', async () => {
      const draft =
        await givenProductsReferencingNotesCreatedInPlaceOfArchive(kit);

      const closure = await draft.closeDependencies('revert', {
        tables: [ARCHIVE],
      });

      expect(closure.required).toEqual([
        {
          unit: structureOf(NOTES),
          reason: {
            code: 'idOccupied',
            tableId: NOTES,
            because:
              'the table id notes would be held by two tables in the reverted Draft',
          },
        },
        {
          unit: structureOf(PRODUCTS),
          reason: {
            code: 'referrerStillReferences',
            tableId: PRODUCTS,
            because:
              'the schema of products references the table notes, which is another table in the reverted Draft',
          },
        },
      ]);
      expect(closure.blockers).toEqual([]);
    });
  });

  describe('a failure that the Draft ledger already has', () => {
    it('requires nothing for a reference that a migration behind that failure no longer finds, and the revert applies', async () => {
      const draft =
        await givenProductsFailingToReplayBeforeReferencingNotes(kit);
      const selection = { tables: [NOTES] };

      const closure = await draft.closeDependencies('revert', selection);
      const preview = await draft.previewChanges({
        operation: 'revert',
        selection,
      });
      const result = await draft.revertChanges({
        selection,
        expected: preview.fingerprint,
      });

      expect(closure.required).toEqual([]);
      expect(closure.blockers).toEqual([]);
      expect(preview.status).toBe('ready');
      expect(result.status).toBe('applied');
    });
  });

  describe('a step that needs a refused table', () => {
    it.each(REFUSED_DEPENDENCIES)(
      'blocks a $operation of $name with the code of the refused table',
      async ({ given, operation, selection, refusal }) => {
        const draft = await given(kit);

        const closure = await draft.closeDependencies(operation, selection);

        expect(closure.required).toEqual([]);
        expect(closure.blockers).toEqual([refusal]);
      },
    );

    it.each(REFUSED_DEPENDENCIES)(
      'refuses to $operation $name with only that code and writes nothing',
      async ({ given, operation, selection, refusal }) => {
        const draft = await given(kit);
        const contents = await branchContentsOf(kit, draft);

        const result =
          operation === 'commit'
            ? await draft.commitChanges({ selection })
            : await draft.revertChanges({ selection });

        expect(result).toEqual<ChangesBlocked>({
          status: 'blocked',
          blockers: [refusal],
          required: [],
        });
        expect(await branchContentsOf(kit, draft)).toEqual(contents);
      },
    );

    it('commits a created table that references a damaged table whose Head ledger still replays', async () => {
      const draft = await givenReviewsOfProducts(
        kit,
        migratedInPlace(PRODUCTS),
      );
      const selection = { tables: [REVIEWS] };

      const closure = await draft.closeDependencies('commit', selection);
      const result = await draft.commitChanges({ selection });

      expect(closure.required).toEqual([]);
      expect(closure.blockers).toEqual([]);
      expect(result.status).toBe('applied');
      expect(await draft.hasTable('head', REVIEWS)).toBe(true);
    });
  });

  it.each([...REVERTS, ...COMMITS])(
    'closes a $operation of $name with nothing required once the selectors of its required units are added (AS-67)',
    async ({ given, operation, selection }) => {
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

  it.each(REVERTS)(
    'reverts $name with its required units to a Draft whose ledger replays to its schemas',
    async ({ given, selection }) => {
      const draft = await given(kit);
      await draft.createTable(TAGS, titleSchema);
      const preview = await draft.previewChanges({
        operation: 'revert',
        selection,
      });

      const result = await draft.revertChanges({
        selection,
        includeRequired: true,
        expected: preview.fingerprint,
      });

      expect(preview.status).toBe('required');
      expect(result.status).toBe('applied');
      expect(await draft.hasTable('draft', TAGS)).toBe(true);
      expect(await replayedSchemasOf(draft, 'draft')).toEqual(
        await storedSchemasOf(draft, 'draft'),
      );
    },
  );

  it.each(COMMITS)(
    'validates the new Head and the remaining Draft of a commit of $name with its required units',
    async ({ given, selection }) => {
      const draft = await given(kit);
      const { required } = await draft.closeDependencies('commit', selection);

      const blockers = await draft.validateTarget(
        'commit',
        withSelectorsOf(selection, required),
      );

      expect(blockers).toEqual([]);
    },
  );

  it.each(COMMITS)(
    'commits $name with its required units to a Head and a remaining Draft whose ledgers replay to their schemas',
    async ({ given, selection }) => {
      const draft = await given(kit);
      const preview = await draft.previewChanges({
        operation: 'commit',
        selection,
      });

      const result = await draft.commitChanges({
        selection,
        includeRequired: true,
        expected: preview.fingerprint,
      });

      expect(preview.status).toBe('required');
      expect(result.status).toBe('applied');
      expect(await replayedSchemasOf(draft, 'head')).toEqual(
        await storedSchemasOf(draft, 'head'),
      );
      expect(await replayedSchemasOf(draft, 'draft')).toEqual(
        await storedSchemasOf(draft, 'draft'),
      );
    },
  );
});

async function givenLinksCreatedWhileNotesWasRenamed(
  kit: PartialChangesTestKit,
  committed: Committing = committedIntact,
): Promise<ChangesScenario> {
  const draft = await committed(kit, {
    [NOTES]: { schema: titleSchema, rows: { n1: { title: 'n1' } } },
  });
  await draft.renameTable(NOTES, MEMOS);
  await draft.createTable(LINKS, linkSchemaTo(MEMOS));
  await draft.renameTable(MEMOS, NOTES);

  return draft;
}

async function givenLinksCreatedAndRemovedWhileCategoriesWasRenamed(
  kit: PartialChangesTestKit,
): Promise<ChangesScenario> {
  const draft = await ChangesScenario.committed(kit, {
    [CATEGORIES]: { schema: titleSchema, rows: { c1: { title: 'c1' } } },
  });
  await draft.renameTable(CATEGORIES, KINDS);
  await draft.createTable(LINKS, linkSchemaTo(KINDS));
  await draft.removeTable(LINKS);

  return draft;
}

async function givenProductsThatReferencedKindsOnlyInPendingMigrations(
  kit: PartialChangesTestKit,
): Promise<ChangesScenario> {
  const draft = await ChangesScenario.committed(kit, {
    [CATEGORIES]: { schema: titleSchema, rows: { c1: { title: 'c1' } } },
    [PRODUCTS]: { schema: titleSchema },
  });
  await draft.renameTable(CATEGORIES, KINDS);
  await draft.updateTable(PRODUCTS, [targetIn(KINDS)]);
  await draft.updateTable(PRODUCTS, [removeField('target')]);
  await draft.createRows(PRODUCTS, { p1: { title: 'p1' } });

  return draft;
}

async function givenTablesRotatedIntoRemovedNotes(
  kit: PartialChangesTestKit,
): Promise<ChangesScenario> {
  const draft = await ChangesScenario.committed(kit, {
    [NOTES]: { schema: titleSchema, rows: { n1: { title: 'n1' } } },
    [CATEGORIES]: { schema: titleSchema, rows: { c1: { title: 'c1' } } },
    [PRODUCTS]: { schema: titleSchema, rows: { p1: { title: 'p1' } } },
  });
  await draft.removeTable(NOTES);
  await draft.renameTable(CATEGORIES, NOTES);
  await draft.renameTable(PRODUCTS, CATEGORIES);
  await draft.renameTable(NOTES, PRODUCTS);

  return draft;
}

async function givenProductsReferencingNotesBeforeItsIdWasReused(
  kit: PartialChangesTestKit,
): Promise<ChangesScenario> {
  const draft = await ChangesScenario.committed(kit, {
    [PRODUCTS]: { schema: titleSchema },
  });
  await draft.createTable(NOTES, titleSchema);
  await draft.updateTable(PRODUCTS, [targetIn(NOTES)]);
  await draft.renameTable(NOTES, MEMOS);
  await draft.createTable(NOTES, titleSchema);

  return draft;
}

async function givenProductsReferencingNotesCreatedInPlaceOfArchive(
  kit: PartialChangesTestKit,
): Promise<ChangesScenario> {
  const draft = await ChangesScenario.committed(kit, {
    [NOTES]: { schema: titleSchema, rows: { n1: { title: 'n1' } } },
    [PRODUCTS]: { schema: titleSchema },
  });
  await draft.renameTable(NOTES, ARCHIVE);
  await draft.createTable(NOTES, titleSchema);
  await draft.updateTable(PRODUCTS, [targetIn(NOTES)]);

  return draft;
}

async function givenProductsFailingToReplayBeforeReferencingNotes(
  kit: PartialChangesTestKit,
): Promise<ChangesScenario> {
  const draft = await ChangesScenario.committed(kit, {
    [PRODUCTS]: { schema: titleSchema },
  });
  await draft.updateTable(PRODUCTS, [addField('weight', num())]);
  await completeAsyncMigrationInPlace(kit, draft, PRODUCTS, [
    addField('color', str()),
  ]);
  await draft.updateTable(PRODUCTS, [moveField('color', 'hue')]);
  await draft.createTable(NOTES, titleSchema);
  await draft.updateTable(PRODUCTS, [targetIn(NOTES)]);
  await draft.updateTable(PRODUCTS, [removeField('target')]);

  expect((await replayedSchemasOf(draft, 'draft'))[PRODUCTS]).toEqual({
    unreplayable: expect.any(String),
  });

  return draft;
}

async function givenReviewsOfProducts(
  kit: PartialChangesTestKit,
  committed: Committing,
): Promise<ChangesScenario> {
  const draft = await committed(kit, {
    [PRODUCTS]: { schema: titleSchema, rows: { p1: { title: 'p1' } } },
  });
  await draft.createTable(REVIEWS, linkSchemaTo(PRODUCTS));

  return draft;
}

async function givenOrdersGivenAKeyToUnledgeredProducts(
  kit: PartialChangesTestKit,
): Promise<ChangesScenario> {
  const draft = await withoutInit(PRODUCTS)(kit, {
    [PRODUCTS]: { schema: titleSchema, rows: { p1: { title: 'p1' } } },
    [ORDERS]: { schema: titleSchema },
  });
  await draft.updateTable(ORDERS, [targetIn(PRODUCTS)]);

  return draft;
}

async function givenReviewsOfProductsOfUnledgeredCategories(
  kit: PartialChangesTestKit,
): Promise<ChangesScenario> {
  const draft = await withoutInit(CATEGORIES)(kit, {
    [CATEGORIES]: { schema: titleSchema },
    [PRODUCTS]: { schema: linkSchemaTo(CATEGORIES) },
  });
  await draft.createTable(REVIEWS, linkSchemaTo(PRODUCTS));

  expect((await replayedSchemasOf(draft, 'head'))[PRODUCTS]).toEqual({
    unreplayable: expect.any(String),
  });

  return draft;
}

async function givenDamagedProductsThatReferencedBrandsOnlyInPendingMigrations(
  kit: PartialChangesTestKit,
): Promise<ChangesScenario> {
  const draft = await migratedInPlace(PRODUCTS)(kit, {
    [PRODUCTS]: { schema: titleSchema },
  });
  await draft.createTable(BRANDS, titleSchema);
  await draft.updateTable(PRODUCTS, [targetIn(BRANDS)]);
  await draft.updateTable(PRODUCTS, [removeField('target')]);

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
