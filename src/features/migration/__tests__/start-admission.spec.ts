import { expectMigrationAbsent } from 'src/__tests__/assertions/migration';
import {
  createMigrationTestKit,
  type MigrationTestKit,
} from 'src/__tests__/kit/create-migration-test-kit';
import type { TableMigration } from 'src/engine-prisma-types';
import { MigrationLockedException } from 'src/features/migration/exceptions/migration-locked.exception';
import { decodeMigrationPayload } from 'src/features/migration/migration-payload';
import { MigrationWorkerService } from 'src/features/migration/services/migration-worker.service';
import { ACTIVE_MIGRATION_STATUSES } from 'src/features/migration/types/migration.types';
import { unlinkMigrationTable } from './support/migration-database';
import {
  fieldAdditionOf,
  givenDraftOwnedTable,
  givenDraftOwnedTables,
  importFieldAddition,
  startFieldAddition,
  startImportedFieldAddition,
  type StartedMigration,
} from './support/migration-scenario';
import { observeSweepingProcess } from './support/migration-sweeps';
import {
  expectOneRecordedUpdate,
  readRevisionContents,
} from './support/revision-records';
import {
  commitUntilItsLockRead,
  releaseHeldOperations,
  startConcurrentlyPastTheirLockReads,
} from './support/start-races';

const BATCH_SIZE = 5;
const ROW_COUNT = 3 * BATCH_SIZE;
const FIELD = 'price';
const IMPORTED_MIGRATION_ID = '2999-01-01T00:00:00.000Z';
const BEFORE_EVERY_PUBLISHED_MIGRATION = '2000-01-01T00:00:00.000Z';
const SWEEP_INTERVAL_MS = 50;

describe('Async migration start', () => {
  describe('one active migration per revision', () => {
    it('AM-31 of two starts on different tables of one Draft that both read the lock before either records its migration, one records it and the other gets MIGRATION_LOCKED', async () => {
      const draft = await givenDraftOwnedTables(kit, {
        tableIds: ['products', 'orders'],
        rowCount: ROW_COUNT,
      });

      const outcomes = await startConcurrentlyPastTheirLockReads(
        kit,
        draft.tables.map(
          (table) => () => startFieldAddition(kit, table, FIELD),
        ),
      );

      const started = expectOneStartedAndTheOtherLocked(outcomes);
      await expectActiveMigrations(draft.revisionId, [started.migrationId]);
    });

    it('AM-30 a commit paused after its lock read while a start commits fails serialization, its retry gets MIGRATION_LOCKED, and the migration stays with the Draft', async () => {
      const table = await givenDraftOwnedTable(kit, ROW_COUNT);
      const commit = await commitUntilItsLockRead(kit, table);

      const started = await startFieldAddition(kit, table, FIELD);

      await expect(commit.resume()).rejects.toThrow(MigrationLockedException);
      await expectActiveMigrations(table.revisionId, [started.migrationId]);
      await expectNoActiveMigrationOutsideTheDraft(table.branchId);
    });
  });

  describe('an imported update', () => {
    it('AM-43 into a Draft without a migration table fails with LEDGER_UNAVAILABLE and changes nothing', async () => {
      const table = await givenDraftOwnedTable(kit, ROW_COUNT);
      await unlinkMigrationTable(kit.prisma, table.revisionId);
      const contentsBefore = await readRevisionContents(kit, table.revisionId);

      await expect(
        importFieldAddition(kit, table, {
          field: FIELD,
          migrationId: IMPORTED_MIGRATION_ID,
        }),
      ).resolves.toEqual([
        {
          id: IMPORTED_MIGRATION_ID,
          status: 'failed',
          error: expect.stringMatching(/^LEDGER_UNAVAILABLE: /),
        },
      ]);

      await expectMigrationAbsent(kit, table.revisionId, table.tableId);
      await expect(
        readRevisionContents(kit, table.revisionId),
      ).resolves.toEqual(contentsBefore);
    });

    it('whose id is not after the Draft ledger is refused with the native message and starts nothing', async () => {
      const table = await givenDraftOwnedTable(kit, ROW_COUNT);

      await expect(
        startImportedFieldAddition(kit, table, {
          field: FIELD,
          migrationId: BEFORE_EVERY_PUBLISHED_MIGRATION,
        }),
      ).rejects.toThrow(
        `Provided id (${BEFORE_EVERY_PUBLISHED_MIGRATION}) must be after last migration date`,
      );

      await expectMigrationAbsent(kit, table.revisionId, table.tableId);
    });

    it('carries its source id in the payload, so the swap records the update under it', async () => {
      const table = await givenDraftOwnedTable(kit, ROW_COUNT);

      await importFieldAddition(kit, table, {
        field: FIELD,
        migrationId: IMPORTED_MIGRATION_ID,
      });

      const migration = await readTheActiveMigration(table.revisionId);
      expect(decodeMigrationPayload(migration.patches)).toMatchObject({
        ledgerMigrationId: IMPORTED_MIGRATION_ID,
      });
      await expect(
        kit.migrationService.processMigration(migration.id),
      ).resolves.toBe('completed');
      const update = await expectOneRecordedUpdate(
        kit,
        table,
        fieldAdditionOf(FIELD),
      );
      expect(update.id).toBe(IMPORTED_MIGRATION_ID);
    });
  });

  describe('AM-44 a worker trigger that fails after the start commits', () => {
    it('returns the migration id to the caller, and the recurring sweep completes the migration', async () => {
      const table = await givenDraftOwnedTable(inlineKit, ROW_COUNT);
      failWorkerTriggers(inlineKit);
      const sweeping = observeSweepingProcess(inlineKit);

      const migration = await startFieldAddition(inlineKit, table, FIELD);

      const recovery = sweeping.nextRunOf(migration.migrationId);
      inlineKit.recoveryScope.include(migration.migrationId);
      await expect((await recovery).result).resolves.toBe('completed');
      await expectMigrationAbsent(inlineKit, table.revisionId, table.tableId);
    });

    let inlineKit: MigrationTestKit;

    beforeAll(async () => {
      inlineKit = await createMigrationTestKit({
        batchSize: BATCH_SIZE,
        workerMode: 'inline',
        pollIntervalMs: SWEEP_INTERVAL_MS,
      });
    });

    afterEach(async () => {
      jest.restoreAllMocks();
      await inlineKit.guard.verifyAndForget();
    });

    afterAll(async () => {
      await inlineKit.close();
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
    await releaseHeldOperations();
    jest.restoreAllMocks();
    await kit.guard.verifyAndForget();
  });

  afterAll(async () => {
    await kit.close();
  });

  function readActiveMigrations(revisionId: string) {
    return kit.prisma.tableMigration.findMany({
      where: { revisionId, status: { in: [...ACTIVE_MIGRATION_STATUSES] } },
    });
  }

  async function readTheActiveMigration(revisionId: string) {
    const active = await readActiveMigrations(revisionId);
    expect(active).toHaveLength(1);

    return active[0] as TableMigration;
  }

  async function expectActiveMigrations(
    revisionId: string,
    migrationIds: string[],
  ): Promise<void> {
    const active = await readActiveMigrations(revisionId);

    expect(active.map(({ id }) => id)).toEqual(migrationIds);
  }

  async function expectNoActiveMigrationOutsideTheDraft(
    branchId: string,
  ): Promise<void> {
    const committed = await kit.prisma.revision.findMany({
      where: { branchId, isDraft: false },
      select: { id: true },
    });
    const outsideTheDraft = await kit.prisma.tableMigration.findMany({
      where: {
        revisionId: { in: committed.map(({ id }) => id) },
        status: { in: [...ACTIVE_MIGRATION_STATUSES] },
      },
    });

    expect(outsideTheDraft).toEqual([]);
  }
});

function expectOneStartedAndTheOtherLocked(
  outcomes: PromiseSettledResult<StartedMigration>[],
): StartedMigration {
  const started = outcomes.flatMap((outcome) =>
    outcome.status === 'fulfilled' ? [outcome.value] : [],
  );
  const refusals = outcomes.flatMap((outcome) =>
    outcome.status === 'rejected' ? [outcome.reason as unknown] : [],
  );

  expect(refusals).toEqual([expect.any(MigrationLockedException)]);
  expect(started).toHaveLength(1);

  return started[0] as StartedMigration;
}

function failWorkerTriggers(kit: MigrationTestKit) {
  return jest
    .spyOn(kit.module.get(MigrationWorkerService), 'triggerInline')
    .mockRejectedValue(new Error('The worker could not be triggered'));
}
