import { BadRequestException } from '@nestjs/common';
import { arr, num, obj, str } from '@revisium/schema-toolkit/mocks';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import { MigrationLockedException } from 'src/features/migration/exceptions/migration-locked.exception';
import type { RepairOutcome } from 'src/features/migration/queries/impl/plan-schema-ledger-repair.query';
import type { InputJsonValue } from 'src/engine-prisma-types';
import {
  ChangesScenario,
  type TableFixture,
} from 'src/features/partial-changes/__tests__/support/changes-scenario';
import {
  completeAsyncMigrationInPlace,
  describedLedgerOf,
  recordLedgerRepair,
  replayedHeadLedgerOf,
} from 'src/features/partial-changes/__tests__/support/head-schema-damage';
import {
  addField,
  moveField,
} from 'src/features/share/ledger-replay/__tests__/support/ledger-steps';
import {
  branchContentsOf,
  givenActiveMigration,
  planRepair,
  writeRowWithoutValidation,
} from './support/ledger-repair-planning';

const CATEGORIES = 'categories';
const PRODUCTS = 'products';
const TAGS = 'tags';
const LABELS = 'labels';
const NOTES = 'notes';
const COLOR = 'color';
const SHADE = 'shade';

const categorySchema = obj({ title: str() });
const productSchema = obj({
  code: str(),
  category: str({ foreignKey: CATEGORIES }),
});

const tagSchema = obj({ label: str() });
const taggedNoteSchema = obj({
  text: str(),
  tags: arr(str({ foreignKey: TAGS })),
});

const categories: TableFixture = {
  schema: categorySchema,
  rows: { c1: { title: 'first' } },
};
const products: TableFixture = {
  schema: productSchema,
  rows: {
    p1: { code: 'one', category: 'c1' },
    p2: { code: 'two', category: 'c1' },
  },
};

const tags: TableFixture = { schema: tagSchema, rows: { t1: { label: 'x' } } };

const addColor = [addField(COLOR, str())];
const addNote = [addField('note', str())];

interface UnrepairableCase {
  readonly table: string;
  readonly given: () => Promise<ChangesScenario>;
  readonly tableId: string;
  readonly outcome: RepairOutcome;
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
    it('finds a Draft that already records the repair', async () => {
      const draft = await givenUnpublishedInPlaceMigration();
      await recordLedgerRepair(draft, PRODUCTS, addColor);

      const plan = await planRepair(kit, draft, [PRODUCTS]);

      expect(plan.tables).toEqual([
        { tableId: PRODUCTS, outcome: 'alreadyRepaired' },
      ]);
      expect(plan.renumbered).toEqual([]);
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
        changeTags: () => Promise.resolve(),
        outcome: 'alreadyRepaired',
      },
      {
        table: 'lost its Head history prefix',
        changeTags: (draft) => draft.rewriteSchemaHistory(TAGS, []),
        outcome: 'ledgerInconsistent',
      },
      {
        table: 'lost its Head history prefix after a rename',
        changeTags: async (draft) => {
          await draft.renameTable(TAGS, LABELS);
          await draft.rewriteSchemaHistory(LABELS, []);
        },
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

    it('refuses the repair of a Draft that lacks a published migration', async () => {
      const draft = await givenUnpublishedInPlaceMigration();
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
        given: givenCommittedCatalog,
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
    ])('reports $outcome for $table', async ({ given, tableId, outcome }) => {
      const draft = await given();

      const plan = await planRepair(kit, draft, [tableId]);

      expect(plan.tables).toEqual([{ tableId, outcome }]);
      expect(plan.renumbered).toEqual([]);
    });
  });

  describe('several damaged tables', () => {
    it('plans every damaged Head table when no table is named', async () => {
      const draft = await givenUnpublishedInPlaceMigration();
      await recordLedgerRepair(draft, PRODUCTS, addColor);

      const plan = await planRepair(kit, draft);

      expect(plan.tables).toEqual([
        { tableId: PRODUCTS, outcome: 'alreadyRepaired' },
      ]);
    });
  });

  describe('planning', () => {
    it('writes nothing', async () => {
      const draft = await givenUnpublishedInPlaceMigration();
      await draft.updateTable(CATEGORIES, addNote);
      const before = await branchContentsOf(kit, draft);

      await planRepair(kit, draft, [PRODUCTS]);

      expect(await branchContentsOf(kit, draft)).toEqual(before);
    });

    it('fingerprints the rows it validated and the rows their foreign keys consulted', async () => {
      const draft = await givenUnpublishedInPlaceMigration();
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
      const draft = await givenUnpublishedInPlaceMigration();
      await givenActiveMigration(kit, draft, CATEGORIES);

      await expect(planRepair(kit, draft, [PRODUCTS])).rejects.toThrow(
        MigrationLockedException,
      );
    });

    it('rejects a table id that the Head does not have', async () => {
      const draft = await givenCommittedCatalog();

      await expect(planRepair(kit, draft, ['missing'])).rejects.toThrow(
        new BadRequestException('Unknown Head table "missing"'),
      );
    });
  });

  function givenCommittedCatalog(): Promise<ChangesScenario> {
    return ChangesScenario.committed(kit, {
      [CATEGORIES]: categories,
      [PRODUCTS]: products,
    });
  }

  function givenCatalogWithTags(): Promise<ChangesScenario> {
    return ChangesScenario.committed(kit, {
      [CATEGORIES]: categories,
      [PRODUCTS]: products,
      [TAGS]: tags,
    });
  }

  async function givenRecordedRepairBesideTags(): Promise<ChangesScenario> {
    const draft = await givenCatalogWithTags();
    await completeAsyncMigrationInPlace(kit, draft, PRODUCTS, addColor);
    await recordLedgerRepair(draft, PRODUCTS, addColor);

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

  async function givenUnpublishedInPlaceMigration(): Promise<ChangesScenario> {
    const draft = await givenCommittedCatalog();
    await completeAsyncMigrationInPlace(kit, draft, PRODUCTS, addColor);

    return draft;
  }

  async function givenRevertedInPlaceMigration(): Promise<ChangesScenario> {
    const draft = await givenUnpublishedInPlaceMigration();
    await draft.revertNatively();

    return draft;
  }

  async function givenRowReferencingMissingCategory(): Promise<ChangesScenario> {
    const draft = await givenUnpublishedInPlaceMigration();
    await writeRowWithoutValidation(kit, draft, PRODUCTS, 'p1', {
      code: 'one',
      category: 'missing',
      color: '',
    });

    return draft;
  }

  async function givenDraftOnlyDamage(): Promise<ChangesScenario> {
    const draft = await givenCommittedCatalog();
    await draft.updateTable(PRODUCTS, [addField('weight', num())]);
    await completeAsyncMigrationInPlace(kit, draft, PRODUCTS, addColor);

    return draft;
  }

  async function givenUnreplayableHeadLedger(): Promise<ChangesScenario> {
    const draft = await givenCommittedCatalog();
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
    const draft = await givenCommittedCatalog();
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
