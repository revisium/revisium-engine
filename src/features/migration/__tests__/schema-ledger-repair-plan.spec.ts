import { BadRequestException } from '@nestjs/common';
import { arr, num, numFormula, obj, str } from '@revisium/schema-toolkit/mocks';
import type {
  JsonPatch,
  JsonSchema,
  JsonValue,
} from '@revisium/schema-toolkit/types';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import { MigrationLockedException } from 'src/features/migration/exceptions/migration-locked.exception';
import type { RepairOutcome } from 'src/features/migration/queries/impl/plan-schema-ledger-repair.query';
import type { InputJsonValue } from 'src/engine-prisma-types';
import { ChangesScenario } from 'src/features/partial-changes/__tests__/support/changes-scenario';
import {
  completeAsyncMigrationInPlace,
  describedLedgerOf,
  recordLedgerRepair,
  replayedHeadLedgerOf,
} from 'src/features/partial-changes/__tests__/support/head-schema-damage';
import {
  addField,
  moveField,
  removeField,
} from 'src/features/share/ledger-replay/__tests__/support/ledger-steps';
import {
  branchContentsOf,
  expectStrictlyAscending,
  givenActiveMigration,
  migratedRowOf,
  lastPublishedMigrationId,
  pendingMigrationIds,
  planRepair,
  repairOf,
  writeRowWithoutValidation,
} from './support/ledger-repair-planning';
import {
  addColor,
  addTone,
  ALPHAS,
  BETAS,
  CATEGORIES,
  categories,
  COLOR,
  givenCatalogWithTags,
  givenCommittedCatalog,
  givenPublishedInPlaceMigration,
  givenReciprocalDamage,
  givenTwoDamagedTablesAfterFuturePublication,
  givenUnpublishedInPlaceMigration,
  NOTES,
  noteSchema,
  PRODUCTS,
  productSchema,
  TAGS,
  tags,
  tagSchema,
  TONE,
} from './support/ledger-damage';

const GOODS = 'goods';
const LABELS = 'labels';
const CARDS = 'cards';
const INVOICES = 'invoices';
const TEXT = 'text';
const BODY = 'body';
const SHADE = 'shade';
const HUE = 'hue';

const cardSchema = obj({ title: str(), tag: str({ foreignKey: TAGS }) });
const describedNoteSchema = { ...obj({ text: str() }), description: 'notes' };
const describedAddressSchema = {
  ...obj({ city: str() }),
  description: 'where',
};
const taggedNoteSchema = obj({
  text: str(),
  tags: arr(str({ foreignKey: TAGS })),
});

const addTagReference = [addField('tag', str({ foreignKey: TAGS }))];
const addNote = [addField('note', str())];

interface UnrepairableCase {
  readonly table: string;
  readonly given: () => Promise<ChangesScenario>;
  readonly tableId: string;
  readonly outcome: RepairOutcome;
}

interface ContainerCase {
  readonly change: string;
  readonly schema: JsonSchema;
  readonly damage: JsonPatch[];
  readonly removedPaths: string[];
  readonly row: JsonValue;
  readonly migratedRow: JsonValue;
}

interface HistoryCase {
  readonly table: string;
  readonly changeTags: (draft: ChangesScenario) => Promise<void>;
  readonly outcome: RepairOutcome;
}

interface UnreferencingRowsCase {
  readonly rows: string;
  readonly noteRows: Readonly<Record<string, InputJsonValue>>;
}

interface RowsCase {
  readonly rows: string;
  readonly given: () => Promise<ChangesScenario>;
  readonly invalidRowIds: string[];
}

describe('Schema ledger repair planning', () => {
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

  describe('a damaged Head table', () => {
    it('plans the repair of an unpublished async migration right after the last published migration and renumbers the pending migrations after it', async () => {
      const draft = await givenUnpublishedInPlaceMigration(kit);
      await draft.updateTable(CATEGORIES, addNote);
      const lastPublishedId = await lastPublishedMigrationId(draft);
      const [pendingId] = await pendingMigrationIds(draft);

      const plan = await planRepair(kit, draft, [PRODUCTS]);

      expect(plan.tables).toEqual([
        {
          tableId: PRODUCTS,
          outcome: 'repaired',
          migrationId: expect.any(String),
          patches: addColor,
          removedPaths: [],
        },
      ]);
      expect(plan.renumbered).toEqual([
        { previousId: pendingId, id: expect.any(String) },
      ]);
      expectStrictlyAscending([
        lastPublishedId,
        repairOf(plan, PRODUCTS).migrationId,
        plan.renumbered.at(0)?.id,
      ]);
    });

    it('plans the repair of a published async migration before the pending rename of the field it added', async () => {
      const draft = await givenPublishedInPlaceMigration(kit);
      await draft.updateTable(PRODUCTS, [moveField(COLOR, SHADE)]);
      const [pendingId] = await pendingMigrationIds(draft);

      const plan = await planRepair(kit, draft, [PRODUCTS]);

      expect(plan.tables).toEqual([
        {
          tableId: PRODUCTS,
          outcome: 'repaired',
          migrationId: expect.any(String),
          patches: addColor,
          removedPaths: [],
        },
      ]);
      expect(plan.renumbered).toEqual([
        { previousId: pendingId, id: expect.any(String) },
      ]);
    });

    it('plans an unrecorded field rename as a removal and an addition whose values replicas lose', async () => {
      const draft = await ChangesScenario.committed(kit, {
        [NOTES]: { schema: noteSchema },
      });
      await completeAsyncMigrationInPlace(kit, draft, NOTES, [
        moveField(TEXT, BODY),
      ]);

      const plan = await planRepair(kit, draft, [NOTES]);

      expect(repairOf(plan, NOTES)).toMatchObject({
        outcome: 'repaired',
        patches: [removeField(TEXT), addField(BODY, str())],
        removedPaths: ['/properties/text'],
      });
    });

    it('plans the repair of a table renamed through recorded migrations', async () => {
      const draft = await givenCommittedCatalog(kit);
      await draft.renameTable(PRODUCTS, GOODS);
      await draft.commit();
      await completeAsyncMigrationInPlace(kit, draft, GOODS, addColor);

      const plan = await planRepair(kit, draft, [GOODS]);

      expect(repairOf(plan, GOODS)).toMatchObject({
        outcome: 'repaired',
        patches: addColor,
      });
    });

    it('validates the repair where it is inserted, before a pending rename of the table its new foreign key names', async () => {
      const draft = await ChangesScenario.committed(kit, {
        [TAGS]: { schema: tagSchema },
        [NOTES]: { schema: noteSchema },
      });
      await completeAsyncMigrationInPlace(kit, draft, NOTES, addTagReference);
      await draft.renameTable(TAGS, LABELS);

      const plan = await planRepair(kit, draft, [NOTES]);

      expect(repairOf(plan, NOTES)).toMatchObject({
        outcome: 'repaired',
        patches: addTagReference,
      });
    });

    it.each<ContainerCase>([
      {
        change: 'a container description and a removed child',
        schema: obj({ text: str(), old: str() }),
        damage: [
          removeField('old'),
          { op: 'replace', path: '', value: describedNoteSchema },
        ],
        removedPaths: ['/properties/old'],
        row: { text: 'a', old: 'b' },
        migratedRow: { text: 'a' },
      },
      {
        change: 'a container description only',
        schema: obj({ text: str() }),
        damage: [{ op: 'replace', path: '', value: describedNoteSchema }],
        removedPaths: [],
        row: { text: 'a' },
        migratedRow: { text: 'a' },
      },
      {
        change: 'a nested container description and a removed nested child',
        schema: obj({ address: obj({ city: str(), zip: str() }) }),
        damage: [
          { op: 'remove', path: '/properties/address/properties/zip' },
          {
            op: 'replace',
            path: '/properties/address',
            value: describedAddressSchema,
          },
        ],
        removedPaths: ['/properties/address/properties/zip'],
        row: { address: { city: 'c', zip: 'z' } },
        migratedRow: { address: { city: 'c' } },
      },
    ])(
      'plans $change as child operations before a metadata replace that rows migrate through',
      async ({ schema, damage, removedPaths, row, migratedRow }) => {
        const draft = await ChangesScenario.committed(kit, {
          [NOTES]: { schema },
        });
        await completeAsyncMigrationInPlace(kit, draft, NOTES, damage);

        const plan = await planRepair(kit, draft, [NOTES]);

        const repair = repairOf(plan, NOTES);
        expect(repair).toMatchObject({
          outcome: 'repaired',
          patches: damage,
          removedPaths,
        });
        expect(migratedRowOf(kit, schema, row, repair.patches ?? [])).toEqual(
          migratedRow,
        );
      },
    );

    it('finds a Draft that already records the repair', async () => {
      const draft = await givenUnpublishedInPlaceMigration(kit);
      await recordLedgerRepair(draft, PRODUCTS, addColor);

      const plan = await planRepair(kit, draft, [PRODUCTS]);

      expect(plan.tables).toEqual([
        { tableId: PRODUCTS, outcome: 'alreadyRepaired' },
      ]);
      expect(plan.renumbered).toEqual([]);
    });

    it('refuses a repair whose patch the synchronous path rejects where it would be inserted', async () => {
      const draft = await ChangesScenario.committed(kit, {
        [INVOICES]: { schema: obj({ amount: num() }) },
      });
      await completeAsyncMigrationInPlace(kit, draft, INVOICES, [
        addField('total', numFormula('missing * 2')),
      ]);

      const plan = await planRepair(kit, draft, [INVOICES]);

      expect(plan.tables).toEqual([
        { tableId: INVOICES, outcome: 'patchNotReproducible' },
      ]);
    });

    it.each<RowsCase>([
      {
        rows: 'rows a native revert relinked without the unrecorded field',
        given: givenRevertedInPlaceMigration,
        invalidRowIds: ['p1', 'p2'],
      },
      {
        rows: 'a row whose foreign key names a missing row',
        given: givenRowReferencingMissingCategory,
        invalidRowIds: ['p1'],
      },
    ])(
      'refuses the repair of a Draft with $rows',
      async ({ given, invalidRowIds }) => {
        const draft = await given();

        const plan = await planRepair(kit, draft, [PRODUCTS]);

        expect(plan.tables).toEqual([
          {
            tableId: PRODUCTS,
            outcome: 'rowsNeedMigration',
            invalidRows: {
              count: invalidRowIds.length,
              sampleRowIds: invalidRowIds,
            },
          },
        ]);
        expect(plan.renumbered).toEqual([]);
      },
    );

    it.each<HistoryCase>([
      {
        table: 'keeps its Head history',
        changeTags: keepTagsHistory,
        outcome: 'alreadyRepaired',
      },
      {
        table: 'lost its Head history prefix',
        changeTags: dropTagsHistory,
        outcome: 'ledgerInconsistent',
      },
      {
        table: 'lost its Head history prefix after a rename',
        changeTags: dropRenamedTagsHistory,
        outcome: 'ledgerInconsistent',
      },
    ])(
      'plans a recorded repair as $outcome while an unrelated table $table',
      async ({ changeTags, outcome }) => {
        const draft = await givenRecordedRepairBesideTags();
        await changeTags(draft);

        const plan = await planRepair(kit, draft, [PRODUCTS]);

        expect(plan.tables).toEqual([{ tableId: PRODUCTS, outcome }]);
      },
    );

    it.each<HistoryCase>([
      {
        table: 'keeps its Head history',
        changeTags: keepTagsHistory,
        outcome: 'repaired',
      },
      {
        table: 'lost its Head history prefix',
        changeTags: dropTagsHistory,
        outcome: 'ledgerInconsistent',
      },
      {
        table: 'lost its Head history prefix after a rename',
        changeTags: dropRenamedTagsHistory,
        outcome: 'ledgerInconsistent',
      },
    ])(
      'plans an unrecorded repair as $outcome while an unrelated table $table',
      async ({ changeTags, outcome }) => {
        const draft = await givenDamageBesideTags();
        await changeTags(draft);

        const plan = await planRepair(kit, draft, [PRODUCTS]);

        expect(plan.tables).toEqual([
          expect.objectContaining({ tableId: PRODUCTS, outcome }),
        ]);
      },
    );

    it('refuses the repair of a Draft that lacks a published migration', async () => {
      const draft = await givenUnpublishedInPlaceMigration(kit);
      await draft.dropFromDraftLedger('init', CATEGORIES);

      const plan = await planRepair(kit, draft, [PRODUCTS]);

      expect(plan.tables).toEqual([
        { tableId: PRODUCTS, outcome: 'ledgerInconsistent' },
      ]);
    });
  });

  describe('a table without a repairable damage', () => {
    it.each<UnrepairableCase>([
      {
        table: 'an undamaged table',
        given: () => givenCommittedCatalog(kit),
        tableId: CATEGORIES,
        outcome: 'notDamaged',
      },
      {
        table:
          'a table whose Draft-owned schema row an async migration rewrote',
        given: givenDraftOnlyDamage,
        tableId: PRODUCTS,
        outcome: 'draftOnlyDamage',
      },
      {
        table:
          'a table with a published migration that builds on an unrecorded change',
        given: givenUnreplayableHeadLedger,
        tableId: PRODUCTS,
        outcome: 'ledgerDoesNotReplay',
      },
      {
        table: 'a table without an init in the Head ledger',
        given: givenHeadTableWithoutInit,
        tableId: PRODUCTS,
        outcome: 'unledgered',
      },
      {
        table: 'a table whose id the Head ledger opens a second time',
        given: givenHeadTableRecreatedWithoutRecord,
        tableId: PRODUCTS,
        outcome: 'unledgered',
      },
      {
        table: 'a damaged table that the Draft removed',
        given: givenDamagedTableRemovedInDraft,
        tableId: PRODUCTS,
        outcome: 'needsDraftStructureRevert',
      },
    ])('reports $outcome for $table', async ({ given, tableId, outcome }) => {
      const draft = await given();

      const plan = await planRepair(kit, draft, [tableId]);

      expect(plan.tables).toEqual([{ tableId, outcome }]);
      expect(plan.renumbered).toEqual([]);
    });
  });

  describe('several damaged tables', () => {
    it('numbers two independent repairs consecutively after a published timestamp ahead of the clock and renumbers the pending migrations once', async () => {
      const draft = await givenTwoDamagedTablesAfterFuturePublication(kit);
      await draft.updateTable(CATEGORIES, addNote);

      const plan = await planRepair(kit, draft, [PRODUCTS, TAGS]);

      expect(plan.tables).toEqual([
        {
          tableId: PRODUCTS,
          outcome: 'repaired',
          migrationId: '2999-01-01T00:00:00.001Z',
          patches: addColor,
          removedPaths: [],
        },
        {
          tableId: TAGS,
          outcome: 'repaired',
          migrationId: '2999-01-01T00:00:00.002Z',
          patches: addTone,
          removedPaths: [],
        },
      ]);
      expect(plan.renumbered).toEqual([
        {
          previousId: '2999-01-01T00:00:00.001Z',
          id: '2999-01-01T00:00:00.003Z',
        },
      ]);
    });

    it('accepts the repairs of two tables that reference each other together', async () => {
      const draft = await givenReciprocalDamage(kit);

      const plan = await planRepair(kit, draft, [ALPHAS, BETAS]);

      expect(
        plan.tables.map(({ tableId, outcome }) => [tableId, outcome]),
      ).toEqual([
        [ALPHAS, 'repaired'],
        [BETAS, 'repaired'],
      ]);
      expect(plan.renumbered).toHaveLength(4);
    });

    it('blocks the repair of a table whose coupled damaged table is not requested', async () => {
      const draft = await givenReciprocalDamage(kit);

      const plan = await planRepair(kit, draft, [ALPHAS]);

      expect(plan.tables).toEqual([
        { tableId: ALPHAS, outcome: 'blockedByDependency', blockedBy: [BETAS] },
      ]);
      expect(plan.renumbered).toEqual([]);
    });

    it('repairs a table while an unrelated damaged table keeps failing and only has its pending migrations renumbered', async () => {
      const draft = await givenCatalogWithTags(kit);
      await completeAsyncMigrationInPlace(kit, draft, PRODUCTS, addColor);
      await completeAsyncMigrationInPlace(kit, draft, TAGS, addTone);
      await draft.updateTable(TAGS, [moveField(TONE, HUE)]);
      const [tagsPendingId] = await pendingMigrationIds(draft);

      const plan = await planRepair(kit, draft, [PRODUCTS]);

      expect(plan.tables).toEqual([
        expect.objectContaining({ tableId: PRODUCTS, outcome: 'repaired' }),
      ]);
      expect(plan.renumbered).toEqual([
        { previousId: tagsPendingId, id: expect.any(String) },
      ]);
    });

    it('rejects a repair whose new foreign key makes a pending removal of the named table fail', async () => {
      const draft = await givenRepairNamingRemovedTags();

      const plan = await planRepair(kit, draft, [NOTES]);

      expect(plan.tables).toEqual([
        { tableId: NOTES, outcome: 'needsDraftStructureRevert' },
      ]);
      expect(plan.renumbered).toEqual([]);
    });

    it('repairs a table while a pending removal it also blocks already failed before the repair', async () => {
      const draft = await givenRepairNamingTagsWhoseRemovalAlreadyFails();

      const plan = await planRepair(kit, draft, [NOTES]);

      expect(plan.tables).toEqual([
        expect.objectContaining({ tableId: NOTES, outcome: 'repaired' }),
      ]);
    });

    it('plans every damaged Head table when no table is named', async () => {
      const draft = await givenUnpublishedInPlaceMigration(kit);
      await recordLedgerRepair(draft, PRODUCTS, addColor);

      const plan = await planRepair(kit, draft);

      expect(plan.tables).toEqual([
        { tableId: PRODUCTS, outcome: 'alreadyRepaired' },
      ]);
    });
  });

  describe('planning', () => {
    it('writes nothing', async () => {
      const draft = await givenUnpublishedInPlaceMigration(kit);
      await draft.updateTable(CATEGORIES, addNote);
      const before = await branchContentsOf(kit, draft);

      const plan = await planRepair(kit, draft, [PRODUCTS]);

      expect(repairOf(plan, PRODUCTS).outcome).toBe('repaired');
      expect(await branchContentsOf(kit, draft)).toEqual(before);
    });

    it('fingerprints the rows it validated and the rows their foreign keys consulted', async () => {
      const draft = await givenUnpublishedInPlaceMigration(kit);
      const first = await planRepair(kit, draft, [PRODUCTS]);
      await writeRowWithoutValidation(kit, draft, PRODUCTS, 'p2', {
        code: 'changed',
        category: 'c1',
        color: '',
      });

      const second = await planRepair(kit, draft, [PRODUCTS]);

      expect(first.fingerprint).toEqual({
        validatedTables: [
          {
            tableVersionId: await draft.tableVersionId('draft', PRODUCTS),
            rowCount: 2,
            digest: expect.any(String),
          },
        ],
        consultedTables: [
          {
            tableVersionId: await draft.tableVersionId('draft', CATEGORIES),
            digest: expect.any(String),
          },
        ],
      });
      expect(second.fingerprint.validatedTables.at(0)?.digest).not.toBe(
        first.fingerprint.validatedTables.at(0)?.digest,
      );
      expect(second.fingerprint.consultedTables).toEqual(
        first.fingerprint.consultedTables,
      );
    });

    it.each<UnreferencingRowsCase>([
      { rows: 'no rows', noteRows: {} },
      {
        rows: 'rows with an empty reference array',
        noteRows: { n1: { text: 'a', tags: [] } },
      },
    ])(
      'leaves a declared foreign-key target out of the fingerprint when the validated table has $rows',
      async ({ noteRows }) => {
        const draft = await givenDamagedTaggedNotes(noteRows);

        const plan = await planRepair(kit, draft, [NOTES]);

        expect(plan.fingerprint).toEqual({
          validatedTables: [
            {
              tableVersionId: await draft.tableVersionId('draft', NOTES),
              rowCount: Object.keys(noteRows).length,
              digest: expect.any(String),
            },
          ],
          consultedTables: [],
        });
      },
    );

    it('fingerprints the row ids of a table that validated rows reference', async () => {
      const draft = await givenDamagedTaggedNotes({
        n1: { text: 'a', tags: ['t1'] },
      });
      await draft.createRows(TAGS, { t2: { label: 'y' } });
      const tagsVersionId = await draft.tableVersionId('draft', TAGS);
      const first = await planRepair(kit, draft, [NOTES]);
      await draft.createRows(TAGS, { t3: { label: 'z' } });

      const second = await planRepair(kit, draft, [NOTES]);

      const [firstTags] = first.fingerprint.consultedTables;
      const [secondTags] = second.fingerprint.consultedTables;
      expect(first.fingerprint.consultedTables).toEqual([
        { tableVersionId: tagsVersionId, digest: expect.any(String) },
      ]);
      expect(second.fingerprint.consultedTables).toHaveLength(1);
      expect(secondTags?.tableVersionId).toBe(tagsVersionId);
      expect(secondTags?.digest).not.toBe(firstTags?.digest);
    });

    it('refuses to plan while an async migration is active on the branch', async () => {
      const draft = await givenUnpublishedInPlaceMigration(kit);
      await givenActiveMigration(kit, draft, CATEGORIES);

      await expect(planRepair(kit, draft, [PRODUCTS])).rejects.toThrow(
        MigrationLockedException,
      );
    });

    it('rejects a table id that the Head does not have', async () => {
      const draft = await givenCommittedCatalog(kit);

      await expect(planRepair(kit, draft, ['missing'])).rejects.toThrow(
        new BadRequestException('Unknown Head table "missing"'),
      );
    });
  });

  async function givenDamageBesideTags(): Promise<ChangesScenario> {
    const draft = await givenCatalogWithTags(kit);
    await completeAsyncMigrationInPlace(kit, draft, PRODUCTS, addColor);

    return draft;
  }

  async function givenRecordedRepairBesideTags(): Promise<ChangesScenario> {
    const draft = await givenDamageBesideTags();
    await recordLedgerRepair(draft, PRODUCTS, addColor);

    return draft;
  }

  async function givenRepairNamingRemovedTags(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [TAGS]: { schema: tagSchema },
      [NOTES]: { schema: noteSchema },
    });
    await draft.removeTable(TAGS);
    await completeAsyncMigrationInPlace(kit, draft, NOTES, addTagReference);

    return draft;
  }

  async function givenRepairNamingTagsWhoseRemovalAlreadyFails(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [TAGS]: { schema: tagSchema },
      [NOTES]: { schema: noteSchema },
      [CARDS]: { schema: cardSchema },
    });
    await completeAsyncMigrationInPlace(kit, draft, CARDS, [
      removeField('tag'),
    ]);
    await draft.removeTable(TAGS);
    await completeAsyncMigrationInPlace(kit, draft, NOTES, addTagReference);

    return draft;
  }

  async function givenDamagedTaggedNotes(
    noteRows: Readonly<Record<string, InputJsonValue>>,
  ): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [TAGS]: tags,
      [NOTES]: { schema: taggedNoteSchema, rows: noteRows },
    });
    await completeAsyncMigrationInPlace(kit, draft, NOTES, addColor);

    return draft;
  }

  async function givenRevertedInPlaceMigration(): Promise<ChangesScenario> {
    const draft = await givenUnpublishedInPlaceMigration(kit);
    await draft.revertNatively();

    return draft;
  }

  async function givenRowReferencingMissingCategory(): Promise<ChangesScenario> {
    const draft = await givenUnpublishedInPlaceMigration(kit);
    await writeRowWithoutValidation(kit, draft, PRODUCTS, 'p1', {
      code: 'one',
      category: 'missing',
      color: '',
    });

    return draft;
  }

  async function givenDraftOnlyDamage(): Promise<ChangesScenario> {
    const draft = await givenCommittedCatalog(kit);
    await draft.updateTable(PRODUCTS, [addField('weight', num())]);
    await completeAsyncMigrationInPlace(kit, draft, PRODUCTS, addColor);

    return draft;
  }

  async function givenDamagedTableRemovedInDraft(): Promise<ChangesScenario> {
    const draft = await givenPublishedInPlaceMigration(kit);
    await draft.removeTable(PRODUCTS);

    return draft;
  }

  async function givenUnreplayableHeadLedger(): Promise<ChangesScenario> {
    const draft = await givenCommittedCatalog(kit);
    await completeAsyncMigrationInPlace(kit, draft, PRODUCTS, addColor);
    await draft.commit();
    await draft.updateTable(PRODUCTS, [moveField(COLOR, SHADE)]);
    await draft.commit();
    expect([
      ...(await replayedHeadLedgerOf(draft)).unreplayable.keys(),
    ]).toEqual([PRODUCTS]);

    return draft;
  }

  async function givenHeadTableWithoutInit(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [CATEGORIES]: categories,
    });
    await draft.createTable(PRODUCTS, productSchema);
    await draft.dropFromDraftLedger('init', PRODUCTS);
    await draft.commit();
    expect(await describedLedgerOf(draft, 'head')).toEqual(['init categories']);

    return draft;
  }

  async function givenHeadTableRecreatedWithoutRecord(): Promise<ChangesScenario> {
    const draft = await givenCommittedCatalog(kit);
    await draft.removeTable(PRODUCTS);
    await draft.dropFromDraftLedger('remove', PRODUCTS);
    await draft.commit();
    await draft.createTable(PRODUCTS, productSchema);
    await draft.commit();
    expect(await describedLedgerOf(draft, 'head')).toEqual([
      'init categories',
      'init products',
      'init products',
    ]);

    return draft;
  }
});

function keepTagsHistory(): Promise<void> {
  return Promise.resolve();
}

function dropTagsHistory(draft: ChangesScenario): Promise<void> {
  return draft.rewriteSchemaHistory(TAGS, []);
}

async function dropRenamedTagsHistory(draft: ChangesScenario): Promise<void> {
  await draft.renameTable(TAGS, LABELS);
  await draft.rewriteSchemaHistory(LABELS, []);
}
