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
} from './support/migration-imports';
import {
  expireLease,
  passTimeWithoutProgress,
} from './support/migration-database';
import {
  beforeBatchWrite,
  drivenByImportUntil,
  releaseStartedOwners,
  startOwnerUntil,
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
  importedUpdatesOf,
  startFieldAddition,
  startFieldRename,
  startImportedFieldAddition,
  type DraftOwnedTable,
  type StartedMigration,
} from './support/migration-scenario';
import { readLedger, readSchema } from './support/revision-records';

const BATCH_SIZE = 5;
const ROW_COUNT = 3 * BATCH_SIZE;
const MALFORMED_ROW = 2 * BATCH_SIZE + 2;
const FIELD = 'price';
const RENAMED_FIELD = 'cost';
const IMPORTED_ID = '2999-01-01T00:00:00.000Z';
const NEXT_IMPORTED_ID = '2999-01-02T00:00:00.000Z';

const OBSERVER_INTERVAL_MS = 50;
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

      await expect(imports.driverResults()).resolves.toEqual(['completed']);
      await expectRecordedUpdates(table, migrations);
    });

    it('(c) after a transient batch failure its driver releases the lease and ends, and the next observation claims again and completes', async () => {
      const table = await givenDraftOwnedTable(kit, ROW_COUNT);
      const migrations = fieldAddition(table);
      const imports = observeImports(kit);
      loseConnectionAtBatchWrite(kit, 2);

      await expect(importMigrations(kit, table, migrations)).resolves.toEqual([
        applied(IMPORTED_ID),
      ]);

      await expect(imports.driverResults()).resolves.toEqual([
        'stopped',
        'completed',
      ]);
      await expectRecordedUpdates(table, migrations);
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

      const imports = observeImports(importer());
      const importing = importMigrations(importer(), table, migrations);
      await imports.observationsWhile(importing, 1);
      await expectMigrationState(started, { lockedBy: owner.lease.token });

      await expireLease(kit.prisma, started.migrationId, LOCK_TIMEOUT_MS);

      await expect(importing).resolves.toEqual([applied(IMPORTED_ID)]);
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

    await expect(imports.driverResults()).resolves.toEqual(['completed']);
    await expectRecordedUpdates(table, migrations);
  });

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

    await expect(imports.driverResults()).resolves.toEqual([
      'completed',
      'completed',
    ]);
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
