import { num, obj, str } from '@revisium/schema-toolkit/mocks';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import type { ChangeOperation } from 'src/features/partial-changes/plan/change-operation';
import type { Selection } from 'src/features/partial-changes/selection/selection';
import {
  addField,
  moveField,
  removeField,
} from 'src/__tests__/fixtures/ledger-steps';
import { completeAsyncMigrationInPlace } from 'src/__tests__/fixtures/head-schema-damage';
import {
  migrationIdOf,
  storedLedgerOf,
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
const LABELS = 'labels';

const titleSchema = obj({ title: str() });
const linkSchemaTo = (tableId: string) =>
  obj({ title: str(), target: str({ foreignKey: tableId }) });
const targetIn = (tableId: string) =>
  addField('target', str({ foreignKey: tableId }));

const structureOf = (tableId: string) => ({
  kind: 'structure',
  tableId,
  selector: { structures: [{ tableId }] },
});
const renamedStructureOf = (tableId: string, previousTableId: string) => ({
  kind: 'structure',
  tableId,
  previousTableId,
  selector: { structures: [{ tableId }] },
});

const stepOf = (tableId: string, migrationId: string) => ({
  kind: 'migration',
  tableId,
  migrationId,
});
const referencedTable = (tableId: string) => ({ kind: 'table', tableId });

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
    selection: { structures: [{ tableId: NOTES }] },
  },
  {
    name: 'the rename of a table referenced by a table created and removed in between',
    given: givenLinksCreatedAndRemovedWhileCategoriesWasRenamed,
    operation: 'revert',
    selection: { structures: [{ tableId: KINDS }] },
  },
  {
    name: 'the removal of a table whose id a rotation of renames took',
    given: givenTablesRotatedIntoRemovedNotes,
    operation: 'revert',
    selection: { structures: [{ tableId: NOTES }] },
  },
  {
    name: 'the rename that vacated an id a referenced created table took',
    given: givenProductsReferencingNotesCreatedInPlaceOfArchive,
    operation: 'revert',
    selection: { structures: [{ tableId: ARCHIVE }] },
  },
  {
    name: 'the rename of a table that only pending migrations of another table referenced',
    given: givenProductsThatReferencedKindsOnlyInPendingMigrations,
    operation: 'revert',
    selection: { structures: [{ tableId: KINDS }] },
  },
];

const COMMITS: LedgerDependency[] = [
  {
    name: 'a table created while the table it references had another id',
    given: givenLinksCreatedWhileNotesWasRenamed,
    operation: 'commit',
    selection: { structures: [{ tableId: LINKS }] },
  },
  {
    name: 'the renames of a table referenced by a table created in between',
    given: givenLinksCreatedWhileNotesWasRenamed,
    operation: 'commit',
    selection: { structures: [{ tableId: NOTES }] },
  },
  {
    name: 'a table created and removed while the table it references had another id',
    given: givenLinksCreatedAndRemovedWhileCategoriesWasRenamed,
    operation: 'commit',
    selection: { structures: [{ tableId: LINKS }] },
  },
  {
    name: 'a rotation of renames into the id of a removed table',
    given: givenTablesRotatedIntoRemovedNotes,
    operation: 'commit',
    selection: { structures: [{ tableId: PRODUCTS }] },
  },
  {
    name: 'two tables that held one id in turn, without the referrer of the first',
    given: givenProductsReferencingNotesBeforeItsIdWasReused,
    operation: 'commit',
    selection: { structures: [{ tableId: NOTES }, { tableId: MEMOS }] },
  },
  {
    name: 'a table whose pending migrations alone referenced a renamed table',
    given: givenProductsThatReferencedKindsOnlyInPendingMigrations,
    operation: 'commit',
    selection: { structures: [{ tableId: PRODUCTS }] },
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
        structures: [{ tableId: NOTES }],
      });

      expect(closure.required).toEqual([
        {
          unit: structureOf(LINKS),
          reason: {
            code: 'referrerStillReferences',
            because: `the migration ${initOfLinks} of links references the table memos, which the reverted Draft ledger does not hold at that step`,
            site: stepOf(LINKS, initOfLinks),
            references: referencedTable(MEMOS),
            cause: { unit: structureOf(NOTES), role: 'remover' },
          },
        },
      ]);
      expect(closure.blockers).toEqual([]);
    });

    it('requires the renames when the created table is committed', async () => {
      const draft = await givenLinksCreatedWhileNotesWasRenamed(kit);
      const initOfLinks = await migrationIdOf(draft, 'init', LINKS);

      const closure = await draft.closeDependencies('commit', {
        structures: [{ tableId: LINKS }],
      });

      expect(closure.required).toEqual([
        {
          unit: structureOf(NOTES),
          reason: {
            code: 'referencedTableMissing',
            because: `the migration ${initOfLinks} of links references the table memos, which the new Head ledger does not hold at that step`,
            site: stepOf(LINKS, initOfLinks),
            references: referencedTable(MEMOS),
            cause: { unit: structureOf(LINKS), role: 'referrer' },
          },
        },
      ]);
      expect(closure.blockers).toEqual([]);
    });

    it('requires the created table when the renames are committed', async () => {
      const draft = await givenLinksCreatedWhileNotesWasRenamed(kit);
      const initOfLinks = await migrationIdOf(draft, 'init', LINKS);

      const closure = await draft.closeDependencies('commit', {
        structures: [{ tableId: NOTES }],
      });

      expect(closure.required).toEqual([
        {
          unit: structureOf(LINKS),
          reason: {
            code: 'referrerStillReferences',
            because: `the migration ${initOfLinks} of links references the table memos, which the remaining Draft ledger does not hold at that step`,
            site: stepOf(LINKS, initOfLinks),
            references: referencedTable(MEMOS),
            cause: { unit: structureOf(NOTES), role: 'remover' },
          },
        },
      ]);
      expect(closure.blockers).toEqual([]);
    });

    it('blocks a required table that the selection excludes as requiredExcluded', async () => {
      const draft = await givenLinksCreatedWhileNotesWasRenamed(kit);
      const initOfLinks = await migrationIdOf(draft, 'init', LINKS);

      const closure = await draft.closeDependencies('revert', {
        structures: [{ tableId: NOTES }],
        exclude: { structures: [{ tableId: LINKS }] },
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
            because: `the migration ${initOfLinks} of links references the table memos, which the reverted Draft ledger does not hold at that step`,
            site: stepOf(LINKS, initOfLinks),
            references: referencedTable(MEMOS),
            cause: { unit: structureOf(NOTES), role: 'remover' },
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
        structures: [{ tableId: KINDS }],
      });

      expect(closure.required).toEqual([
        {
          unit: structureOf(LINKS),
          reason: {
            code: 'referrerStillReferences',
            because: `the migration ${initOfLinks} of links references the table kinds, which the reverted Draft ledger does not hold at that step`,
            site: stepOf(LINKS, initOfLinks),
            references: referencedTable(KINDS),
            cause: {
              unit: renamedStructureOf(KINDS, CATEGORIES),
              role: 'remover',
            },
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
        structures: [{ tableId: LINKS }],
      });

      expect(closure.required).toEqual([
        {
          unit: renamedStructureOf(KINDS, CATEGORIES),
          reason: {
            code: 'referencedTableMissing',
            because: `the migration ${initOfLinks} of links references the table kinds, which the new Head ledger does not hold at that step`,
            site: stepOf(LINKS, initOfLinks),
            references: referencedTable(KINDS),
            cause: { unit: structureOf(LINKS), role: 'referrer' },
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
        structures: [{ tableId: NOTES }],
      });

      expect(closure.required).toEqual([
        {
          unit: renamedStructureOf(CATEGORIES, PRODUCTS),
          reason: {
            code: 'idOccupied',
            because:
              'the table id categories would be held by two tables in the reverted Draft',
            site: { kind: 'tableId', tableId: CATEGORIES },
            cause: {
              unit: renamedStructureOf(PRODUCTS, CATEGORIES),
              role: 'taker',
            },
          },
        },
        {
          unit: renamedStructureOf(PRODUCTS, CATEGORIES),
          reason: {
            code: 'idOccupied',
            because: `the migration ${renameOfCategories} of categories takes the table id notes, which the reverted Draft ledger already holds at that step`,
            site: {
              kind: 'tableId',
              tableId: NOTES,
              migrationId: renameOfCategories,
            },
            cause: { unit: structureOf(NOTES), role: 'occupant' },
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
        structures: [{ tableId: PRODUCTS }],
      });

      expect(closure.required).toEqual([
        {
          unit: renamedStructureOf(CATEGORIES, PRODUCTS),
          reason: {
            code: 'idOccupied',
            because:
              'the table id products would be held by two tables in the new Head',
            site: { kind: 'tableId', tableId: PRODUCTS },
            cause: {
              unit: renamedStructureOf(PRODUCTS, CATEGORIES),
              role: 'taker',
            },
          },
        },
        {
          unit: structureOf(NOTES),
          reason: {
            code: 'idOccupied',
            because: `the migration ${renameOfCategories} of categories takes the table id notes, which the new Head ledger already holds at that step`,
            site: {
              kind: 'tableId',
              tableId: NOTES,
              migrationId: renameOfCategories,
            },
            cause: {
              unit: renamedStructureOf(PRODUCTS, CATEGORIES),
              role: 'taker',
            },
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
        structures: [{ tableId: NOTES }, { tableId: MEMOS }],
      });

      expect(closure.required).toEqual([
        {
          unit: structureOf(PRODUCTS),
          reason: {
            code: 'referrerStillReferences',
            because: `the migration ${updateOfProducts} of products references the table notes, which is another table in the remaining Draft ledger at that step`,
            site: stepOf(PRODUCTS, updateOfProducts),
            references: referencedTable(NOTES),
            cause: { unit: structureOf(NOTES), role: 'remover' },
          },
        },
      ]);
      expect(closure.blockers).toEqual([]);
    });

    it('requires reverting the referrer of a created table when the table whose id it took is restored', async () => {
      const draft =
        await givenProductsReferencingNotesCreatedInPlaceOfArchive(kit);

      const closure = await draft.closeDependencies('revert', {
        structures: [{ tableId: ARCHIVE }],
      });

      expect(closure.required).toEqual([
        {
          unit: structureOf(NOTES),
          reason: {
            code: 'idOccupied',
            because:
              'the table id notes would be held by two tables in the reverted Draft',
            site: { kind: 'tableId', tableId: NOTES },
            cause: {
              unit: renamedStructureOf(ARCHIVE, NOTES),
              role: 'taker',
            },
          },
        },
        {
          unit: structureOf(PRODUCTS),
          reason: {
            code: 'referrerStillReferences',
            because:
              'the schema of products references the table notes, which is another table in the reverted Draft',
            site: { kind: 'schema', tableId: PRODUCTS },
            references: referencedTable(NOTES),
            cause: { unit: structureOf(NOTES), role: 'remover' },
          },
        },
      ]);
      expect(closure.blockers).toEqual([]);
    });
  });

  describe('the cause at a ledger step whose unit is required (AS-85)', () => {
    it('names the committed table that holds the taken id at the step as its occupant', async () => {
      const draft = await givenTableIdTakenAgainAfterARename(kit);
      const [initOfFirstTags] = await initIdsOf(draft, TAGS);

      const closure = await draft.closeDependencies('commit', {
        structures: [{ tableId: TAGS }],
      });

      expect(closure.required).toEqual([
        {
          unit: structureOf(LABELS),
          reason: {
            code: 'idOccupied',
            because: `the migration ${initOfFirstTags} of tags takes the table id tags, which the remaining Draft ledger already holds at that step`,
            site: {
              kind: 'tableId',
              tableId: TAGS,
              migrationId: initOfFirstTags,
            },
            cause: { unit: structureOf(TAGS), role: 'occupant' },
          },
        },
      ]);
      expect(closure.blockers).toEqual([]);
    });

    it('names the committed removal of the table that the step references as its remover', async () => {
      const draft = await givenNotesRemovedAfterLinksDroppedItsKey(kit);
      const initOfLinks = await migrationIdOf(draft, 'init', LINKS);

      const closure = await draft.closeDependencies('commit', {
        structures: [{ tableId: NOTES }],
      });

      expect(closure.required).toEqual([
        {
          unit: structureOf(LINKS),
          reason: {
            code: 'referrerStillReferences',
            because: `the migration ${initOfLinks} of links references the table notes, which the remaining Draft ledger does not hold at that step`,
            site: stepOf(LINKS, initOfLinks),
            references: referencedTable(NOTES),
            cause: { unit: structureOf(NOTES), role: 'remover' },
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
      const selection = { structures: [{ tableId: NOTES }] };

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

async function givenTableIdTakenAgainAfterARename(
  kit: PartialChangesTestKit,
): Promise<ChangesScenario> {
  const draft = await ChangesScenario.committed(kit, {
    [NOTES]: { schema: titleSchema },
  });
  await draft.createTable(TAGS, titleSchema);
  await draft.renameTable(TAGS, LABELS);
  await draft.createTable(TAGS, titleSchema);

  return draft;
}

async function givenNotesRemovedAfterLinksDroppedItsKey(
  kit: PartialChangesTestKit,
): Promise<ChangesScenario> {
  const draft = await ChangesScenario.committed(kit, {
    [NOTES]: { schema: titleSchema, rows: { n1: { title: 'n1' } } },
  });
  await draft.createTable(LINKS, linkSchemaTo(NOTES));
  await draft.updateTable(LINKS, [removeField('target')]);
  await draft.removeTable(NOTES);

  return draft;
}

async function initIdsOf(
  draft: ChangesScenario,
  tableId: string,
): Promise<string[]> {
  const ledger = await storedLedgerOf(draft, 'draft');

  return ledger
    .filter(
      (migration) =>
        migration.changeType === 'init' && migration.tableId === tableId,
    )
    .map(({ id }) => id);
}

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
