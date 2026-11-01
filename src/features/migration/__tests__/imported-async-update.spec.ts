import {
  getNumberSchema,
  getObjectSchema,
  getReplacePatch,
  getStringSchema,
} from '@revisium/schema-toolkit/mocks';
import type { UpdateMigration } from '@revisium/schema-toolkit/types';
import { expectMigrationAbsent } from 'src/__tests__/assertions/migration';
import {
  createMigrationTestKit,
  type MigrationTestKit,
} from 'src/__tests__/kit/create-migration-test-kit';
import type { TableMigration } from 'src/engine-prisma-types';
import type { ApplyMigrationResult } from 'src/features/draft/commands/impl/migration';
import type { MigrationOptions } from 'src/features/migration/types/migration-options.types';
import { MigrationStatus } from 'src/features/migration/types/migration.types';
import { loseConnectionAtBatchWrite } from './support/batch-faults';
import { givenHeadSyncedReplica } from './support/head-synced-replica';
import {
  isBranchFenceFree,
  observeImports,
  observeOpenTransactions,
  trackSettlement,
  type ObservedImports,
} from './support/migration-imports';
import {
  expireLease,
  passTimeWithoutProgress,
} from './support/migration-database';
import {
  afterImportAwaited,
  afterRetry,
  beforeActiveImportLookup,
  beforeBatchWrite,
  beforeImportAwaits,
  beforeObservation,
  drivenByImportUntil,
  killOwnerProcess,
  pauseUntil,
  releaseStartedOwners,
  startOwnerUntil,
  stopLeaseRenewals,
} from './support/migration-owners';
import {
  commitDraft,
  fieldAdditionOf,
  fieldRenameOf,
  givenCommittedTable,
  givenDraftOwnedTable,
  givenDraftOwnedTables,
  givenDraftOwnedTableWith,
  importMigrations,
  importedTableCreationOf,
  importedUpdatesOf,
  startFieldAddition,
  startFieldRename,
  startImportedFieldAddition,
  type DraftOwnedTable,
  type StartedMigration,
} from './support/migration-scenario';
import { observeSweepingProcess } from './support/migration-sweeps';
import { readLedger, readRows, readSchema } from './support/revision-records';

const BATCH_SIZE = 5;
const ROW_COUNT = 3 * BATCH_SIZE;
const MALFORMED_ROW = 2 * BATCH_SIZE + 2;
const FIELD = 'price';
const RENAMED_FIELD = 'cost';
const IMPORTED_ID = '2999-01-01T00:00:00.000Z';
const NEXT_IMPORTED_ID = '2999-01-02T00:00:00.000Z';
const LATER_ID = '2999-01-03T00:00:00.000Z';
const LATER_TABLE_ID = 'orders';

const OBSERVER_INTERVAL_MS = 50;
const HEARTBEAT_INTERVAL_MS = 500;
const LOCK_TIMEOUT_MS = 10_000;
const STALL_TIMEOUT_MS = 60_000;
const DEADLINE_MARGIN_MS = STALL_TIMEOUT_MS / 2;

const codesSchema = getObjectSchema({
  ver: getNumberSchema(),
  code: getStringSchema(),
});

describe('applyMigrations of an update above the threshold', () => {
  it('AM-37 reports applied once the swap recorded the source id, then applies the next migration, and holds no transaction or fence while it waits', async () => {
    const table = await givenDraftOwnedTable(kit, ROW_COUNT);
    const migrations = additionThenRename(table);
    const imports = observeImports(kit);
    const openTransactions = observeOpenTransactions(kit);

    const importing = importMigrations(kit, table, migrations);
    const hasSettled = trackSettlement(importing);
    const driver = await drivenByImportUntil(
      imports,
      importing,
      beforeBatchWrite(kit, 2),
    );
    await imports.observationsWhile(importing, 1);

    expect(hasSettled()).toBe(false);
    expect(openTransactions()).toBe(0);
    await expect(isBranchFenceFree(kit, table.branchId)).resolves.toBe(true);

    await expect(driver.resume()).resolves.toBe('completed');
    await expect(importing).resolves.toEqual([
      applied(IMPORTED_ID),
      applied(NEXT_IMPORTED_ID),
    ]);
    await expectRecordedUpdates(table, migrations);
    await expect(readSchema(kit, table)).resolves.toHaveProperty(
      `properties.${RENAMED_FIELD}`,
    );
  });

  it('AM-38 a row the target schema rejects fails the import ROW_INVALID, stops the batch and records nothing', async () => {
    const table = await givenCodesWithOneMalformed();

    await expect(
      importMigrations(kit, table, codePatternThenAddition(table)),
    ).resolves.toEqual([
      {
        id: IMPORTED_ID,
        status: 'failed',
        error: expect.stringMatching(/^ROW_INVALID: /),
      },
    ]);

    await expectRecordedUpdates(table, []);
    await expectMigrationState(table, { status: MigrationStatus.FAILED });
  });

  it('AM-39 a repeated import in another process while the migration copies joins its record, and both report applied', async () => {
    const table = await givenDraftOwnedTable(kit, ROW_COUNT);
    const migrations = fieldAddition(table);
    const starts = observeMigrationStarts([kit, anotherProcess]);
    const imports = observeImports(kit);
    const first = importMigrations(kit, table, migrations);
    const driver = await drivenByImportUntil(
      imports,
      first,
      beforeBatchWrite(kit, 2),
    );

    const repeatedImports = observeImports(anotherProcess);
    const repeated = importMigrations(anotherProcess, table, migrations);
    await repeatedImports.observationsWhile(repeated, 1);
    await expect(driver.resume()).resolves.toBe('completed');

    await expect(first).resolves.toEqual([applied(IMPORTED_ID)]);
    await expect(repeated).resolves.toEqual([applied(IMPORTED_ID)]);
    expect(starts()).toBe(1);
    await expectRecordedUpdates(table, migrations);
  });

  it('a repeated import that, after its id check, finds the next migration of a concurrent importer active reports its own migration applied and joins the next one', async () => {
    const table = await givenDraftOwnedTable(kit, ROW_COUNT);
    const migrations = additionThenRename(table);
    const repeated = await pauseUntil(
      importMigrations(anotherProcess, table, migrations),
      beforeActiveImportLookup(anotherProcess),
    );
    const first = await pauseUntil(
      importMigrations(kit, table, migrations),
      beforeImportAwaits(kit, 2),
    );

    await expect(repeated.resume()).resolves.toEqual([
      applied(IMPORTED_ID),
      applied(NEXT_IMPORTED_ID),
    ]);
    await expect(first.resume()).resolves.toEqual([
      applied(IMPORTED_ID),
      applied(NEXT_IMPORTED_ID),
    ]);
    await expectRecordedUpdates(table, migrations);
    await expectRowsMigratedOnce(table, RENAMED_FIELD);
  });

  it('refuses an update while another migration without its source id is active, with the MIGRATION_LOCKED message, and stops the batch', async () => {
    const draft = await givenDraftOwnedTables(kit, {
      tableIds: ['products', 'orders'],
      rowCount: ROW_COUNT,
    });
    const [products, orders] = draft.tables as [
      DraftOwnedTable,
      DraftOwnedTable,
    ];
    const interactive = await startFieldAddition(kit, orders, FIELD);

    await expect(
      importMigrations(kit, products, additionThenRename(products)),
    ).resolves.toEqual([
      {
        id: IMPORTED_ID,
        status: 'failed',
        error:
          'Revision is locked by an active migration on table "orders" (PENDING)',
      },
    ]);

    await expectMigrationState(interactive, {
      status: MigrationStatus.PENDING,
    });
    await expectMigrationAbsent(kit, products.revisionId, products.tableId);
  });

  describe('AM-40 in disabled mode', () => {
    it('(a) the importer drives the migration and observes it to applied', async () => {
      const table = await givenDraftOwnedTable(kit, ROW_COUNT);
      const migrations = fieldAddition(table);
      const imports = observeImports(kit);

      await expect(importMigrations(kit, table, migrations)).resolves.toEqual([
        applied(IMPORTED_ID),
      ]);

      await expectRecordedUpdates(table, migrations);
      await expectRowsMigratedOnce(table, FIELD);
      await expectCompletedByOneLocalDriverAtATime(imports);
    });

    it('(c) after a transient batch failure its driver releases the lease and ends, and the next observation claims again and completes', async () => {
      const table = await givenDraftOwnedTable(kit, ROW_COUNT);
      const migrations = fieldAddition(table);
      const imports = observeImports(kit);
      loseConnectionAtBatchWrite(kit, 2);

      await expect(importMigrations(kit, table, migrations)).resolves.toEqual([
        applied(IMPORTED_ID),
      ]);

      await expect(imports.driverResults()).resolves.toHaveProperty(
        [0],
        'stopped',
      );
      await expectRecordedUpdates(table, migrations);
      await expectRowsMigratedOnce(table, FIELD);
      await expectCompletedByOneLocalDriverAtATime(imports);
    });

    it('(d) never starts a second local driver of the migration, even when the lease of the running one expired', async () => {
      const table = await givenDraftOwnedTable(kit, ROW_COUNT);
      const imports = observeImports(kit);
      const importing = importMigrations(kit, table, fieldAddition(table));
      const driver = await drivenByImportUntil(
        imports,
        importing,
        beforeBatchWrite(kit, 2),
      );

      stopLeaseRenewals(kit);
      await expireLease(kit.prisma, driver.lease.migrationId, LOCK_TIMEOUT_MS);
      await imports.observationsWhile(importing, 2);

      await expectMigrationState(driver.lease, {
        status: MigrationStatus.COPYING,
        lockedBy: driver.lease.token,
      });
      await expect(driver.resume()).resolves.toBe('completed');
      await expect(importing).resolves.toEqual([applied(IMPORTED_ID)]);
      expect(imports.mostConcurrentDriversOfOneMigration()).toBe(1);
    });

    it('(e) a driver stalled outside any transaction does not hold the import: the progress deadline ends it CANCELLED, and the resumed driver stops at its guard', async () => {
      const table = await givenDraftOwnedTable(kit, ROW_COUNT);
      const imports = observeImports(kit);
      const importing = importMigrations(kit, table, fieldAddition(table));
      const driver = await drivenByImportUntil(
        imports,
        importing,
        beforeBatchWrite(kit, 2),
      );

      await passTimeWithoutProgress(
        kit.prisma,
        driver.lease.migrationId,
        STALL_TIMEOUT_MS + DEADLINE_MARGIN_MS,
      );

      await expect(importing).resolves.toEqual([
        {
          id: IMPORTED_ID,
          status: 'failed',
          error: expect.stringMatching(/^CANCELLED: STALLED: /),
        },
      ]);
      await expect(driver.resume()).resolves.toBe('stopped');
      await expectMigrationState(driver.lease, {
        status: MigrationStatus.CANCELLED,
        copiedRows: BATCH_SIZE,
        lockedBy: null,
      });
      await expectRecordedUpdates(table, []);
    });
  });

  it.each([
    { scenario: 'AM-40 (b) in disabled mode', importer: () => kit },
    { scenario: 'AM-41 in polling mode', importer: () => pollingKit },
  ])(
    '$scenario a repeated import observes the record another process owns, and claims and completes it once that owner died',
    async ({ importer }) => {
      const table = await givenDraftOwnedTable(kit, ROW_COUNT);
      const migrations = fieldAddition(table);
      const started = await startImportedFieldAddition(kit, table, {
        field: FIELD,
        migrationId: IMPORTED_ID,
      });
      const owner = await startOwnerUntil(
        anotherProcess,
        started.migrationId,
        beforeBatchWrite(anotherProcess, 2),
      );

      const importing = await pauseUntil(
        importMigrations(importer(), table, migrations),
        beforeObservation(importer(), 2),
      );
      await expectMigrationState(started, { lockedBy: owner.lease.token });

      await killOwnerProcess(
        anotherProcess,
        started.migrationId,
        LOCK_TIMEOUT_MS,
      );

      await expect(importing.resume()).resolves.toEqual([applied(IMPORTED_ID)]);
      await expect(owner.resume()).resolves.toBe('stopped');
      await expectRecordedUpdates(table, migrations);
    },
  );

  it('in inline mode the start trigger drives the import as the local driver of its record, and the observer starts no other', async () => {
    const table = await givenDraftOwnedTable(inlineKit, ROW_COUNT);
    const migrations = fieldAddition(table);
    const imports = observeImports(inlineKit);

    await expect(
      importMigrations(inlineKit, table, migrations),
    ).resolves.toEqual([applied(IMPORTED_ID)]);

    await expect(imports.driverResults()).resolves.toHaveProperty(
      [0],
      'completed',
    );
    await expectRecordedUpdates(table, migrations);
    await expectRowsMigratedOnce(table, FIELD);
    await expectCompletedByOneLocalDriverAtATime(imports);
  });

  it.each([
    { mode: 'inline', process: () => inlineKit },
    { mode: 'polling', process: () => pollingKit },
  ])(
    'in $mode mode the sweep starts no second local driver while the driver of an import is still running after releasing the record on a transient failure',
    async ({ process }) => {
      const importer = process();
      const table = await givenDraftOwnedTable(importer, ROW_COUNT);
      const migrations = fieldAddition(table);
      const imports = observeImports(importer);
      const sweeping = observeSweepingProcess(importer);
      loseConnectionAtBatchWrite(importer, 2);

      const importing = await pauseUntil(
        importMigrations(importer, table, migrations),
        afterRetry(importer),
      );
      importer.recoveryScope.include((await readMigration(table)).id);
      await sweeping.sweepsCompleted(2);

      await expect(importing.resume()).resolves.toEqual([applied(IMPORTED_ID)]);
      expect(imports.mostConcurrentDriversOfOneMigration()).toBe(1);
      await expectRecordedUpdates(table, migrations);
      await expectRowsMigratedOnce(table, FIELD);
    },
  );

  it('AM-42 an abort while the import waits fails it CANCELLED and records nothing', async () => {
    const table = await givenDraftOwnedTable(kit, ROW_COUNT);
    const imports = observeImports(kit);
    const importing = importMigrations(kit, table, fieldAddition(table));
    const driver = await drivenByImportUntil(
      imports,
      importing,
      beforeBatchWrite(kit, 2),
    );

    await kit.migrationApi.abortMigration(table);

    await expect(importing).resolves.toEqual([
      { id: IMPORTED_ID, status: 'failed', error: 'CANCELLED' },
    ]);
    await expect(driver.resume()).resolves.toBe('stopped');
    await expectMigrationAbsent(kit, table.revisionId, table.tableId);
    await expectRecordedUpdates(table, []);
  });

  describe('an import whose migration ended unrecorded while another writer recorded a later migration', () => {
    it('reports the ROW_INVALID failure of its migration', async () => {
      const table = await givenCodesWithOneMalformed();
      const importing = await pauseUntil(
        importMigrations(kit, table, codePatternThenAddition(table)),
        afterImportAwaited(kit),
      );

      await recordLaterMigration(table);

      await expect(importing.resume()).resolves.toEqual([
        {
          id: IMPORTED_ID,
          status: 'failed',
          error: expect.stringMatching(/^ROW_INVALID: /),
        },
      ]);
    });

    it('reports an abort as CANCELLED', async () => {
      const table = await givenDraftOwnedTable(kit, ROW_COUNT);
      const imports = observeImports(kit);
      const observedEnd = afterImportAwaited(kit);
      const importing = importMigrations(kit, table, fieldAddition(table));
      const driver = await drivenByImportUntil(
        imports,
        importing,
        beforeBatchWrite(kit, 2),
      );
      await kit.migrationApi.abortMigration(table);
      const ended = await pauseUntil(importing, observedEnd);

      await recordLaterMigration(table);

      await expect(ended.resume()).resolves.toEqual([
        { id: IMPORTED_ID, status: 'failed', error: 'CANCELLED' },
      ]);
      await expect(driver.resume()).resolves.toBe('stopped');
    });
  });

  it('AM-45 a Head-synced replica imports large updates under the source ids, each after its swap, and reproduces the source Head', async () => {
    const source = await givenCommittedTable(kit, { rowCount: ROW_COUNT });
    const replica = await givenHeadSyncedReplica(kit, source.headRevisionId);
    await replica.syncRowsWith(source.headRevisionId, source.tableId);
    const imports = observeImports(kit);
    await completeAsyncUpdate(startFieldAddition(kit, source, FIELD));
    await completeAsyncUpdate(
      startFieldRename(kit, source, { from: FIELD, to: RENAMED_FIELD }),
    );
    const { headRevisionId } = await commitDraft(kit, source);

    await replica.syncWith(headRevisionId);

    await expectCompletedByOneLocalDriverAtATime(imports, 2);
    await expect(replica.readHeadLedger()).resolves.toEqual(
      await readLedger(kit, headRevisionId),
    );
    await expect(replica.readHeadSchema(source.tableId)).resolves.toEqual(
      await readSchema(kit, {
        revisionId: headRevisionId,
        tableId: source.tableId,
      }),
    );
  });

  let kit: MigrationTestKit;
  let inlineKit: MigrationTestKit;
  let pollingKit: MigrationTestKit;
  let anotherProcess: MigrationTestKit;

  beforeAll(async () => {
    kit = await startProcess('disabled');
    inlineKit = await startProcess('inline');
    pollingKit = await startProcess('polling');
    anotherProcess = await startProcess('disabled');
  });

  afterEach(async () => {
    await releaseStartedOwners();
    jest.restoreAllMocks();
    await kit.guard.verifyAndForget();
    await inlineKit.guard.verifyAndForget();
    await pollingKit.guard.verifyAndForget();
  });

  afterAll(async () => {
    await anotherProcess.close();
    await pollingKit.close();
    await inlineKit.close();
    await kit.close();
  });

  function startProcess(
    workerMode: NonNullable<MigrationOptions['workerMode']>,
  ): Promise<MigrationTestKit> {
    return createMigrationTestKit({
      batchSize: BATCH_SIZE,
      workerMode,
      pollIntervalMs: OBSERVER_INTERVAL_MS,
      heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
      lockTimeoutMs: LOCK_TIMEOUT_MS,
      stallTimeoutMs: STALL_TIMEOUT_MS,
    });
  }

  function givenCodesWithOneMalformed(): Promise<DraftOwnedTable> {
    return givenDraftOwnedTableWith(kit, {
      schema: codesSchema,
      rows: Array.from({ length: ROW_COUNT }, (_, index) => ({
        ver: index,
        code: index === MALFORMED_ROW ? 'Not a code' : 'code',
      })),
    });
  }

  async function completeAsyncUpdate(
    starting: Promise<StartedMigration>,
  ): Promise<void> {
    const { migrationId } = await starting;

    await expect(
      kit.migrationService.processMigration(migrationId),
    ).resolves.toBe('completed');
  }

  async function recordLaterMigration(table: DraftOwnedTable): Promise<void> {
    await expect(
      importMigrations(kit, table, [
        importedTableCreationOf(LATER_TABLE_ID, LATER_ID),
      ]),
    ).resolves.toEqual([applied(LATER_ID)]);
  }

  async function expectRowsMigratedOnce(
    table: DraftOwnedTable,
    field: string,
  ): Promise<void> {
    const rows = await readRows(kit, table);

    expect(rows.map(({ id }) => id)).toEqual(table.rowIds);
    for (const { data } of rows) {
      expect(data).toHaveProperty(field);
    }
  }

  async function expectCompletedByOneLocalDriverAtATime(
    imports: ObservedImports,
    migrations = 1,
  ): Promise<void> {
    const completed = (await imports.driverResults()).filter(
      (result) => result === 'completed',
    );

    expect(completed).toHaveLength(migrations);
    expect(imports.mostConcurrentDriversOfOneMigration()).toBe(1);
  }

  async function expectRecordedUpdates(
    table: DraftOwnedTable,
    migrations: UpdateMigration[],
  ): Promise<void> {
    const updates = (await readLedger(kit, table.revisionId)).filter(
      (migration): migration is UpdateMigration =>
        migration.changeType === 'update' &&
        migration.tableId === table.tableId,
    );

    expect(updates.map(({ id, patches }) => ({ id, patches }))).toEqual(
      migrations.map(({ id, patches }) => ({ id, patches })),
    );
  }

  async function expectMigrationState(
    migration: DraftOwnedTable | StartedMigration | { migrationId: string },
    expected: Partial<TableMigration>,
  ): Promise<void> {
    await expect(readMigration(migration)).resolves.toMatchObject(expected);
  }

  function readMigration(
    migration: DraftOwnedTable | StartedMigration | { migrationId: string },
  ) {
    if ('migrationId' in migration) {
      return kit.prisma.tableMigration.findUniqueOrThrow({
        where: { id: migration.migrationId },
      });
    }

    return kit.prisma.tableMigration.findUniqueOrThrow({
      where: {
        revisionId_tableId: {
          revisionId: migration.revisionId,
          tableId: migration.tableId,
        },
      },
    });
  }

  function observeMigrationStarts(processes: MigrationTestKit[]): () => number {
    const spies = processes.map((process) =>
      jest.spyOn(process.migrationService, 'createMigrationRecord'),
    );

    return () =>
      spies.reduce((starts, spy) => starts + spy.mock.calls.length, 0);
  }
});

function fieldAddition(table: DraftOwnedTable): UpdateMigration[] {
  return importedUpdatesOf(table, [
    { migrationId: IMPORTED_ID, patches: fieldAdditionOf(FIELD) },
  ]);
}

function additionThenRename(table: DraftOwnedTable): UpdateMigration[] {
  return importedUpdatesOf(table, [
    { migrationId: IMPORTED_ID, patches: fieldAdditionOf(FIELD) },
    {
      migrationId: NEXT_IMPORTED_ID,
      patches: fieldRenameOf({ from: FIELD, to: RENAMED_FIELD }),
    },
  ]);
}

function codePatternThenAddition(table: DraftOwnedTable): UpdateMigration[] {
  return importedUpdatesOf(
    table,
    [
      {
        migrationId: IMPORTED_ID,
        patches: [
          getReplacePatch({
            path: '/properties/code',
            value: getStringSchema({ pattern: '^[a-z]+$' }),
          }),
        ],
      },
      { migrationId: NEXT_IMPORTED_ID, patches: fieldAdditionOf(FIELD) },
    ],
    codesSchema,
  );
}

function applied(id: string): ApplyMigrationResult {
  return { id, status: 'applied' };
}
