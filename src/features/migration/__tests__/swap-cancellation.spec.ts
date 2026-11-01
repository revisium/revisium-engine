import { expectMigrationAbsent } from 'src/__tests__/assertions/migration';
import {
  createMigrationTestKit,
  type MigrationTestKit,
} from 'src/__tests__/kit/create-migration-test-kit';
import { ApiRevertChangesCommand } from 'src/features/draft/commands/impl/api-revert-changes.command';
import {
  afterAbortReadsItsRecord,
  beforeSwapBegins,
  insideSwapAfterItsRecordCheck,
  releaseStartedOwners,
  startAbortUntil,
  startOwnerUntil,
} from './support/migration-owners';
import {
  givenCommittedTable,
  givenStartedFieldAddition,
  startFieldAddition,
  type StartedMigration,
} from './support/migration-scenario';
import {
  readDraftTableVersionId,
  readLedger,
} from './support/revision-records';

const BATCH_SIZE = 5;
const ROW_COUNT = 3 * BATCH_SIZE;
const FIELD = 'price';

describe('Cancellation around the async migration swap', () => {
  it('AM-26 an abort before T-swap-begin wins: the owner stops and the Draft keeps its source table', async () => {
    const migration = await givenMigration();
    const source = await readDraftTableVersionId(kit, migration);
    const owner = await startOwnerUntil(
      kit,
      migration.migrationId,
      beforeSwapBegins(kit),
    );
    const shadow = await shadowTableOf(migration);

    await kit.migrationApi.abortMigration(migration);

    await expect(owner.resume()).resolves.toBe('stopped');
    await expectMigrationAbsent(kit, migration.revisionId, migration.tableId);
    await expect(readDraftTableVersionId(kit, migration)).resolves.toBe(source);
    await expectTableVersionDeleted(shadow);
    await expectDraftRows(migration, { migrated: false });
  });

  it('AM-27 an abort paused after its status read while T-swap-begin and the swap commit deletes nothing', async () => {
    const migration = await givenMigration();
    const owner = await startOwnerUntil(
      kit,
      migration.migrationId,
      beforeSwapBegins(kit),
    );
    const abort = await startAbortUntil(
      kit,
      migration,
      afterAbortReadsItsRecord(kit),
    );

    await expect(owner.resume()).resolves.toBe('completed');
    await expect(abort.resume()).resolves.toBeUndefined();

    await expectMigrationAbsent(kit, migration.revisionId, migration.tableId);
    await expectDraftRows(migration, { migrated: true });
  });

  describe('AM-28 while the swap transaction is open', () => {
    it('rejects an abort with the message of a SWAPPING migration', async () => {
      const migration = await givenMigration();
      const owner = await startOwnerUntil(
        kit,
        migration.migrationId,
        insideSwapAfterItsRecordCheck(kit),
      );

      await expect(kit.migrationApi.abortMigration(migration)).rejects.toThrow(
        'Cannot abort during swap phase, please wait for completion',
      );

      await expect(owner.resume()).resolves.toBe('completed');
      await expectDraftRows(migration, { migrated: true });
    });

    it('rejects a revert with the message of a SWAPPING migration', async () => {
      const migration = await givenMigration();
      const owner = await startOwnerUntil(
        kit,
        migration.migrationId,
        insideSwapAfterItsRecordCheck(kit),
      );

      await expect(revert(migration)).rejects.toThrow(
        `Cannot revert while migration on table "${migration.tableId}" is swapping. Wait for swap to complete.`,
      );

      await expect(owner.resume()).resolves.toBe('completed');
      await expectDraftRows(migration, { migrated: true });
    });
  });

  it('an abort after the swap removes nothing and returns as for no migration', async () => {
    const migration = await givenMigration();
    await expect(
      kit.migrationService.processMigration(migration.migrationId),
    ).resolves.toBe('completed');

    await expect(
      kit.migrationApi.abortMigration(migration),
    ).resolves.toBeUndefined();

    await expectDraftRows(migration, { migrated: true });
  });

  it('AM-29 a revert after a completed swap links the Head table versions again and drops the update', async () => {
    const table = await givenCommittedTable(kit, { rowCount: ROW_COUNT });
    const migration = await startFieldAddition(kit, table, FIELD);
    await expect(
      kit.migrationService.processMigration(migration.migrationId),
    ).resolves.toBe('completed');

    await revert(table);

    await expect(readLinkedTables(table.revisionId)).resolves.toEqual(
      await readLinkedTables(table.headRevisionId),
    );
    await expect(readLedger(kit, table.revisionId)).resolves.toEqual(
      await readLedger(kit, table.headRevisionId),
    );
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

  function revert(table: { projectId: string; branchName: string }) {
    return kit.commandBus.execute(
      new ApiRevertChangesCommand({
        projectId: table.projectId,
        branchName: table.branchName,
      }),
    );
  }

  async function shadowTableOf(migration: StartedMigration): Promise<string> {
    const { shadowTableVersionId } =
      await kit.prisma.tableMigration.findUniqueOrThrow({
        where: { id: migration.migrationId },
      });

    if (!shadowTableVersionId) {
      throw new Error(`Migration ${migration.migrationId} has no shadow table`);
    }

    return shadowTableVersionId;
  }

  async function expectTableVersionDeleted(versionId: string): Promise<void> {
    await expect(
      kit.prisma.table.findUnique({ where: { versionId } }),
    ).resolves.toBeNull();
  }

  async function expectDraftRows(
    migration: StartedMigration,
    { migrated }: { migrated: boolean },
  ): Promise<void> {
    const rows = await kit.prisma.row.findMany({
      where: {
        tables: {
          some: {
            id: migration.tableId,
            revisions: { some: { id: migration.revisionId } },
          },
        },
      },
      orderBy: { id: 'asc' },
    });

    expect(rows.map((row) => row.id)).toEqual(migration.rowIds);
    for (const row of rows) {
      expect(migration.field in (row.data as object)).toBe(migrated);
    }
  }

  async function readLinkedTables(revisionId: string): Promise<string[]> {
    const tables = await kit.prisma.table.findMany({
      where: { revisions: { some: { id: revisionId } } },
      orderBy: { versionId: 'asc' },
    });

    return tables.map((table) => table.versionId);
  }
});
