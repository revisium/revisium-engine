import { obj, str } from '@revisium/schema-toolkit/mocks';
import type { Migration } from '@revisium/schema-toolkit/types';
import objectHash from 'object-hash';
import { givenActiveMigration } from 'src/__tests__/fixtures/active-migration';
import { branchContentsOf } from 'src/__tests__/fixtures/branch-content';
import { BranchScenario } from 'src/__tests__/fixtures/branch-scenario';
import { HeadSyncedReplica } from 'src/__tests__/fixtures/ledger-replicas';
import { addField } from 'src/__tests__/fixtures/ledger-steps';
import {
  describedLedgerOf,
  expectStrictlyAscending,
  ledgerIdsOf,
} from 'src/__tests__/fixtures/stored-ledger';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import type { SchemaLedgerBackfill } from 'src/features/migration/commands/impl/backfill-schema-ledger.command';
import { MigrationLockedException } from 'src/features/migration/exceptions/migration-locked.exception';
import { LedgerBackfillPlanService } from 'src/features/migration/ledger-backfill/ledger-backfill-plan.service';
import { queueWriteBehindBranchFence } from 'src/features/draft/commands/handlers/__tests__/support/branch-write-fence';
import { AssembledVersionWriter } from 'src/features/draft-revision/services';
import { DraftRevisionApiService } from 'src/features/draft-revision/draft-revision-api.service';
import { JsonSchemaValidatorService } from 'src/features/share/json-schema-validator.service';
import { publishedAtOf } from 'src/features/share/ledger/native-migration-id';
import { SystemTables } from 'src/features/share/system-tables.consts';
import {
  backfillLedger,
  backfillWhileNativeWriteLands,
  commitHeadSchema,
  entriesOf,
  initEntry,
  migrationTableOf,
  observeEndpointNotifications,
  planBackfill,
  revisionCommentOf,
  revisionsOf,
  withoutIds,
} from './support/ledger-backfill';
import {
  createBranchFromHead,
  findingAt,
  findingOf,
  hashOf,
  scanBranch,
  schemaRowHashOf,
} from './support/ledger-scan';
import {
  CATEGORIES,
  categories,
  categorySchema,
  givenCommittedCatalog,
  noteSchema,
  NOTES,
  PRODUCTS,
  products,
  productSchema,
} from './support/ledger-damage';

const AUTHORS = 'authors';
const BOOKS = 'books';
const OTHER_BRANCH = 'other';
const LATER_BRANCH = 'later';
const DEFAULT_COMMENT = 'Backfill the schema ledger';

const authorSchema = obj({ name: str() });
const bookSchema = obj({ author: str({ foreignKey: AUTHORS }), title: str() });
const addNote = [addField('note', str())];

describe('Schema ledger backfill', () => {
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

  describe('what a run writes', () => {
    it('BF-01 commits a migration table with an init of every Head table, which the new Head and the new Draft link as one readonly version, and keeps the Draft row changes', async () => {
      const draft = await givenCatalogWithEditedRows();
      const before = await revisionsOf(draft);
      const headRows = await rowDataOf(draft, 'head', CATEGORIES, PRODUCTS);
      const draftRows = await rowDataOf(draft, 'draft', CATEGORIES, PRODUCTS);

      const backfill = await backfillLedger(kit, draft);

      expect(backfill).toEqual({
        status: 'backfilled',
        previousHeadRevisionId: before.headRevisionId,
        headRevisionId: before.draftRevisionId,
        draftRevisionId: await draft.revisionId('draft'),
        entries: [
          initEntry(CATEGORIES, categorySchema),
          initEntry(PRODUCTS, productSchema),
        ],
      });
      expect(await describedLedgerOf(draft, 'head')).toEqual([
        `init ${CATEGORIES}`,
        `init ${PRODUCTS}`,
      ]);
      const headLedger = await migrationTableOf(kit, draft, 'head');
      expect(headLedger).toEqual({
        versionId: expect.any(String),
        readonly: true,
      });
      expect(await migrationTableOf(kit, draft, 'draft')).toEqual(headLedger);
      const ledgerRows = await draft.rows('head', SystemTables.Migration);
      expect(ledgerRows.map(({ readonly }) => readonly)).toEqual([true, true]);
      expect(await rowDataOf(draft, 'head', CATEGORIES, PRODUCTS)).toEqual(
        headRows,
      );
      expect(await rowDataOf(draft, 'draft', CATEGORIES, PRODUCTS)).toEqual(
        draftRows,
      );
      expect(await refusedTablesOf(draft)).toEqual([]);
      await expect(
        kit.partialChangesApi.commitChanges({
          branch: draft.branch,
          selection: { rows: [{ tableId: CATEGORIES, rowId: 'c1' }] },
        }),
      ).resolves.toMatchObject({ status: 'applied' });
    });

    it('stores each entry whole, as a native migration row: under its id, published at it, hashed natively, with the migrations schema hash', async () => {
      const draft = await givenCatalogWithoutLedger();

      const backfill = await backfillLedger(kit, draft);

      const [categoriesInit, productsInit] = entriesOf(backfill);
      const rows = await draft.rows('head', SystemTables.Migration);
      const migrations: Migration[] = [
        { ...categoriesInit, schema: categorySchema } as Migration,
        { ...productsInit, schema: productSchema } as Migration,
      ];
      expect(
        rows.map(({ id, data, hash, schemaHash, publishedAt, meta }) => ({
          id,
          data,
          hash,
          schemaHash,
          publishedAt: publishedAt.toISOString(),
          meta,
        })),
      ).toEqual(
        migrations.map((migration) => ({
          id: migration.id,
          data: migration,
          hash: objectHash(migration),
          schemaHash: kit.module.get(JsonSchemaValidatorService)
            .tableSchemaHash,
          publishedAt: publishedAtOf(migration.id).toISOString(),
          meta: {},
        })),
      );
    });

    it('BF-03 BF-11 writes a split cycle that a fresh Head-synced replica applies, reproducing the Head schemas and the stored ledger', async () => {
      const draft = await givenAuthorsAndBooksReferencingEachOther();

      const backfill = await backfillLedger(kit, draft);

      expect(describedEntriesOf(backfill)).toEqual([
        `init ${AUTHORS}`,
        `init ${BOOKS}`,
        `update ${AUTHORS}`,
      ]);
      const replica = await HeadSyncedReplica.of(kit);
      await replica.syncWith(draft);
      await replica.expectSchemasOf(draft);
      await replica.expectLedgerOf(draft);
    });

    it('BF-16 writes a cycle once a native update has normalised one of its tables, after refusing it before', async () => {
      const draft = await givenCycleWithoutSurvivor();
      await expect(backfillLedger(kit, draft)).resolves.toMatchObject({
        status: 'refused',
        refusal: { code: 'schemaNotReproducible', tableIds: ['a', 'b'] },
      });
      await draft.updateTable('a', addNote);
      await draft.commit();

      const backfill = await backfillLedger(kit, draft);

      expect(describedEntriesOf(backfill)).toEqual([
        'init a',
        'init b',
        'update a',
      ]);
      expect(await refusedTablesOf(draft)).toEqual([]);
    });

    it('BF-17 gives a Head without user tables an empty migration table, in which a later createTable records its init', async () => {
      const draft = await BranchScenario.committedWithoutLedger(kit, {});

      const backfill = await backfillLedger(kit, draft);

      expect(backfill).toMatchObject({ status: 'backfilled', entries: [] });
      expect(await migrationTableOf(kit, draft, 'draft')).toEqual(
        await migrationTableOf(kit, draft, 'head'),
      );
      await draft.createTable(NOTES, noteSchema);
      expect(await describedLedgerOf(draft, 'draft')).toEqual([
        `init ${NOTES}`,
      ]);
    });

    it.each([
      { comment: undefined, stored: DEFAULT_COMMENT },
      { comment: null, stored: DEFAULT_COMMENT },
      {
        comment: 'Give the catalog its ledger',
        stored: 'Give the catalog its ledger',
      },
    ])(
      'BF-14 commits with comment $comment as $stored',
      async ({ comment, stored }) => {
        const draft = await givenCatalogWithoutLedger();

        const backfill = await backfillLedger(kit, draft, { comment });

        expectBackfilled(backfill);
        expect(await revisionCommentOf(kit, backfill.headRevisionId)).toBe(
          stored,
        );
      },
    );

    it('BF-14 runs with dryRun given as null as it runs without it', async () => {
      const draft = await givenCatalogWithoutLedger();

      const backfill = await backfillLedger(kit, draft, { dryRun: null });

      expect(backfill).toMatchObject({ status: 'backfilled' });
    });
  });

  describe('a run that writes nothing', () => {
    it('BF-05 needs nothing on a second run, nor on a branch that always had a ledger', async () => {
      const draft = await givenCatalogWithoutLedger();
      await backfillLedger(kit, draft);
      const backfilled = await branchContentsOf(kit, draft);
      const ledgered = await givenCommittedCatalog(kit);

      const second = await backfillLedger(kit, draft);
      const always = await backfillLedger(kit, ledgered);

      expect(second).toEqual({
        status: 'notNeeded',
        ...(await revisionsOf(draft)),
      });
      expect(await branchContentsOf(kit, draft)).toEqual(backfilled);
      expect(always).toEqual({
        status: 'notNeeded',
        ...(await revisionsOf(ledgered)),
      });
    });

    it('refuses a Draft that changes a schema and writes nothing', async () => {
      const draft = await givenCatalogWithoutLedger();
      await draft.updateTable(PRODUCTS, addNote);
      const before = await branchContentsOf(kit, draft);

      const backfill = await backfillLedger(kit, draft);

      expect(backfill).toMatchObject({
        status: 'refused',
        refusal: { code: 'draftStructureChanged', tableIds: [PRODUCTS] },
      });
      expect(await branchContentsOf(kit, draft)).toEqual(before);
    });

    it('BF-08 refuses to write while an async migration is active on the branch', async () => {
      const draft = await givenCatalogWithoutLedger();
      await givenActiveMigration(kit, draft, PRODUCTS);
      const before = await branchContentsOf(kit, draft);

      await expect(backfillLedger(kit, draft)).rejects.toThrow(
        MigrationLockedException,
      );
      expect(await branchContentsOf(kit, draft)).toEqual(before);
    });
  });

  describe('a dry run and a run', () => {
    it('BF-04 a run after a dry run writes the planned entries under ids from its own clock', async () => {
      const draft = await givenCatalogWithoutLedger();
      const planned = await planBackfill(kit, draft);

      const backfill = await backfillLedger(kit, draft);

      expectBackfilled(backfill);
      expect(withoutIds(backfill.entries)).toEqual(
        withoutIds(entriesOf(planned)),
      );
      expect(await ledgerIdsOf(draft, 'head')).toEqual(
        backfill.entries.map(({ id }) => id),
      );
      expectStrictlyAscending(backfill.entries.map(({ id }) => id));
    });
  });

  describe('verification of the stored state', () => {
    it('BF-10 rolls back, raises and notifies nothing when the stored rows are not the planned entries', async () => {
      const draft = await givenCatalogWithoutLedger();
      const before = await branchContentsOf(kit, draft);
      const notifications = observeEndpointNotifications(kit, () =>
        migrationTableOf(kit, draft, 'head'),
      );
      storeFirstEntryWithAnotherSchema();

      await expect(backfillLedger(kit, draft)).rejects.toThrow(
        'The backfilled ledger does not hold exactly the planned entries under ascending ids',
      );
      expect(await branchContentsOf(kit, draft)).toEqual(before);
      expect(notifications).toEqual([]);
    });

    it('BF-10 rolls back and raises when the stored ledger does not reproduce a Head schema', async () => {
      const draft = await givenCatalogWithoutLedger();
      const before = await branchContentsOf(kit, draft);
      planProductsWithTheCategorySchema();

      await expect(backfillLedger(kit, draft)).rejects.toThrow(
        `The backfilled ledger does not reproduce the Head schema of ${PRODUCTS}`,
      );
      expect(await branchContentsOf(kit, draft)).toEqual(before);
    });

    it('BF-10 rolls back and raises when the new Head links the migration table without locking it', async () => {
      const draft = await givenCatalogWithoutLedger();
      const before = await branchContentsOf(kit, draft);
      jest
        .spyOn(kit.module.get(AssembledVersionWriter), 'lockLinkedIntoHead')
        .mockResolvedValue();

      await expect(backfillLedger(kit, draft)).rejects.toThrow(
        'The backfilled ledger is not readonly in the new Head',
      );
      expect(await branchContentsOf(kit, draft)).toEqual(before);
    });
  });

  describe('concurrent writers', () => {
    it('BF-09 keeps a row change that lands after the backfill planned in the new Draft and out of the new Head', async () => {
      const draft = await givenCatalogWithoutLedger();

      const { result } = await backfillWhileNativeWriteLands(kit, draft, () =>
        draft.updateRow(CATEGORIES, 'c1', { title: 'landed' }),
      );

      expect(result).toMatchObject({ status: 'backfilled' });
      expect((await draft.row('draft', CATEGORIES, 'c1')).data).toEqual({
        title: 'landed',
      });
      expect((await draft.row('head', CATEGORIES, 'c1')).data).toEqual({
        title: 'first',
      });
      expect(await describedLedgerOf(draft, 'head')).toEqual([
        `init ${CATEGORIES}`,
        `init ${PRODUCTS}`,
      ]);
    });

    it('BF-09 re-plans and refuses when a table created after the backfill planned changes the Draft structure', async () => {
      const draft = await givenCatalogWithoutLedger();

      const { result, attempts } = await backfillWhileNativeWriteLands(
        kit,
        draft,
        () => draft.createTable(NOTES, noteSchema),
      );

      expect(result).toMatchObject({
        status: 'refused',
        refusal: { code: 'draftStructureChanged', tableIds: [NOTES] },
      });
      expect(attempts).toBe(2);
      expect(await migrationTableOf(kit, draft, 'draft')).toBeNull();
    });

    it('BF-09 lets a writer of the former Draft fail as it fails after a native commit', async () => {
      const backfilled = await givenCatalogWithoutLedger();
      const committed = await givenCatalogWithoutLedger();
      const formerDrafts = {
        backfilled: await backfilled.revisionId('draft'),
        committed: await committed.revisionId('draft'),
      };
      await backfillLedger(kit, backfilled);
      await committed.updateRow(CATEGORIES, 'c1', { title: 'committed' });
      await committed.commit();

      const failure = await writeTitleOfC1(formerDrafts.committed).then(
        () => 'written',
        (error: Error) => error.message,
      );

      expect(failure).not.toBe('written');
      await expect(writeTitleOfC1(formerDrafts.backfilled)).rejects.toThrow(
        failure,
      );
    });

    it('writes behind the branch write fence, taken shared', async () => {
      const draft = await givenCatalogWithoutLedger();

      const queued = await queueWriteBehindBranchFence(
        { prismaService: kit.prisma },
        draft.branchId,
        () => backfillLedger(kit, draft),
      );
      await queued.releaseFence();

      await expect(queued.writing).resolves.toMatchObject({
        status: 'backfilled',
      });
    });
  });

  describe('after the backfill', () => {
    it('BF-12 a native updateTable records an update after the backfilled ids, and the scan finds the missing ledger only in history', async () => {
      const draft = await givenCatalogWithoutLedger();
      const backfill = await backfillLedger(kit, draft);
      expectBackfilled(backfill);

      await draft.updateTable(PRODUCTS, addNote);

      expect(await describedLedgerOf(draft, 'draft')).toEqual([
        `init ${CATEGORIES}`,
        `init ${PRODUCTS}`,
        `update ${PRODUCTS}`,
      ]);
      expectStrictlyAscending(await ledgerIdsOf(draft, 'draft'));
      const scan = await scanBranch(kit, draft);
      const history = [backfill.previousHeadRevisionId];
      expect(scan.findings).toEqual(
        [CATEGORIES, PRODUCTS].map((tableId) =>
          findingOf(draft, 'history', history, {
            code: 'unledgeredTable',
            tableId,
            detail: { reason: 'noMigrationTable' },
          }),
        ),
      );
    });

    it('BF-13 leaves other branches as they were: a branch from a revision before the backfill gets its own, a branch from the new Head needs none', async () => {
      const draft = await givenCatalogWithoutLedger();
      await createBranchFromHead(kit, draft, OTHER_BRANCH);
      const other = await planOtherBranch(draft);

      await backfillLedger(kit, draft);

      const planned = await planOtherBranch(draft);
      expect({ ...planned, entries: withoutIds(entriesOf(planned)) }).toEqual({
        ...other,
        entries: withoutIds(entriesOf(other)),
      });
      await expect(
        backfillLedger(kit, draft, { branchName: OTHER_BRANCH }),
      ).resolves.toMatchObject({ status: 'backfilled' });
      await createBranchFromHead(kit, draft, LATER_BRANCH);
      await expect(
        backfillLedger(kit, draft, { branchName: LATER_BRANCH }),
      ).resolves.toMatchObject({ status: 'notNeeded' });
    });

    it('BF-18 the scan reports a Head row written under another schema hash, and a partial commit of its table is not refused', async () => {
      const draft = await givenCatalogWithoutLedger();
      await draft.writeRowColumns(CATEGORIES, 'c1', { schemaHash: 'legacy' });
      await draft.commit();
      await backfillLedger(kit, draft);
      await draft.createRows(CATEGORIES, { c2: { title: 'second' } });

      const scan = await scanBranch(kit, draft);

      expect(
        scan.findings.filter(({ role }) => role !== 'history'),
      ).toContainEqual(
        await findingAt(draft, 'head', {
          code: 'rowSchemaHashMismatch',
          tableId: CATEGORIES,
          detail: {
            schemaHash: await schemaRowHashOf(draft, 'head', CATEGORIES),
            rowHashes: [{ hash: 'legacy', rowCount: 1, reason: 'unknownHash' }],
          },
        }),
      );
      expect(hashOf(categorySchema)).not.toBe('legacy');
      await expect(
        kit.partialChangesApi.commitChanges({
          branch: draft.branch,
          selection: { rows: [{ tableId: CATEGORIES, rowId: 'c2' }] },
        }),
      ).resolves.toMatchObject({ status: 'applied' });
    });
  });

  describe('notifications', () => {
    it('BF-19 notifies the endpoints of the new Head and the new Draft once each, after the commit', async () => {
      const draft = await givenCatalogWithoutLedger();
      const notifications = observeEndpointNotifications(kit, () =>
        migrationTableOf(kit, draft, 'head'),
      );

      const backfill = await backfillLedger(kit, draft);

      expectBackfilled(backfill);
      const seenOutsideTheTransaction = await migrationTableOf(
        kit,
        draft,
        'head',
      );
      expect(seenOutsideTheTransaction).not.toBeNull();
      expect(notifications).toEqual([
        { revisionId: backfill.headRevisionId, seenOutsideTheTransaction },
        { revisionId: backfill.draftRevisionId, seenOutsideTheTransaction },
      ]);
    });

    it.each([
      {
        outcome: 'planned',
        given: () => givenCatalogWithoutLedger(),
        input: { dryRun: true },
      },
      {
        outcome: 'notNeeded',
        given: () => givenCommittedCatalog(kit),
        input: {},
      },
      {
        outcome: 'refused',
        given: async () => {
          const draft = await givenCatalogWithoutLedger();
          await draft.updateTable(PRODUCTS, addNote);

          return draft;
        },
        input: {},
      },
    ])(
      'BF-19 notifies nothing after $outcome',
      async ({ outcome, given, input }) => {
        const draft = await given();
        const notifications = observeEndpointNotifications(kit, () =>
          Promise.resolve(null),
        );

        const backfill = await backfillLedger(kit, draft, input);

        expect(backfill.status).toBe(outcome);
        expect(notifications).toEqual([]);
      },
    );
  });

  function givenCatalogWithoutLedger(): Promise<BranchScenario> {
    return BranchScenario.committedWithoutLedger(kit, {
      [CATEGORIES]: categories,
      [PRODUCTS]: products,
    });
  }

  async function givenCatalogWithEditedRows(): Promise<BranchScenario> {
    const draft = await givenCatalogWithoutLedger();
    await draft.updateRow(CATEGORIES, 'c1', { title: 'edited' });
    await draft.removeRow(PRODUCTS, 'p2');

    return draft;
  }

  async function givenAuthorsAndBooksReferencingEachOther(): Promise<BranchScenario> {
    const draft = await BranchScenario.committedWithoutLedger(kit, {
      [AUTHORS]: { schema: authorSchema },
      [BOOKS]: { schema: bookSchema },
    });
    await draft.updateTable(AUTHORS, [
      addField('favourite', str({ foreignKey: BOOKS })),
    ]);
    await draft.commit();

    return draft;
  }

  async function givenCycleWithoutSurvivor(): Promise<BranchScenario> {
    const draft = await BranchScenario.committedWithoutLedger(kit, {
      b: { schema: obj({ name: str({ default: 'y' }) }) },
      a: {
        schema: obj({
          b: str({ foreignKey: 'b' }),
          name: str({ default: 'x' }),
        }),
      },
    });
    await commitHeadSchema(
      kit,
      draft,
      'b',
      obj({ a: str({ foreignKey: 'a' }), name: str({ default: 'y' }) }),
    );

    return draft;
  }

  function planOtherBranch(
    draft: BranchScenario,
  ): Promise<SchemaLedgerBackfill> {
    return backfillLedger(kit, draft, {
      branchName: OTHER_BRANCH,
      dryRun: true,
    });
  }

  async function rowDataOf(
    draft: BranchScenario,
    side: 'head' | 'draft',
    ...tableIds: string[]
  ): Promise<Record<string, unknown>> {
    const data: Record<string, unknown> = {};

    for (const tableId of tableIds) {
      const rows = await draft.rows(side, tableId);
      data[tableId] = rows.map(({ id, data: rowData }) => ({ id, rowData }));
    }

    return data;
  }

  async function refusedTablesOf(draft: BranchScenario): Promise<unknown[]> {
    const listing = await kit.partialChangesApi.listChanges({
      branch: draft.branch,
    });

    return [...listing.refusedTables];
  }

  function writeTitleOfC1(revisionId: string): Promise<unknown> {
    return kit.draftApi.apiUpdateRow({
      revisionId,
      tableId: CATEGORIES,
      rowId: 'c1',
      data: { title: 'late' },
    });
  }

  function storeFirstEntryWithAnotherSchema(): void {
    const draftRevisionApi = kit.module.get(DraftRevisionApiService);
    const createRows = draftRevisionApi.createRows.bind(draftRevisionApi);

    jest
      .spyOn(draftRevisionApi, 'createRows')
      .mockImplementation(({ rows, ...data }) =>
        createRows({
          ...data,
          rows: rows.map((row, index) =>
            index === 0
              ? {
                  ...row,
                  data: { ...(row.data as object), schema: noteSchema },
                }
              : row,
          ),
        }),
      );
  }

  function planProductsWithTheCategorySchema(): void {
    const planService = kit.module.get(LedgerBackfillPlanService);
    const plan = planService.plan.bind(planService);

    jest.spyOn(planService, 'plan').mockImplementation((state) => {
      const planned = plan(state);

      if (planned.status !== 'planned') {
        return planned;
      }

      return {
        ...planned,
        migrations: planned.migrations.map((migration) =>
          migration.changeType === 'init' && migration.tableId === PRODUCTS
            ? { ...migration, schema: categorySchema }
            : migration,
        ),
      };
    });
  }
});

function expectBackfilled(
  backfill: SchemaLedgerBackfill,
): asserts backfill is Extract<SchemaLedgerBackfill, { status: 'backfilled' }> {
  expect(backfill.status).toBe('backfilled');
}

function describedEntriesOf(backfill: SchemaLedgerBackfill): string[] {
  if (backfill.status !== 'planned' && backfill.status !== 'backfilled') {
    throw new Error(`The backfill is ${backfill.status}`);
  }

  return backfill.entries.map(
    ({ changeType, tableId }) => `${changeType} ${tableId}`,
  );
}
