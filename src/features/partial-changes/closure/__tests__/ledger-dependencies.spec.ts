import { obj, str } from '@revisium/schema-toolkit/mocks';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import type { ChangeOperation } from 'src/features/partial-changes/assembly/outcome-rules';
import type { Selection } from 'src/features/partial-changes/selection/selection';
import { ChangesScenario } from '../../__tests__/support/changes-scenario';
import { withSelectorsOf } from '../../__tests__/support/dependency-closing';
import {
  replayedSchemasOf,
  schemasOf,
} from '../../__tests__/support/ledger-replaying';

const NOTES = 'notes';
const MEMOS = 'memos';
const LINKS = 'links';
const CATEGORIES = 'categories';
const KINDS = 'kinds';
const PRODUCTS = 'products';
const TAGS = 'tags';

const titleSchema = obj({ title: str() });
const linkSchemaTo = (tableId: string) =>
  obj({ title: str(), target: str({ foreignKey: tableId }) });

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

interface LedgerDependency {
  readonly name: string;
  readonly given: Given;
  readonly operation: ChangeOperation;
  readonly selection: Selection;
}

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
      const initOfLinks = await draft.migrationIdOf('init', LINKS);

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
      const initOfLinks = await draft.migrationIdOf('init', LINKS);

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
      const initOfLinks = await draft.migrationIdOf('init', LINKS);

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
      const initOfLinks = await draft.migrationIdOf('init', LINKS);

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
      const initOfLinks = await draft.migrationIdOf('init', LINKS);

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
      const initOfLinks = await draft.migrationIdOf('init', LINKS);

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
      const renameOfCategories = await draft.migrationIdOf(
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
      const renameOfCategories = await draft.migrationIdOf(
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
        await schemasOf(draft, 'draft'),
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
});

async function givenLinksCreatedWhileNotesWasRenamed(
  kit: PartialChangesTestKit,
): Promise<ChangesScenario> {
  const draft = await ChangesScenario.committed(kit, {
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
