import { expectMigrationAbsent } from 'src/__tests__/assertions/migration';
import {
  createMigrationTestKit,
  type MigrationTestKit,
} from 'src/__tests__/kit/create-migration-test-kit';
import type { TableMigration } from 'src/engine-prisma-types';
import {
  readBranchFenceLocks,
  waitUntilQueuedBehindFence,
} from 'src/features/draft/commands/handlers/__tests__/support/branch-write-fence';
import { holdNextOperationEscalatedUnderItsFence } from 'src/features/draft/commands/handlers/__tests__/support/escalating-commits';
import { MigrationLockedException } from 'src/features/migration/exceptions/migration-locked.exception';
import {
  MigrationPhase,
  MigrationStatus,
} from 'src/features/migration/types/migration.types';
import { BranchWriteFencedException } from 'src/infrastructure/database/branch-write-fenced.exception';
import {
  afterRetry,
  afterSwapBegins,
  pauseUntil,
  releaseStartedOwners,
  startOwnerUntil,
  type PausedOperation,
} from './support/migration-owners';
import {
  commitDraft,
  givenCommittedTable,
  givenStartedFieldAddition,
  startFieldAddition,
  type DraftOwnedTable,
  type StartedMigration,
} from './support/migration-scenario';
import {
  expectOneRecordedUpdate,
  expectSchemaHistoryToEndWith,
  readDraftState,
} from './support/revision-records';
import { recordSwapFailures } from './support/swap-faults';

const BATCH_SIZE = 5;
const ROW_COUNT = 3 * BATCH_SIZE;
const FIELD = 'price';
const SHORT_TRANSACTION_TIMEOUT_MS = 3000;

interface QueuedBehindFence<T> {
  result: Promise<T>;
}

describe('Async migration start and swap behind an escalated commit holding the branch write fence', () => {
  describe('within the fence wait limit', () => {
    it('AM-32 a swap queued behind the commit completes with its recorded update after the commit refuses with MIGRATION_LOCKED and releases the fence', async () => {
      const migration = await givenMigration(kit);
      const owner = await startOwnerUntil(
        kit,
        migration.migrationId,
        afterSwapBegins(kit),
      );
      const commit = await escalateCommitUntilItHoldsTheFence(kit, migration);

      const swap = await queueBehindTheFence(kit, migration, () =>
        owner.resume(),
      );

      await expect(commit.resume()).rejects.toThrow(MigrationLockedException);
      await expect(swap.result).resolves.toBe('completed');
      await expectMigrationAbsent(kit, migration.revisionId, migration.tableId);
      await expectOneRecordedUpdate(kit, migration, migration.patches);
      await expectSchemaHistoryToEndWith(kit, migration, migration.patches);
      await expectBranchFenceFree(kit, migration);
    });

    it('a start queued behind the commit records its migration after the commit refuses and releases the fence', async () => {
      const table = await givenCommittedTable(kit, { rowCount: ROW_COUNT });
      const commit = await escalateCommitUntilItHoldsTheFence(kit, table);

      const start = await queueBehindTheFence(kit, table, () =>
        startFieldAddition(kit, table, FIELD),
      );
      await expectMigrationAbsent(kit, table.revisionId, table.tableId);

      await expect(commit.resume()).rejects.toThrow('There are no changes');
      const started = await start.result;
      await expect(readMigration(kit, started)).resolves.toMatchObject({
        status: MigrationStatus.PENDING,
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
  });

  describe('past the fence wait limit', () => {
    it('AM-32 a swap fails BRANCH_WRITE_FENCED as a transient failure that keeps it SWAPPING, and the next claim completes it once the fence is free', async () => {
      const migration = await givenMigration(kit);
      const owner = await startOwnerUntil(
        kit,
        migration.migrationId,
        afterSwapBegins(kit),
      );
      const swapFailures = recordSwapFailures(kit);
      const commit = await escalateCommitUntilItHoldsTheFence(kit, migration);

      await owner.continueUntil(afterRetry(kit));

      expect(swapFailures).toEqual([expect.any(BranchWriteFencedException)]);
      await expect(readMigration(kit, migration)).resolves.toMatchObject({
        status: MigrationStatus.SWAPPING,
        phase: MigrationPhase.SWAPPING,
        errorMessage: null,
        completedAt: null,
        retryCount: 1,
        lockedBy: null,
      });
      await expect(commit.resume()).rejects.toThrow(MigrationLockedException);
      await expect(owner.resume()).resolves.toBe('completed');
      await expectMigrationAbsent(kit, migration.revisionId, migration.tableId);
      await expectOneRecordedUpdate(kit, migration, migration.patches);
    });

    it('a start fails BRANCH_WRITE_FENCED to its caller and records nothing', async () => {
      const table = await givenCommittedTable(kit, { rowCount: ROW_COUNT });
      const draftBefore = await readDraftState(kit, table);
      const commit = await escalateCommitUntilItHoldsTheFence(kit, table);

      await expect(startFieldAddition(kit, table, FIELD)).rejects.toThrow(
        BranchWriteFencedException,
      );

      await expect(commit.resume()).rejects.toThrow('There are no changes');
      await expectMigrationAbsent(kit, table.revisionId, table.tableId);
      await expect(readDraftState(kit, table)).resolves.toEqual(draftBefore);
    });

    let kit: MigrationTestKit;

    beforeAll(async () => {
      kit = await createMigrationTestKit({
        batchSize: BATCH_SIZE,
        workerMode: 'disabled',
        transactionTimeoutMs: SHORT_TRANSACTION_TIMEOUT_MS,
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
  });
});

async function expectBranchFenceFree(
  kit: MigrationTestKit,
  { branchId }: DraftOwnedTable,
): Promise<void> {
  await expect(
    readBranchFenceLocks(fenceDatabaseOf(kit), branchId),
  ).resolves.toEqual([]);
}

function givenMigration(kit: MigrationTestKit): Promise<StartedMigration> {
  return givenStartedFieldAddition(kit, { rowCount: ROW_COUNT, field: FIELD });
}

function escalateCommitUntilItHoldsTheFence(
  kit: MigrationTestKit,
  table: DraftOwnedTable,
): Promise<PausedOperation<unknown>> {
  const escalatedAttempt = holdNextOperationEscalatedUnderItsFence(kit);

  return pauseUntil(commitDraft(kit, table), { barrier: escalatedAttempt });
}

async function queueBehindTheFence<T>(
  kit: MigrationTestKit,
  { branchId }: DraftOwnedTable,
  operation: () => Promise<T>,
): Promise<QueuedBehindFence<T>> {
  const result = operation();
  await waitUntilQueuedBehindFence(fenceDatabaseOf(kit), branchId, result);

  return { result };
}

function readMigration(
  kit: MigrationTestKit,
  { migrationId }: Pick<StartedMigration, 'migrationId'>,
): Promise<TableMigration> {
  return kit.prisma.tableMigration.findUniqueOrThrow({
    where: { id: migrationId },
  });
}

function fenceDatabaseOf(kit: MigrationTestKit) {
  return { prismaService: kit.prisma };
}
