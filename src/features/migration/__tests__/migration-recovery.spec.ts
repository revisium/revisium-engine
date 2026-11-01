import { expectMigrationAbsent } from 'src/__tests__/assertions/migration';
import {
  createMigrationTestKit,
  type MigrationTestKit,
} from 'src/__tests__/kit/create-migration-test-kit';
import { prepareBranch } from 'src/__tests__/utils/prepareProject';
import type { TableMigration } from 'src/engine-prisma-types';
import { decodeMigrationPayload } from 'src/features/migration/migration-payload';
import type { MigrationOptions } from 'src/features/migration/types/migration-options.types';
import {
  MigrationPhase,
  MigrationStatus,
  type MigrationStepResult,
} from 'src/features/migration/types/migration.types';
import {
  givenLegacyRecord,
  type LegacyRecordShape,
} from './support/legacy-migrations';
import {
  createMigrationRecord,
  expireLease,
  passTimeWithoutProgress,
  type MigrationFixtureOptions,
} from './support/migration-database';
import {
  afterClaimableFound,
  afterSwapBegins,
  afterSwapTransactionCommits,
  afterTakeoverWins,
  beforeBatchWrite,
  beforeCopyStarts,
  beforeSwapTransaction,
  findStalledSwapOwner,
  insideSwapAfterItsRecordCheck,
  observeStalledSwap,
  releaseStartedOwners,
  startOwnerUntil,
  sweptUntil,
  takeOverUntil,
  waitUntilSettledOrBlockedBy,
  type PausedOwner,
} from './support/migration-owners';
import {
  givenStartedFieldAddition,
  type StartedMigration,
} from './support/migration-scenario';
import {
  observeSweepingProcess,
  type SweepingProcess,
} from './support/migration-sweeps';

const BATCH_SIZE = 5;
const ROW_COUNT = 3 * BATCH_SIZE;
const MAX_RETRIES = 3;
const FIELD = 'price';
const OBSERVERS = 3;

const LOCK_TIMEOUT_MS = 10_000;
const STALL_TIMEOUT_MS = 60_000;
const DEADLINE_MARGIN_MS = STALL_TIMEOUT_MS / 2;
const SWEEP_INTERVAL_MS = 50;

interface LegacyRecordRow {
  record: string;
  shape: LegacyRecordShape;
}

describe('Async migration recovery', () => {
  it('AM-05 after an inline restart within the old lease, the recurring sweep claims the migration once the lease expired and completes it', async () => {
    const migration = await givenMigration();
    const previousOwner = await startOwnerUntil(
      kit,
      migration.migrationId,
      beforeBatchWrite(kit, 2),
    );
    const restarted = await startSweepingProcess('inline', [
      migration.migrationId,
    ]);

    await restarted.sweepsCompleted(1);
    await expectMigrationState(migration, {
      status: MigrationStatus.COPYING,
      phase: MigrationPhase.COPYING,
      startedAt: expect.any(Date),
      completedAt: null,
      lockedBy: previousOwner.lease.token,
    });

    const recovery = restarted.nextRunOf(migration.migrationId);
    await expireLease(kit.prisma, migration.migrationId, LOCK_TIMEOUT_MS);

    await expect((await recovery).result).resolves.toBe('completed');
    await expectMigrationAbsent(kit, migration.revisionId, migration.tableId);
    await expect(previousOwner.resume()).resolves.toBe('stopped');
    await expectRowsMigratedOnce(migration);
  });

  describe('AM-10 progress deadline', () => {
    it('(a) cancels a never-claimed migration past the deadline', async () => {
      const migration = await givenMigration();
      await passTimeWithoutProgress(
        kit.prisma,
        migration.migrationId,
        pastStallTimeout(),
      );

      await kit.migrationStallRecovery.cancelStalled();

      await expectMigrationState(migration, {
        status: MigrationStatus.CANCELLED,
        phase: MigrationPhase.INIT,
        startedAt: null,
        completedAt: expect.any(Date),
        errorMessage: expect.stringMatching(/^STALLED: /),
        lockedBy: null,
      });
    });

    it('(b) cancels a COPYING migration whose owner heartbeats without batch progress past the deadline', async () => {
      const migration = await givenMigration();
      const owner = await startOwnerUntil(
        kit,
        migration.migrationId,
        beforeBatchWrite(kit, 2),
      );
      await passTimeWithoutProgress(
        kit.prisma,
        migration.migrationId,
        pastStallTimeout(),
      );

      await kit.migrationStallRecovery.cancelStalled();

      await expectMigrationState(migration, {
        status: MigrationStatus.CANCELLED,
        phase: MigrationPhase.COPYING,
        startedAt: expect.any(Date),
        completedAt: expect.any(Date),
        errorMessage: expect.stringMatching(/^STALLED: /),
        copiedRows: BATCH_SIZE,
        lockedBy: null,
      });
      await expect(owner.resume()).resolves.toBe('stopped');
    });

    it('measures the deadline of a migration claimed after a long wait from its claim', async () => {
      const migration = await givenMigration();
      await passTimeWithoutProgress(
        kit.prisma,
        migration.migrationId,
        pastStallTimeout(),
      );
      const owner = await startOwnerUntil(
        kit,
        migration.migrationId,
        beforeCopyStarts(kit),
      );

      await kit.migrationStallRecovery.cancelStalled();

      await expectMigrationState(migration, {
        status: MigrationStatus.PENDING,
        phase: MigrationPhase.INIT,
        startedAt: null,
        completedAt: null,
        lockedBy: owner.lease.token,
      });
      await expect(owner.resume()).resolves.toBe('completed');
    });

    it('leaves a SWAPPING owner past the stall timeout alone while the native runner may still retry its swap', async () => {
      expect(nativeRunnerBudgetMs()).toBeGreaterThan(pastStallTimeout());
      const migration = await givenMigration();
      const owner = await startOwnerUntil(
        kit,
        migration.migrationId,
        beforeSwapTransaction(kit, 1),
      );
      await passTimeWithoutProgress(
        kit.prisma,
        migration.migrationId,
        pastStallTimeout(),
      );

      await kit.migrationStallRecovery.cancelStalled();

      await expect(
        findStalledSwapOwner(kit, migration.migrationId),
      ).resolves.toBeUndefined();
      await expectMigrationState(migration, {
        status: MigrationStatus.SWAPPING,
        phase: MigrationPhase.SWAPPING,
        startedAt: expect.any(Date),
        completedAt: null,
        retryCount: 0,
        lockedBy: owner.lease.token,
      });
      await expect(owner.resume()).resolves.toBe('completed');
    });
  });

  describe('AM-11 a stalled SWAPPING owner', () => {
    it('is taken over once by several observers after its bound, and its late swap is rejected', async () => {
      const migration = await givenMigration();
      const stalled = await startOwnerUntil(
        kit,
        migration.migrationId,
        beforeSwapTransaction(kit, 1),
      );
      await passTimeWithoutProgress(
        kit.prisma,
        migration.migrationId,
        pastSwapBound(),
      );

      const replacementSwap = beforeSwapTransaction(kit, 2);
      const observers = takeOverByObservers(migration);
      await replacementSwap.barrier.expectReachedBefore(observers);
      const { lockedBy } = await expectMigrationState(migration, {
        status: MigrationStatus.SWAPPING,
        phase: MigrationPhase.SWAPPING,
        startedAt: expect.any(Date),
        completedAt: null,
        retryCount: 1,
      });
      expect(lockedBy).not.toBe(stalled.lease.token);

      replacementSwap.barrier.release();
      expectOneDriverCompleted(await observers);
      await expectMigrationAbsent(kit, migration.revisionId, migration.tableId);
      await expect(stalled.resume()).resolves.toBe('stopped');
      await expectRowsMigratedOnce(migration);
    });

    it('lets a replacement whose swap takes most of a bound complete', async () => {
      const migration = await givenMigration();
      const stalled = await startOwnerUntil(
        kit,
        migration.migrationId,
        beforeSwapTransaction(kit, 1),
      );
      await passTimeWithoutProgress(
        kit.prisma,
        migration.migrationId,
        pastSwapBound(),
      );
      const replacement = await takeOverUntil(
        kit,
        migration.migrationId,
        beforeSwapTransaction(kit, 2),
      );

      await passTimeWithoutProgress(
        kit.prisma,
        migration.migrationId,
        mostOfSwapBound(),
      );

      await expect(
        findStalledSwapOwner(kit, migration.migrationId),
      ).resolves.toBeUndefined();
      await expectMigrationState(migration, {
        status: MigrationStatus.SWAPPING,
        phase: MigrationPhase.SWAPPING,
        startedAt: expect.any(Date),
        completedAt: null,
        retryCount: 1,
        lockedBy: replacement.lease.token,
      });
      await expect(replacement.resume()).resolves.toBe('completed');
      await expect(stalled.resume()).resolves.toBe('stopped');
      await expectRowsMigratedOnce(migration);
    });

    it('fails SWAP_STALLED after maxRetries takeovers of owners that keep stalling', async () => {
      const migration = await givenMigration();
      await startOwnerUntil(
        kit,
        migration.migrationId,
        beforeSwapTransaction(kit, 1),
      );
      await takeOverOwnersThatKeepStalling(migration, MAX_RETRIES);
      await passTimeWithoutProgress(
        kit.prisma,
        migration.migrationId,
        pastSwapBound(),
      );

      await kit.migrationService.takeOverStalledSwap(
        await observeStalledSwap(kit, migration.migrationId),
      );

      await expectSwapStalled(migration);
    });

    it('fails SWAP_STALLED after maxRetries claims of owners that crash after T-swap-begin', async () => {
      const migration = await givenMigration();
      await startOwnerUntil(kit, migration.migrationId, afterSwapBegins(kit));
      await claimAfterOwnersCrash(migration, MAX_RETRIES);
      await expireLease(kit.prisma, migration.migrationId, LOCK_TIMEOUT_MS);

      await kit.migrationService.processMigration(migration.migrationId);

      await expectSwapStalled(migration);
    });
  });

  describe('a takeover racing the swap commit of the stalled owner', () => {
    it('finds no record once the swap transaction it waited for commits, and swaps nothing', async () => {
      const migration = await givenMigration();
      const owner = await startOwnerUntil(
        kit,
        migration.migrationId,
        afterSwapBegins(kit),
      );
      const stalledOwner = await observeStalledOwnerPastSwapBound(migration);
      const swaps = jest.spyOn(kit.transactionService, 'runSerializable');
      const swapTransaction = insideSwapAfterItsRecordCheck(kit);
      await owner.continueUntil(swapTransaction);

      const takeover = kit.migrationService.takeOverStalledSwap(stalledOwner);
      await waitUntilSettledOrBlockedBy(
        kit,
        swapTransaction.backendPid(),
        takeover,
      );

      await expect(owner.resume()).resolves.toBe('completed');
      await expect(takeover).resolves.toBe('stopped');
      expect(swaps).toHaveBeenCalledTimes(1);
      await expectMigrationAbsent(kit, migration.revisionId, migration.tableId);
      await expectRowsMigratedOnce(migration);
    });

    it('finds no record right after the swap committed, and swaps nothing', async () => {
      const migration = await givenMigration();
      const owner = await startOwnerUntil(
        kit,
        migration.migrationId,
        afterSwapBegins(kit),
      );
      const stalledOwner = await observeStalledOwnerPastSwapBound(migration);
      const swapCommitted = afterSwapTransactionCommits(kit);
      const swaps = jest.spyOn(kit.transactionService, 'runSerializable');
      await owner.continueUntil(swapCommitted);

      await expect(
        kit.migrationService.takeOverStalledSwap(stalledOwner),
      ).resolves.toBe('stopped');

      expect(swaps).toHaveBeenCalledTimes(1);
      await expectMigrationAbsent(kit, migration.revisionId, migration.tableId);
      await expect(owner.resume()).resolves.toBe('completed');
      await expectRowsMigratedOnce(migration);
    });
  });

  describe('scheduling of a sweeping process', () => {
    it('claims no abandoned migration while a takeover it started is still acquiring its lease', async () => {
      const stalled = await givenMigration();
      await startOwnerUntil(kit, stalled.migrationId, afterSwapBegins(kit));
      await passTimeWithoutProgress(
        kit.prisma,
        stalled.migrationId,
        pastSwapBound(),
      );
      const abandoned = await givenMigration();
      const sweeping = await startSweepingProcess('polling', [
        stalled.migrationId,
        abandoned.migrationId,
      ]);

      const replacement = await sweptUntil(
        sweeping,
        stalled.migrationId,
        afterTakeoverWins(sweeping.kit),
      );
      await sweeping.sweepsCompleted(1);
      await expectMigrationState(abandoned, {
        status: MigrationStatus.PENDING,
        lockedBy: null,
      });

      const abandonedRun = sweeping.nextRunOf(abandoned.migrationId);
      await expect(replacement.resume()).resolves.toBe('completed');
      await expect((await abandonedRun).result).resolves.toBe('completed');
      await expectMigrationAbsent(kit, stalled.revisionId, stalled.tableId);
    });

    it('claims no abandoned migration when it starts driving another one while it looks for one', async () => {
      const abandoned = await givenMigration();
      const driven = await givenMigration();
      const sweeping = await startSweepingProcess('polling', [
        abandoned.migrationId,
      ]);
      const discovery = afterClaimableFound(sweeping.kit);
      await discovery.barrier.expectReachedBefore(sweeping.sweepsCompleted(1));

      const drivenOwner = await startOwnerUntil(
        sweeping.kit,
        driven.migrationId,
        beforeCopyStarts(sweeping.kit),
      );
      discovery.barrier.release();
      await sweeping.sweepsCompleted(1);
      await expectMigrationState(abandoned, {
        status: MigrationStatus.PENDING,
        lockedBy: null,
      });

      const abandonedRun = sweeping.nextRunOf(abandoned.migrationId);
      await expect(drivenOwner.resume()).resolves.toBe('completed');
      await expect((await abandonedRun).result).resolves.toBe('completed');
    });

    it('claims and completes the next migration once the record of its suspended driver is cancelled', async () => {
      const suspended = await givenMigration();
      const sweeping = await startSweepingProcess('polling', [
        suspended.migrationId,
      ]);
      const suspendedDriver = await sweptUntil(
        sweeping,
        suspended.migrationId,
        beforeBatchWrite(sweeping.kit, 2),
      );
      const next = await givenMigration();
      sweeping.kit.recoveryScope.include(next.migrationId);

      await sweeping.sweepsCompleted(1);
      await expectMigrationState(next, {
        status: MigrationStatus.PENDING,
        lockedBy: null,
      });

      const nextRun = sweeping.nextRunOf(next.migrationId);
      await passTimeWithoutProgress(
        kit.prisma,
        suspended.migrationId,
        pastStallTimeout(),
      );
      await sweeping.sweepsCompleted(1);

      await expectMigrationState(suspended, {
        status: MigrationStatus.CANCELLED,
        errorMessage: expect.stringMatching(/^STALLED: /),
        lockedBy: null,
      });
      await expectNoLongerWaitingForAnOwner(next);
      await expect((await nextRun).result).resolves.toBe('completed');
      await expect(suspendedDriver.resume()).resolves.toBe('stopped');
    });
  });

  describe('recovery scope', () => {
    it('leaves records outside its scope untouched while a scoped process starts and sweeps', async () => {
      const foreignRecords = await givenForeignRecordOfEveryRecovery();
      const own = await givenMigration();
      const sweeping = await startSweepingProcess('polling');

      await sweeping.sweepsCompleted(1);
      await expectUntouched(foreignRecords);

      sweeping.kit.recoveryScope.include(own.migrationId);
      const ownDriver = await sweptUntil(
        sweeping,
        own.migrationId,
        beforeCopyStarts(sweeping.kit),
      );
      await sweeping.sweepsCompleted(1);

      await expectUntouched(foreignRecords);
      await expect(ownDriver.resume()).resolves.toBe('completed');
    });
  });

  describe('AM-12 legacy records at startup', () => {
    const kept: LegacyRecordRow[] = [
      { record: 'FAILED', shape: { status: MigrationStatus.FAILED } },
      { record: 'CANCELLED', shape: { status: MigrationStatus.CANCELLED } },
    ];
    const cancelled: LegacyRecordRow[] = [
      { record: 'PENDING', shape: { status: MigrationStatus.PENDING } },
      { record: 'COPYING', shape: { status: MigrationStatus.COPYING } },
      {
        record: 'SWAPPING whose Draft links the source table',
        shape: { status: MigrationStatus.SWAPPING, linkedTable: 'source' },
      },
      {
        record: 'SWAPPING whose Draft links neither table',
        shape: { status: MigrationStatus.SWAPPING, linkedTable: 'neither' },
      },
      {
        record: 'SWAPPING whose revision is no longer the Draft',
        shape: {
          status: MigrationStatus.SWAPPING,
          revision: 'committed',
          linkedTable: 'shadow',
        },
      },
    ];
    const deleted: LegacyRecordRow[] = [
      {
        record: 'SWAPPING whose revision is missing',
        shape: {
          status: MigrationStatus.SWAPPING,
          revision: 'missing',
          linkedTable: 'neither',
        },
      },
      {
        record: 'SWAPPING whose Draft links the shadow table',
        shape: { status: MigrationStatus.SWAPPING, linkedTable: 'shadow' },
      },
    ];
    const legacyRecords = new Map<string, TableMigration>();
    let activeEnvelopeRecord: TableMigration;

    it.each(kept)('keeps a $record record', async ({ record }) => {
      const before = legacyRecordBefore(record);

      const after = await readMigration(before);

      expect(after).toEqual(before);
      expect(decodeMigrationPayload(after.patches).version).toBe(1);
    });

    it.each(cancelled)(
      'cancels a $record record as LEGACY_JOB',
      async ({ record }) => {
        const before = legacyRecordBefore(record);

        await expectMigrationState(before, {
          status: MigrationStatus.CANCELLED,
          phase: before.phase,
          startedAt: before.startedAt,
          completedAt: expect.any(Date),
          errorMessage: expect.stringMatching(/^LEGACY_JOB: /),
          lockedBy: null,
        });
      },
    );

    it.each(deleted)('deletes a $record record', async ({ record }) => {
      const before = legacyRecordBefore(record);

      await expect(
        kit.prisma.tableMigration.findUnique({ where: { id: before.id } }),
      ).resolves.toBeNull();
    });

    it('leaves an active record with a payload envelope to the workers', async () => {
      await expect(readMigration(activeEnvelopeRecord)).resolves.toEqual(
        activeEnvelopeRecord,
      );
    });

    beforeAll(async () => {
      for (const { record, shape } of [...kept, ...cancelled, ...deleted]) {
        legacyRecords.set(record, await givenLegacyRecordSnapshot(shape));
      }

      activeEnvelopeRecord = await givenActiveEnvelopeRecord();
      await restartProcess([
        ...[...legacyRecords.values()].map((record) => record.id),
        activeEnvelopeRecord.id,
      ]);
    });

    function legacyRecordBefore(record: string): TableMigration {
      const before = legacyRecords.get(record);

      if (!before) {
        throw new Error(`No legacy ${record} record was prepared`);
      }

      return before;
    }
  });

  let kit: MigrationTestKit;
  const restartedProcesses: MigrationTestKit[] = [];

  beforeAll(async () => {
    kit = await createMigrationTestKit({
      batchSize: BATCH_SIZE,
      workerMode: 'disabled',
      lockTimeoutMs: LOCK_TIMEOUT_MS,
      stallTimeoutMs: STALL_TIMEOUT_MS,
    });
  });

  afterEach(async () => {
    await releaseStartedOwners();
    await closeRestartedProcesses();
    jest.restoreAllMocks();
    await kit.guard.verifyAndForget();
  });

  afterAll(async () => {
    await kit.close();
  });

  async function readMigration(
    migration: StartedMigration | { id: string },
  ): Promise<TableMigration> {
    return kit.prisma.tableMigration.findUniqueOrThrow({
      where: { id: migrationIdOf(migration) },
    });
  }

  async function expectMigrationState(
    migration: StartedMigration | { id: string },
    expected: Partial<TableMigration>,
  ): Promise<TableMigration> {
    const record = await readMigration(migration);
    expect(record).toMatchObject(expected);

    return record;
  }

  async function expectUntouched(records: TableMigration[]): Promise<void> {
    for (const record of records) {
      await expect(readMigration(record)).resolves.toEqual(record);
    }
  }

  async function expectNoLongerWaitingForAnOwner(
    migration: StartedMigration,
  ): Promise<void> {
    const record = await kit.prisma.tableMigration.findUnique({
      where: { id: migration.migrationId },
      select: { status: true, lockedBy: true },
    });

    expect(record).not.toEqual({
      status: MigrationStatus.PENDING,
      lockedBy: null,
    });
  }

  async function expectSwapStalled(migration: StartedMigration): Promise<void> {
    await expectMigrationState(migration, {
      status: MigrationStatus.FAILED,
      phase: MigrationPhase.SWAPPING,
      startedAt: expect.any(Date),
      completedAt: expect.any(Date),
      errorMessage: expect.stringMatching(/^SWAP_STALLED: /),
      retryCount: MAX_RETRIES,
      lockedBy: null,
    });
  }

  async function expectRowsMigratedOnce(
    migration: StartedMigration,
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
      expect(row.data).toHaveProperty(migration.field);
    }
  }

  function expectOneDriverCompleted(results: MigrationStepResult[]): void {
    expect([...results].sort()).toEqual([
      'completed',
      ...Array<MigrationStepResult>(OBSERVERS - 1).fill('stopped'),
    ]);
  }

  async function givenMigration(): Promise<StartedMigration> {
    const migration = await givenStartedFieldAddition(kit, {
      rowCount: ROW_COUNT,
      field: FIELD,
    });
    kit.recoveryScope.include(migration.migrationId);

    return migration;
  }

  async function givenForeignRecordOfEveryRecovery(): Promise<
    TableMigration[]
  > {
    const legacy = await givenLegacyRecord(kit.prisma, {
      status: MigrationStatus.PENDING,
    });
    const abandoned = await givenForeignRecord(MigrationStatus.PENDING);
    const stalled = await givenForeignRecord(MigrationStatus.COPYING, {
      lockedBy: 'foreign-owner',
      heartbeatAt: new Date(),
    });
    const stalledSwap = await givenForeignRecord(MigrationStatus.SWAPPING, {
      lockedBy: 'foreign-owner',
      lockedAt: new Date(),
      heartbeatAt: new Date(),
    });
    await passTimeWithoutProgress(kit.prisma, stalled.id, pastStallTimeout());
    await passTimeWithoutProgress(kit.prisma, stalledSwap.id, pastSwapBound());

    return Promise.all(
      [legacy, abandoned.id, stalled.id, stalledSwap.id].map((id) =>
        readMigration({ id }),
      ),
    );
  }

  async function givenForeignRecord(
    status: MigrationStatus,
    owner: MigrationFixtureOptions = {},
  ): Promise<TableMigration> {
    const branch = await prepareBranch(kit.prisma);

    return createMigrationRecord(
      kit.prisma,
      branch.draftRevisionId,
      status,
      owner,
    );
  }

  async function observeStalledOwnerPastSwapBound(migration: StartedMigration) {
    await passTimeWithoutProgress(
      kit.prisma,
      migration.migrationId,
      pastSwapBound(),
    );

    return observeStalledSwap(kit, migration.migrationId);
  }

  async function givenLegacyRecordSnapshot(
    shape: LegacyRecordShape,
  ): Promise<TableMigration> {
    return readMigration({ id: await givenLegacyRecord(kit.prisma, shape) });
  }

  async function givenActiveEnvelopeRecord(): Promise<TableMigration> {
    const branch = await prepareBranch(kit.prisma);

    return createMigrationRecord(
      kit.prisma,
      branch.draftRevisionId,
      MigrationStatus.COPYING,
      { lockedBy: 'running-worker', heartbeatAt: new Date() },
    );
  }

  async function takeOverByObservers(
    migration: StartedMigration,
  ): Promise<MigrationStepResult[]> {
    const observations = [];

    for (let observer = 0; observer < OBSERVERS; observer++) {
      observations.push(await observeStalledSwap(kit, migration.migrationId));
    }

    return Promise.all(
      observations.map((stalledOwner) =>
        kit.migrationService.takeOverStalledSwap(stalledOwner),
      ),
    );
  }

  async function takeOverOwnersThatKeepStalling(
    migration: StartedMigration,
    takeovers: number,
  ): Promise<void> {
    for (let takeover = 1; takeover <= takeovers; takeover++) {
      await passTimeWithoutProgress(
        kit.prisma,
        migration.migrationId,
        pastSwapBound(),
      );
      const owner = await takeOverUntil(
        kit,
        migration.migrationId,
        beforeSwapTransaction(kit, takeover + 1),
      );
      await expectOwnedAfterRetries(migration, owner, takeover);
    }
  }

  async function claimAfterOwnersCrash(
    migration: StartedMigration,
    claims: number,
  ): Promise<void> {
    for (let claim = 1; claim <= claims; claim++) {
      await expireLease(kit.prisma, migration.migrationId, LOCK_TIMEOUT_MS);
      const owner = await startOwnerUntil(
        kit,
        migration.migrationId,
        beforeSwapTransaction(kit, claim),
      );
      await expectOwnedAfterRetries(migration, owner, claim);
    }
  }

  async function expectOwnedAfterRetries(
    migration: StartedMigration,
    owner: PausedOwner,
    retryCount: number,
  ): Promise<void> {
    await expectMigrationState(migration, {
      status: MigrationStatus.SWAPPING,
      phase: MigrationPhase.SWAPPING,
      completedAt: null,
      retryCount,
      lockedBy: owner.lease.token,
    });
  }

  async function startSweepingProcess(
    workerMode: NonNullable<MigrationOptions['workerMode']>,
    recoveryScope: string[] = [],
  ): Promise<SweepingProcess> {
    const restarted = await createMigrationTestKit({
      batchSize: BATCH_SIZE,
      workerMode,
      pollIntervalMs: SWEEP_INTERVAL_MS,
      lockTimeoutMs: LOCK_TIMEOUT_MS,
      stallTimeoutMs: STALL_TIMEOUT_MS,
      recoveryScope,
    });
    restartedProcesses.push(restarted);

    return observeSweepingProcess(restarted);
  }

  async function restartProcess(recoveryScope: string[]): Promise<void> {
    const restarted = await createMigrationTestKit({
      workerMode: 'disabled',
      recoveryScope,
    });
    await restarted.close();
  }

  async function closeRestartedProcesses(): Promise<void> {
    for (const restarted of restartedProcesses.splice(0)) {
      await restarted.close();
    }
  }

  function pastStallTimeout(): number {
    return STALL_TIMEOUT_MS + DEADLINE_MARGIN_MS;
  }

  function pastSwapBound(): number {
    return swapBoundMs() + DEADLINE_MARGIN_MS;
  }

  function mostOfSwapBound(): number {
    return swapBoundMs() - DEADLINE_MARGIN_MS;
  }

  function swapBoundMs(): number {
    return Math.max(STALL_TIMEOUT_MS, nativeRunnerBudgetMs());
  }

  function nativeRunnerBudgetMs(): number {
    const transactions = kit.transactionService;

    return (
      transactions.serializableTimeoutMs * transactions.serializableMaxAttempts
    );
  }
});

function migrationIdOf(migration: StartedMigration | { id: string }): string {
  return 'migrationId' in migration ? migration.migrationId : migration.id;
}
