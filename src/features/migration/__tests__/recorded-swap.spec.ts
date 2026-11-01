import { expectMigrationAbsent } from 'src/__tests__/assertions/migration';
import {
  createMigrationTestKit,
  type MigrationTestKit,
} from 'src/__tests__/kit/create-migration-test-kit';
import { queueWriteBehindBranchFence } from 'src/features/draft/commands/handlers/__tests__/support/branch-write-fence';
import { SystemTables } from 'src/features/share/system-tables.consts';
import { givenHeadSyncedReplica } from './support/head-synced-replica';
import { recordImportedLedgerId } from './support/migration-database';
import {
  afterSwapBegins,
  afterSwapTransactionCommits,
  crashOwnerAt,
  releaseStartedOwners,
  startOwnerUntil,
} from './support/migration-owners';
import {
  commitDraft,
  givenCommittedTable,
  givenStartedFieldAddition,
  givenStartedFieldRemoval,
  productViews,
  startFieldAddition,
  startFieldRename,
  type StartedMigration,
} from './support/migration-scenario';
import {
  expectDraftToOwnItsSystemRows,
  expectLedgerToReplaySchema,
  expectNativeMigrationIdAfter,
  expectOneRecordedUpdate,
  expectSchemaHistoryToEndWith,
  readDraftTableVersionId,
  readLedger,
  readSchema,
  readViews,
} from './support/revision-records';
import {
  failEndpointNotifications,
  loseSwapCommitAcknowledgement,
} from './support/swap-faults';

const BATCH_SIZE = 5;
const ROW_COUNT = 3 * BATCH_SIZE;
const FIELD = 'price';
const IMPORTED_MIGRATION_ID = '2999-01-01T00:00:00.000Z';

describe('Async migration swap records the update in the Draft', () => {
  it('AM-15 a Draft sharing the committed schema and views rows gets its own versions, one update with the original patches under a native id and its history entry', async () => {
    const table = await givenCommittedTable(kit, {
      rowCount: ROW_COUNT,
      views: productViews,
    });
    const headLedger = await readLedger(kit, table.headRevisionId);
    const migration = await startFieldAddition(kit, table, FIELD);

    await expectCompleted(migration);

    await expectDraftToOwnItsSystemRows(kit, table, [
      SystemTables.Schema,
      SystemTables.Views,
    ]);
    const update = await expectOneRecordedUpdate(kit, table, migration.patches);
    expectNativeMigrationIdAfter(update.id, lastIdOf(headLedger));
    await expectSchemaHistoryToEndWith(kit, table, migration.patches);
    await expectLedgerToReplaySchema(kit, headOf(table));
    await expectLedgerToReplaySchema(kit, table);
  });

  it('AM-16 a schema row the Draft already owns is recorded and the Draft replays its schema', async () => {
    const migration = await givenMigration();

    await expectCompleted(migration);

    await expectOneRecordedUpdate(kit, migration, migration.patches);
    await expectSchemaHistoryToEndWith(kit, migration, migration.patches);
    await expectLedgerToReplaySchema(kit, migration);
  });

  it('AM-17 a Head-synced replica imports the async update after a native commit and reproduces the source Head schema', async () => {
    const source = await givenCommittedTable(kit, { rowCount: ROW_COUNT });
    const replica = await givenHeadSyncedReplica(kit, source.headRevisionId);
    const migration = await startFieldAddition(kit, source, FIELD);
    await expectCompleted(migration);
    const { headRevisionId } = await commitDraft(kit, source);

    await replica.syncWith(headRevisionId);

    await expect(replica.readHeadSchema(source.tableId)).resolves.toEqual(
      await readSchema(kit, {
        revisionId: headRevisionId,
        tableId: source.tableId,
      }),
    );
  });

  it('AM-18 the views row is migrated in the Draft only', async () => {
    const table = await givenCommittedTable(kit, {
      rowCount: ROW_COUNT,
      views: productViews,
    });
    const migration = await startFieldRename(kit, table, {
      from: 'ver',
      to: 'version',
    });

    await expectCompleted(migration);

    await expect(readViews(kit, table)).resolves.toMatchObject({
      views: [{ columns: [{ field: 'data.version' }] }],
    });
    await expect(readViews(kit, headOf(table))).resolves.toEqual(productViews);
  });

  it('records an imported update under the source migration id of its payload', async () => {
    const migration = await givenMigration();
    await recordImportedLedgerId(
      kit.prisma,
      migration.migrationId,
      IMPORTED_MIGRATION_ID,
    );

    await expectCompleted(migration);

    const update = await expectOneRecordedUpdate(
      kit,
      migration,
      migration.patches,
    );
    expect(update.id).toBe(IMPORTED_MIGRATION_ID);
  });

  it('waits behind an exclusive holder of its branch write fence and swaps once the fence is released', async () => {
    const migration = await givenMigration();
    const owner = await startOwnerUntil(
      kit,
      migration.migrationId,
      afterSwapBegins(kit),
    );
    const source = await readDraftTableVersionId(kit, migration);

    const queued = await queueWriteBehindBranchFence(
      { prismaService: kit.prisma },
      migration.branchId,
      () => owner.resume(),
    );
    await expect(readDraftTableVersionId(kit, migration)).resolves.toBe(source);
    await queued.releaseFence();

    await expect(queued.writing).resolves.toBe('completed');
    await expectOneRecordedUpdate(kit, migration, migration.patches);
  });

  describe('after the swap commits', () => {
    it('AM-07 a fault right after the commit leaves no active record, so the remove patch is applied once', async () => {
      const migration = await givenStartedFieldRemoval(kit, {
        rowCount: ROW_COUNT,
        field: FIELD,
      });

      await crashOwnerAt(
        kit,
        migration.migrationId,
        afterSwapTransactionCommits(kit),
      );

      await expectMigrationAbsent(kit, migration.revisionId, migration.tableId);
      await expect(
        kit.migrationService.processMigration(migration.migrationId),
      ).resolves.toBe('stopped');
      await expect(readSchema(kit, migration)).resolves.not.toHaveProperty(
        `properties.${FIELD}`,
      );
      await expectOneRecordedUpdate(kit, migration, migration.patches);
    });

    it('AM-08 a connection lost after the commit leaves recovery nothing to do', async () => {
      const migration = await givenMigration();
      const swapTransactions = loseSwapCommitAcknowledgement(kit);

      await expect(
        kit.migrationService.processMigration(migration.migrationId),
      ).resolves.toBe('stopped');

      await expect(
        kit.migrationService.processMigration(migration.migrationId),
      ).resolves.toBe('stopped');
      expect(swapTransactions).toHaveBeenCalledTimes(1);
      await expectMigrationAbsent(kit, migration.revisionId, migration.tableId);
      await expectOneRecordedUpdate(kit, migration, migration.patches);
    });

    it('AM-09 endpoints of the Draft are notified once, and a failed notification neither fails nor repeats the swap', async () => {
      const migration = await givenMigration();
      const notifications = failEndpointNotifications(kit);

      await expectCompleted(migration);
      await expect(
        kit.migrationService.processMigration(migration.migrationId),
      ).resolves.toBe('stopped');

      expect(notifications.mock.calls).toEqual([
        [{ revisionId: migration.revisionId }],
      ]);
      await expectMigrationAbsent(kit, migration.revisionId, migration.tableId);
      await expectOneRecordedUpdate(kit, migration, migration.patches);
    });
  });

  let kit: MigrationTestKit;

  beforeAll(async () => {
    kit = await createMigrationTestKit({
      batchSize: BATCH_SIZE,
      workerMode: 'disabled',
    });
  });

  afterEach(async () => {
    await releaseStartedOwners();
    jest.restoreAllMocks();
    await kit.guard.verifyAndForget();
  });

  afterAll(async () => {
    await kit.close();
  });

  function givenMigration(): Promise<StartedMigration> {
    return givenStartedFieldAddition(kit, {
      rowCount: ROW_COUNT,
      field: FIELD,
    });
  }

  async function expectCompleted(migration: StartedMigration): Promise<void> {
    await expect(
      kit.migrationService.processMigration(migration.migrationId),
    ).resolves.toBe('completed');
    await expectMigrationAbsent(kit, migration.revisionId, migration.tableId);
  }
});

function headOf(table: { headRevisionId: string; tableId: string }) {
  return { revisionId: table.headRevisionId, tableId: table.tableId };
}

function lastIdOf(ledger: { id: string }[]): string {
  return ledger.at(-1)?.id ?? '';
}
