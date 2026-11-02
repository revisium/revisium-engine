import { str } from '@revisium/schema-toolkit/mocks';
import objectHash from 'object-hash';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import { queueWriteBehindBranchFence } from 'src/features/draft/commands/handlers/__tests__/support/branch-write-fence';
import { MigrationLockedException } from 'src/features/migration/exceptions/migration-locked.exception';
import { ChangesScenario } from 'src/features/partial-changes/__tests__/support/changes-scenario';
import { completeAsyncMigrationInPlace } from 'src/features/partial-changes/__tests__/support/head-schema-damage';
import {
  expectCopiedInsteadOfEdited,
  givenReadonlyDraftVersion,
} from 'src/features/partial-changes/__tests__/support/readonly-draft-versions';
import {
  addField,
  moveField,
} from 'src/features/share/ledger-replay/__tests__/support/ledger-steps';
import type { HistoryPatches } from 'src/features/share/queries/impl';
import { SystemTables } from 'src/features/share/system-tables.consts';
import type { TableViewsData } from 'src/features/views/types';
import {
  addColor,
  addTone,
  ALPHAS,
  BETAS,
  CATEGORIES,
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
  TAGS,
  tagSchema,
  TONE,
} from './support/ledger-damage';
import {
  branchContentsOf,
  expectStrictlyAscending,
  givenActiveMigration,
  pendingMigrationIds,
  planRepair,
  writeRowWithoutValidation,
} from './support/ledger-repair-planning';
import {
  draftReplayFailureOf,
  expectHeadSyncedReplicaToReproduceTheHead,
  expectLedgerRowsPublishedAtTheirIds,
  expectNoHeadOrDraftDamage,
  observeEndpointNotifications,
  recordHistoriesWithEntry,
  recordRepairsWithoutTheirPatches,
  releaseHeldRepairs,
  renumberMigrationsWithoutTheirPatches,
  repairLedger,
  repairOfPlan,
  repairTwiceConcurrentlyPastTheirPlans,
  repairUntilPlanned,
  storedLedgerOf,
  storedColumnsOf,
  storedSchemaOf,
  tableOutcomesOf,
  tableRepairOf,
} from './support/ledger-repair-writing';

const LABELS = 'labels';
const SHADE = 'shade';
const HUE = 'hue';

const addNote = [addField('note', str())];
const addLabel = [addField('label', str())];
const addTagReference = [addField('tag', str({ foreignKey: TAGS }))];

const productViews: TableViewsData = {
  version: 1,
  defaultViewId: 'default',
  views: [{ id: 'default', name: 'Default' }],
};

const PENDING_NOTE = { note: 'kept by the repair' };
const MALFORMED_HISTORY_ENTRY = {
  hash: 'an entry without patches',
} as unknown as HistoryPatches;

interface MalformedHistoryCase {
  readonly entry: string;
  readonly given: () => Promise<ChangesScenario>;
}

interface StaleCase {
  readonly change: string;
  readonly changeDraft: (draft: ChangesScenario) => Promise<void>;
}

describe('Schema ledger repair', () => {
  let kit: PartialChangesTestKit;

  beforeAll(async () => {
    kit = await createPartialChangesTestKit();
  });

  afterEach(async () => {
    await releaseHeldRepairs();
    jest.restoreAllMocks();
    await kit.guard.verifyAndForget();
  });

  afterAll(async () => {
    await kit.close();
  });

  describe('a damaged Head table', () => {
    it('AM-50 records the repair of an unpublished async migration, which a native commit publishes and a Head-synced replica applies', async () => {
      const draft = await givenUnpublishedInPlaceMigration(kit);

      const repair = await repairLedger(kit, draft, { tableIds: [PRODUCTS] });

      expect(repair.tables).toEqual([
        {
          tableId: PRODUCTS,
          outcome: 'repaired',
          migrationId: expect.any(String),
          patches: addColor,
          removedPaths: [],
        },
      ]);
      await draft.commit();
      await expectNoHeadOrDraftDamage(kit, draft);
      await expectHeadSyncedReplicaToReproduceTheHead(kit, draft);
    });

    it('AM-51 records the repair of a published async migration, which a native commit publishes', async () => {
      const draft = await givenPublishedInPlaceMigration(kit);

      const repair = await repairLedger(kit, draft, { tableIds: [PRODUCTS] });

      expect(repair.tables).toEqual([
        expect.objectContaining({
          tableId: PRODUCTS,
          outcome: 'repaired',
          patches: addColor,
        }),
      ]);
      await draft.commit();
      await expectNoHeadOrDraftDamage(kit, draft);
    });

    it('AM-52 records the repair before the pending rename of the field it added, renumbers the rename once, and a replica applies both', async () => {
      const draft = await givenPublishedInPlaceMigration(kit);
      await draft.updateTable(PRODUCTS, [moveField(COLOR, SHADE)]);
      const [pendingId] = await pendingMigrationIds(draft);

      const repair = await repairLedger(kit, draft, { tableIds: [PRODUCTS] });

      const renumberedId = repair.renumbered.at(0)?.id;
      expect(repair.renumbered).toEqual([
        { previousId: pendingId, id: expect.any(String) },
      ]);
      expect(await pendingMigrationIds(draft)).toEqual([
        tableRepairOf(repair, PRODUCTS).migrationId,
        renumberedId,
      ]);
      expectStrictlyAscending([pendingId, renumberedId]);
      await draft.commit();
      await expectHeadSyncedReplicaToReproduceTheHead(kit, draft);
    });

    it('AM-54 records a repair whose new foreign key names a table that a pending migration renames, and a replica applies it', async () => {
      const draft = await ChangesScenario.committed(kit, {
        [TAGS]: { schema: tagSchema },
        [NOTES]: { schema: noteSchema },
      });
      await completeAsyncMigrationInPlace(kit, draft, NOTES, addTagReference);
      await draft.renameTable(TAGS, LABELS);

      const repair = await repairLedger(kit, draft, { tableIds: [NOTES] });

      expect(repair.tables).toEqual([
        expect.objectContaining({
          tableId: NOTES,
          outcome: 'repaired',
          patches: addTagReference,
        }),
      ]);
      await draft.commit();
      await expectHeadSyncedReplicaToReproduceTheHead(kit, draft);
    });
  });

  describe('a Draft ledger the repair refuses', () => {
    it('refuses a Draft ledger whose pending rows carry each other’s migration ids as ledgerInconsistent and writes nothing', async () => {
      const draft = await givenUnpublishedInPlaceMigration(kit);
      await draft.updateTable(CATEGORIES, addNote);
      await draft.updateTable(CATEGORIES, addLabel);
      const [firstId, secondId] = await pendingMigrationIds(draft);
      await draft.exchangeMigrationIds(firstId ?? '', secondId ?? '');
      const before = await branchContentsOf(kit, draft);

      const repair = await repairLedger(kit, draft, { tableIds: [PRODUCTS] });

      expect(repair.tables).toEqual([
        { tableId: PRODUCTS, outcome: 'ledgerInconsistent' },
      ]);
      expect(await branchContentsOf(kit, draft)).toEqual(before);
    });

    it.each<MalformedHistoryCase>([
      {
        entry: 'an inherited Head history entry',
        given: givenMalformedInheritedHistory,
      },
      {
        entry: 'a pending Draft history entry',
        given: givenMalformedPendingHistory,
      },
    ])(
      'refuses a table whose schema history has $entry that native writes refuse as ledgerInconsistent and writes nothing',
      async ({ given }) => {
        const draft = await given();
        const before = await branchContentsOf(kit, draft);

        const repair = await repairLedger(kit, draft, { tableIds: [PRODUCTS] });

        expect(repair.tables).toEqual([
          { tableId: PRODUCTS, outcome: 'ledgerInconsistent' },
        ]);
        expect(await branchContentsOf(kit, draft)).toEqual(before);
      },
    );
  });

  describe('what the repair writes', () => {
    it('records the ledger row published at its id and the schema history as the Head history, the repair entry and the pending entries, keeping the Draft schema', async () => {
      const draft = await givenPublishedInPlaceMigration(kit);
      await draft.updateTable(PRODUCTS, [moveField(COLOR, SHADE)]);
      const head = await storedSchemaOf(draft, 'head', PRODUCTS);
      const before = await storedSchemaOf(draft, 'draft', PRODUCTS);

      const repair = await repairLedger(kit, draft, { tableIds: [PRODUCTS] });

      const migrationId = tableRepairOf(repair, PRODUCTS).migrationId ?? '';
      const repairEntry = { patches: addColor, hash: objectHash(head.schema) };
      expect(
        await draft.row('draft', SystemTables.Migration, migrationId),
      ).toMatchObject({
        data: {
          changeType: 'update',
          id: migrationId,
          tableId: PRODUCTS,
          ...repairEntry,
        },
        publishedAt: new Date(migrationId),
      });
      expect(await storedSchemaOf(draft, 'draft', PRODUCTS)).toEqual({
        schema: before.schema,
        history: [
          ...head.history,
          { ...repairEntry, date: expect.any(String) },
          ...before.history.slice(head.history.length),
        ],
      });
      await expectLedgerRowsPublishedAtTheirIds(draft);
    });

    it('renumbers a pending migration into a new row version that keeps its creation, metadata and schema hash and hashes its renumbered data natively', async () => {
      const draft = await givenPublishedInPlaceMigration(kit);
      await draft.updateTable(PRODUCTS, [moveField(COLOR, SHADE)]);
      const [pendingId = ''] = await pendingMigrationIds(draft);
      await draft.writeRowColumns(SystemTables.Migration, pendingId, {
        meta: PENDING_NOTE,
      });
      const source = await draft.row(
        'draft',
        SystemTables.Migration,
        pendingId,
      );

      const repair = await repairLedger(kit, draft, { tableIds: [PRODUCTS] });

      const renumberedId = repair.renumbered.at(0)?.id ?? '';
      const renumbered = await draft.row(
        'draft',
        SystemTables.Migration,
        renumberedId,
      );
      const data = { ...(source.data as object), id: renumberedId };
      expect(renumbered.versionId).not.toBe(source.versionId);
      expect(storedColumnsOf(renumbered)).toEqual({
        ...storedColumnsOf(source),
        id: renumberedId,
        data,
        hash: objectHash(data),
        publishedAt: new Date(renumberedId),
      });
    });

    it('renumbers the pending migrations of a readonly Draft migration table version in a copy instead of editing it in place', async () => {
      const draft = await givenPublishedInPlaceMigration(kit);
      await draft.updateTable(PRODUCTS, [moveField(COLOR, SHADE)]);
      const migrationTable = await givenReadonlyDraftVersion(
        kit,
        draft,
        SystemTables.Migration,
      );

      const repair = await repairLedger(kit, draft, { tableIds: [PRODUCTS] });

      expect(repair.renumbered).toHaveLength(1);
      await expectCopiedInsteadOfEdited(kit, draft, migrationTable);
    });

    it('rolls back and raises when the stored Draft ledger no longer reproduces a table that it reproduced before the repair', async () => {
      const draft = await givenUnpublishedInPlaceMigration(kit);
      await draft.updateTable(CATEGORIES, addNote);
      const before = await branchContentsOf(kit, draft);
      renumberMigrationsWithoutTheirPatches(kit);

      await expect(
        repairLedger(kit, draft, { tableIds: [PRODUCTS] }),
      ).rejects.toThrow(`does not reproduce the Draft schema of ${CATEGORIES}`);
      expect(await branchContentsOf(kit, draft)).toEqual(before);
    });

    it('rolls back and raises when a stored schema history is one that native writes refuse', async () => {
      const draft = await givenUnpublishedInPlaceMigration(kit);
      const before = await branchContentsOf(kit, draft);
      recordHistoriesWithEntry(kit, MALFORMED_HISTORY_ENTRY);

      await expect(
        repairLedger(kit, draft, { tableIds: [PRODUCTS] }),
      ).rejects.toThrow(
        `stores a schema history of ${PRODUCTS} that native writes refuse`,
      );
      expect(await branchContentsOf(kit, draft)).toEqual(before);
    });

    it('writes Draft-owned versions of the shared schema row and leaves the views row shared with the Head', async () => {
      const draft = await givenInPlaceMigrationOfTableWithViews();

      await repairLedger(kit, draft, { tableIds: [PRODUCTS] });

      expect(await draft.hasDraftVersion(SystemTables.Schema, PRODUCTS)).toBe(
        true,
      );
      expect(await draft.tableVersionId('draft', SystemTables.Views)).toBe(
        await draft.tableVersionId('head', SystemTables.Views),
      );
    });

    it('notifies the Draft endpoints once, after the repair committed', async () => {
      const draft = await givenUnpublishedInPlaceMigration(kit);
      const notifications = observeEndpointNotifications(kit, draft);

      const repair = await repairLedger(kit, draft, { tableIds: [PRODUCTS] });

      expect(notifications).toEqual([
        {
          revisionId: repair.draftRevisionId,
          pendingMigrationIds: [tableRepairOf(repair, PRODUCTS).migrationId],
        },
      ]);
    });

    it('rolls back and raises when the stored Draft ledger does not reproduce a repaired Draft schema', async () => {
      const draft = await givenUnpublishedInPlaceMigration(kit);
      const before = await branchContentsOf(kit, draft);
      const notifications = observeEndpointNotifications(kit, draft);
      recordRepairsWithoutTheirPatches(kit);

      await expect(
        repairLedger(kit, draft, { tableIds: [PRODUCTS] }),
      ).rejects.toThrow(`does not reproduce the Draft schema of ${PRODUCTS}`);
      expect(await branchContentsOf(kit, draft)).toEqual(before);
      expect(notifications).toEqual([]);
    });

    it('writes behind the branch write fence, taken shared', async () => {
      const draft = await givenUnpublishedInPlaceMigration(kit);

      const queued = await queueWriteBehindBranchFence(
        { prismaService: kit.prisma },
        draft.branchId,
        () => repairLedger(kit, draft, { tableIds: [PRODUCTS] }),
      );
      await queued.releaseFence();

      await expect(queued.writing).resolves.toMatchObject({
        tables: [{ tableId: PRODUCTS, outcome: 'repaired' }],
      });
    });
  });

  describe('several damaged tables', () => {
    it('AM-53 records two independent repairs under consecutive ids after a published timestamp ahead of the clock and renumbers the pending migrations once', async () => {
      const draft = await givenTwoDamagedTablesAfterFuturePublication(kit);
      await draft.updateTable(CATEGORIES, addNote);

      await repairLedger(kit, draft, { tableIds: [PRODUCTS, TAGS] });

      const ledger = await storedLedgerOf(draft, 'draft');
      expect(
        ledger.slice(-3).map(({ id, changeType, tableId }) => ({
          id,
          changeType,
          tableId,
        })),
      ).toEqual([
        {
          id: '2999-01-01T00:00:00.001Z',
          changeType: 'update',
          tableId: PRODUCTS,
        },
        { id: '2999-01-01T00:00:00.002Z', changeType: 'update', tableId: TAGS },
        {
          id: '2999-01-01T00:00:00.003Z',
          changeType: 'update',
          tableId: CATEGORIES,
        },
      ]);
      await expectLedgerRowsPublishedAtTheirIds(draft);
    });

    it('AM-62 repairs two damaged tables that reference each other in one plan, and a replica applies the result', async () => {
      const draft = await givenReciprocalDamage(kit);

      const repair = await repairLedger(kit, draft, {
        tableIds: [ALPHAS, BETAS],
      });

      expect(
        repair.tables.map(({ tableId, outcome }) => [tableId, outcome]),
      ).toEqual([
        [ALPHAS, 'repaired'],
        [BETAS, 'repaired'],
      ]);
      await draft.commit();
      await expectNoHeadOrDraftDamage(kit, draft);
      await expectHeadSyncedReplicaToReproduceTheHead(kit, draft);
    });

    it('AM-62 writes nothing when only one of two damaged tables that reference each other is requested', async () => {
      const draft = await givenReciprocalDamage(kit);
      const before = await branchContentsOf(kit, draft);

      const repair = await repairLedger(kit, draft, { tableIds: [ALPHAS] });

      expect(repair.tables).toEqual([
        { tableId: ALPHAS, outcome: 'blockedByDependency', blockedBy: [BETAS] },
      ]);
      expect(await branchContentsOf(kit, draft)).toEqual(before);
    });

    it('AM-63 repairs a table while an unrelated damaged table only has its pending migrations renumbered and keeps failing as before', async () => {
      const draft = await givenCatalogWithTags(kit);
      await completeAsyncMigrationInPlace(kit, draft, PRODUCTS, addColor);
      await completeAsyncMigrationInPlace(kit, draft, TAGS, addTone);
      await draft.updateTable(TAGS, [moveField(TONE, HUE)]);
      const [tagsPendingId] = await pendingMigrationIds(draft);
      const tagsFailure = await draftReplayFailureOf(draft, TAGS);

      const repair = await repairLedger(kit, draft, { tableIds: [PRODUCTS] });

      expect(repair.tables).toEqual([
        expect.objectContaining({ tableId: PRODUCTS, outcome: 'repaired' }),
      ]);
      expect(repair.renumbered).toEqual([
        { previousId: tagsPendingId, id: expect.any(String) },
      ]);
      expect(tagsFailure).toMatchObject({ migrationId: tagsPendingId });
      expect(await draftReplayFailureOf(draft, TAGS)).toEqual({
        ...tagsFailure,
        migrationId: repair.renumbered.at(0)?.id,
      });
    });
  });

  describe('freshness and concurrency', () => {
    it.each<StaleCase>([
      {
        change: 'a low-level row update writes an invalid row',
        changeDraft: (draft) =>
          writeRowWithoutValidation(kit, draft, PRODUCTS, 'p2', {
            code: 'changed',
            category: 'c1',
          }),
      },
      {
        change: 'a native row update',
        changeDraft: (draft) =>
          draft.updateRow(PRODUCTS, 'p1', {
            code: 'changed',
            category: 'c1',
            color: 'red',
          }),
      },
      {
        change: 'a native schema update',
        changeDraft: (draft) => draft.updateTable(CATEGORIES, addNote),
      },
      { change: 'a native commit', changeDraft: (draft) => draft.commit() },
      {
        change: 'a native revert',
        changeDraft: (draft) => draft.revertNatively(),
      },
    ])(
      'AM-57 finds the plan stale and writes nothing when $change between planning and writing',
      async ({ changeDraft }) => {
        const draft = await givenUnpublishedInPlaceMigration(kit);
        const repair = await repairUntilPlanned(kit, draft, {
          tableIds: [PRODUCTS],
        });
        await changeDraft(draft);
        const before = await branchContentsOf(kit, draft);
        const notifications = observeEndpointNotifications(kit, draft);

        const result = await repair.resume();

        expect(result.tables).toEqual([
          { tableId: PRODUCTS, outcome: 'stale' },
        ]);
        expect(result.renumbered).toEqual([]);
        expect(await branchContentsOf(kit, draft)).toEqual(before);
        expect(notifications).toEqual([]);
      },
    );

    it('AM-57 finds the plan stale and keeps the concurrent edit when only the metadata of a pending migration row changes between planning and writing', async () => {
      const draft = await givenUnpublishedInPlaceMigration(kit);
      await draft.updateTable(CATEGORIES, addNote);
      const [pendingId = ''] = await pendingMigrationIds(draft);
      const repair = await repairUntilPlanned(kit, draft, {
        tableIds: [PRODUCTS],
      });
      await draft.writeRowColumns(SystemTables.Migration, pendingId, {
        meta: PENDING_NOTE,
      });
      const before = await branchContentsOf(kit, draft);

      const result = await repair.resume();

      expect(result.tables).toEqual([{ tableId: PRODUCTS, outcome: 'stale' }]);
      expect(await branchContentsOf(kit, draft)).toEqual(before);
      expect(
        (await draft.row('draft', SystemTables.Migration, pendingId)).meta,
      ).toEqual(PENDING_NOTE);
    });

    it('refuses to write when an async migration starts between planning and writing', async () => {
      const draft = await givenUnpublishedInPlaceMigration(kit);
      const repair = await repairUntilPlanned(kit, draft, {
        tableIds: [PRODUCTS],
      });
      await givenActiveMigration(kit, draft, CATEGORIES);
      const before = await branchContentsOf(kit, draft);

      await expect(repair.resume()).rejects.toThrow(MigrationLockedException);
      expect(await branchContentsOf(kit, draft)).toEqual(before);
    });

    it('AM-59 finds the Draft already repaired on a second run and, once a native commit publishes the repair, not damaged', async () => {
      const draft = await givenUnpublishedInPlaceMigration(kit);
      await repairLedger(kit, draft, { tableIds: [PRODUCTS] });
      const before = await branchContentsOf(kit, draft);

      const second = await repairLedger(kit, draft, { tableIds: [PRODUCTS] });

      expect(second.tables).toEqual([
        { tableId: PRODUCTS, outcome: 'alreadyRepaired' },
      ]);
      expect(await branchContentsOf(kit, draft)).toEqual(before);
      await draft.commit();
      await expect(
        repairLedger(kit, draft, { tableIds: [PRODUCTS] }),
      ).resolves.toMatchObject({
        tables: [{ tableId: PRODUCTS, outcome: 'notDamaged' }],
      });
    });

    it('AM-59 lets exactly one of two concurrent repairs write while the other finds its plan stale', async () => {
      const draft = await givenUnpublishedInPlaceMigration(kit);

      const results = await repairTwiceConcurrentlyPastTheirPlans(kit, draft, {
        tableIds: [PRODUCTS],
      });

      expect(tableOutcomesOf(results, PRODUCTS)).toEqual(['repaired', 'stale']);
      expect(await pendingMigrationIds(draft)).toHaveLength(1);
    });
  });

  describe('a dry run', () => {
    it('AM-61 returns the plan that a real run then writes, and writes nothing', async () => {
      const draft = await givenTwoDamagedTablesAfterFuturePublication(kit);
      await draft.updateTable(CATEGORIES, addNote);
      const plan = await planRepair(kit, draft, [PRODUCTS, TAGS]);
      const before = await branchContentsOf(kit, draft);

      const dryRun = await repairLedger(kit, draft, {
        tableIds: [PRODUCTS, TAGS],
        dryRun: true,
      });

      expect(dryRun).toEqual(repairOfPlan(plan, true));
      expect(await branchContentsOf(kit, draft)).toEqual(before);
      await expect(
        repairLedger(kit, draft, { tableIds: [PRODUCTS, TAGS] }),
      ).resolves.toEqual(repairOfPlan(plan, false));
    });

    it('AM-61 refuses a dry run and a real run while an async migration is active on the branch', async () => {
      const draft = await givenUnpublishedInPlaceMigration(kit);
      await givenActiveMigration(kit, draft, CATEGORIES);

      await expect(
        repairLedger(kit, draft, { tableIds: [PRODUCTS], dryRun: true }),
      ).rejects.toThrow(MigrationLockedException);
      await expect(
        repairLedger(kit, draft, { tableIds: [PRODUCTS] }),
      ).rejects.toThrow(MigrationLockedException);
    });
  });

  async function givenMalformedInheritedHistory(): Promise<ChangesScenario> {
    const draft = await givenCommittedCatalog(kit);
    const { history } = await storedSchemaOf(draft, 'draft', PRODUCTS);
    await draft.rewriteSchemaHistory(PRODUCTS, [
      ...history,
      MALFORMED_HISTORY_ENTRY,
    ]);
    await draft.commit();
    await completeAsyncMigrationInPlace(kit, draft, PRODUCTS, addColor);

    return draft;
  }

  async function givenMalformedPendingHistory(): Promise<ChangesScenario> {
    const draft = await givenUnpublishedInPlaceMigration(kit);
    const { history } = await storedSchemaOf(draft, 'head', PRODUCTS);
    await draft.rewriteSchemaHistory(PRODUCTS, [
      ...history,
      MALFORMED_HISTORY_ENTRY,
    ]);

    return draft;
  }

  async function givenInPlaceMigrationOfTableWithViews(): Promise<ChangesScenario> {
    const draft = await givenCommittedCatalog(kit);
    await draft.updateViews(PRODUCTS, productViews);
    await draft.commit();
    await completeAsyncMigrationInPlace(kit, draft, PRODUCTS, addColor);

    return draft;
  }
});
