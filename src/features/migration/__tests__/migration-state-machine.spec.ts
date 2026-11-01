import type { JsonSchema } from '@revisium/schema-toolkit/types';
import { expectMigrationAbsent } from 'src/__tests__/assertions/migration';
import {
  createMigrationTestKit,
  type MigrationTestKit,
} from 'src/__tests__/kit/create-migration-test-kit';
import { prepareBranch } from 'src/__tests__/utils/prepareProject';
import type { TableMigration } from 'src/engine-prisma-types';
import { decodeMigrationPayload } from 'src/features/migration/migration-payload';
import type { MigrationCheckpoint } from 'src/features/migration/services/migration-transitions';
import {
  MigrationPhase,
  MigrationStatus,
} from 'src/features/migration/types/migration.types';
import {
  cancelKeepingOwner,
  createMigrationRecord,
  expiredHeartbeat,
  expireLease,
  passTimeWithoutProgress,
  replacePayload,
} from './support/migration-database';
import {
  afterSwapBegins,
  beforeBatchWrite,
  beforeCopyStarts,
  insideSwapAfterItsRecordCheck,
  releaseStartedOwners,
  startOwnerUntil,
  waitUntilSettledOrBlockedBy,
  type PausedOwner,
} from './support/migration-owners';
import {
  givenStartedFieldAddition,
  type StartedMigration,
} from './support/migration-scenario';

const BATCH_SIZE = 5;
const ROW_COUNT = 3 * BATCH_SIZE;
const MAX_RETRIES = 3;
const FIELD = 'price';

// Below the default lease of sweeping test kits, whose claims then leave leases expired here alone.
const LOCK_TIMEOUT_MS = 10_000;
const STALL_TIMEOUT_MS = 60_000;

describe('Async migration state machine', () => {
  describe('AM-01 an owner paused between its claim and T-init', () => {
    it('stops without a shadow table after an abort deleted the record', async () => {
      const migration = await givenMigration();
      const owner = await startOwnerUntil(
        kit,
        migration.migrationId,
        beforeCopyStarts(kit),
      );
      await expectMigrationState(migration, {
        status: MigrationStatus.PENDING,
        phase: MigrationPhase.INIT,
        startedAt: null,
        completedAt: null,
        lockedBy: owner.lease.token,
      });

      await kit.migrationApi.abortMigration({
        revisionId: migration.revisionId,
        tableId: migration.tableId,
      });

      await expect(owner.resume()).resolves.toBe('stopped');
      await expectMigrationAbsent(kit, migration.revisionId, migration.tableId);
      await expectNoShadowTable(migration);
    });

    it('stops without a shadow table after the record became CANCELLED under its token', async () => {
      const migration = await givenMigration();
      const owner = await startOwnerUntil(
        kit,
        migration.migrationId,
        beforeCopyStarts(kit),
      );

      await cancelKeepingOwner(kit.prisma, migration.migrationId);

      await expect(owner.resume()).resolves.toBe('stopped');
      await expectMigrationState(migration, {
        status: MigrationStatus.CANCELLED,
        phase: MigrationPhase.INIT,
        startedAt: null,
        shadowTableVersionId: null,
      });
      await expectNoShadowTable(migration);
    });

    it('stops without a shadow table after another worker took its expired lease', async () => {
      const migration = await givenMigration();
      const owner = await startOwnerUntil(
        kit,
        migration.migrationId,
        beforeCopyStarts(kit),
      );

      await expireLease(kit.prisma, migration.migrationId, LOCK_TIMEOUT_MS);
      const otherLease = await kit.migrationLeases.claim(migration.migrationId);

      await expect(owner.resume()).resolves.toBe('stopped');
      await expectMigrationState(migration, {
        status: MigrationStatus.PENDING,
        phase: MigrationPhase.INIT,
        startedAt: null,
        shadowTableVersionId: null,
        lockedBy: otherLease?.token,
      });
      await expectNoShadowTable(migration);
    });
  });

  describe('copy batches', () => {
    it('AM-02 a batch waiting before its transaction writes nothing once T-deadline cancelled the record', async () => {
      const migration = await givenMigration();
      const owner = await startOwnerUntil(
        kit,
        migration.migrationId,
        beforeBatchWrite(kit, 2),
      );
      await expectMigrationState(migration, {
        status: MigrationStatus.COPYING,
        phase: MigrationPhase.COPYING,
        startedAt: expect.any(Date),
        completedAt: null,
        copiedRows: BATCH_SIZE,
      });

      await passTimeWithoutProgress(
        kit.prisma,
        migration.migrationId,
        2 * STALL_TIMEOUT_MS,
      );
      await kit.migrationStallRecovery.cancelStalled();

      await expect(owner.resume()).resolves.toBe('stopped');
      await expectMigrationState(migration, {
        status: MigrationStatus.CANCELLED,
        phase: MigrationPhase.COPYING,
        startedAt: expect.any(Date),
        completedAt: expect.any(Date),
        errorMessage: expect.stringMatching(/^STALLED: /),
        copiedRows: BATCH_SIZE,
        lockedBy: null,
      });
      await expectShadowRowCount(migration, BATCH_SIZE);
    });

    it('AM-03 a stalled owner cannot renew, write, release or fail after another worker claims its expired lease', async () => {
      const migration = await givenMigration();
      const stalled = await startOwnerUntil(
        kit,
        migration.migrationId,
        beforeBatchWrite(kit, 2),
      );
      const { startedAt } = await readMigration(migration);

      await expireLease(kit.prisma, migration.migrationId, LOCK_TIMEOUT_MS);
      const successor = await startOwnerUntil(
        kit,
        migration.migrationId,
        beforeBatchWrite(kit, 3),
      );
      const { heartbeatAt } = await expectMigrationState(migration, {
        status: MigrationStatus.COPYING,
        phase: MigrationPhase.COPYING,
        startedAt,
        completedAt: null,
        retryCount: 0,
        lockedBy: successor.lease.token,
      });

      await expect(kit.migrationLeases.renew(stalled.lease)).resolves.toBe(
        false,
      );
      await expect(stalled.resume()).resolves.toBe('stopped');
      await expectMigrationState(migration, {
        status: MigrationStatus.COPYING,
        copiedRows: BATCH_SIZE,
        heartbeatAt,
        lockedBy: successor.lease.token,
      });

      await expect(successor.resume()).resolves.toBe('completed');
      await expectMigrationAbsent(kit, migration.revisionId, migration.tableId);
      await expectRowsMigratedOnce(migration);
    });

    it('AM-04 the next claim after a crash resumes at the next batch without duplicates or gaps', async () => {
      const migration = await givenMigration();
      const crashed = await startOwnerUntil(
        kit,
        migration.migrationId,
        beforeBatchWrite(kit, 2),
      );
      await expectMigrationState(migration, {
        status: MigrationStatus.COPYING,
        phase: MigrationPhase.COPYING,
        startedAt: expect.any(Date),
        completedAt: null,
        copiedRows: BATCH_SIZE,
        currentBatch: 1,
      });

      await expireLease(kit.prisma, migration.migrationId, LOCK_TIMEOUT_MS);
      const batchLoads = jest.spyOn(kit.migrationBatchService, 'loadBatchRows');

      await expect(
        kit.migrationService.processMigration(migration.migrationId),
      ).resolves.toBe('completed');
      expect(batchLoads.mock.calls.map(([, after]) => after)).toEqual([
        lastRowOfBatch(migration, 1),
        lastRowOfBatch(migration, 2),
      ]);
      await expectMigrationAbsent(kit, migration.revisionId, migration.tableId);
      await expectRowsMigratedOnce(migration);

      await expect(crashed.resume()).resolves.toBe('stopped');
      await expectRowsMigratedOnce(migration);
    });

    it('AM-14 a stale batch writes nothing into the table that a swap and a commit published', async () => {
      const migration = await givenMigration();
      const stale = await startOwnerUntil(
        kit,
        migration.migrationId,
        beforeBatchWrite(kit, 2),
      );

      await expireLease(kit.prisma, migration.migrationId, LOCK_TIMEOUT_MS);
      await expect(
        kit.migrationService.processMigration(migration.migrationId),
      ).resolves.toBe('completed');
      await kit.draftApi.apiCreateRevision({
        projectId: migration.projectId,
        branchName: migration.branchName,
      });

      await expect(stale.resume()).resolves.toBe('stopped');
      await expectRowsMigratedOnce(migration);
    });

    it.each([
      {
        batch: 'a stale copiedRows',
        from: (migration: StartedMigration) => ({
          copiedRows: 0,
          lastCopiedRowId: lastRowOfBatch(migration, 1),
        }),
      },
      {
        batch: 'a stale lastCopiedRowId',
        from: (migration: StartedMigration) => ({
          copiedRows: BATCH_SIZE,
          lastCopiedRowId: migration.rowIds[0] ?? null,
        }),
      },
      {
        batch: 'the checkpoint of the committed batch, submitted again',
        from: () => ({ copiedRows: 0, lastCopiedRowId: null }),
      },
    ])(
      'T-batch refuses $batch from the owner of a COPYING record and writes nothing',
      async ({ from }) => {
        const migration = await givenMigration();
        const owner = await startOwnerUntil(
          kit,
          migration.migrationId,
          beforeBatchWrite(kit, 2),
        );
        const progress = await readProgress(migration);

        await expect(
          writeBatchFrom(owner, migration, from(migration)),
        ).resolves.toBe(false);

        await expectMigrationState(migration, progress);
        await expectShadowRowCount(migration, BATCH_SIZE);
      },
    );
  });

  describe('swapping', () => {
    it('AM-06 a claim after the owner died in SWAPPING runs the swap directly, once', async () => {
      const migration = await givenMigration();
      const died = await startOwnerUntil(
        kit,
        migration.migrationId,
        afterSwapBegins(kit),
      );
      await expectMigrationState(migration, {
        status: MigrationStatus.SWAPPING,
        phase: MigrationPhase.SWAPPING,
        startedAt: expect.any(Date),
        completedAt: null,
        retryCount: 0,
      });

      await expireLease(kit.prisma, migration.migrationId, LOCK_TIMEOUT_MS);
      const work = recordMigrationWork();

      await expect(
        kit.migrationService.processMigration(migration.migrationId),
      ).resolves.toBe('completed');
      expect(work.copyStarts).not.toHaveBeenCalled();
      expect(work.batchLoads).not.toHaveBeenCalled();
      expect(work.swapTransactions).toHaveBeenCalledTimes(1);
      await expectMigrationAbsent(kit, migration.revisionId, migration.tableId);
      await expectRowsMigratedOnce(migration);

      await expect(died.resume()).resolves.toBe('stopped');
    });

    it('a claim during the swap transaction waits for it, so the replaced owner commits no swap', async () => {
      const migration = await givenMigration();
      const owner = await startOwnerUntil(
        kit,
        migration.migrationId,
        afterSwapBegins(kit),
      );
      await expireLease(kit.prisma, migration.migrationId, LOCK_TIMEOUT_MS);
      const swapTransaction = insideSwapAfterItsRecordCheck(kit);
      await owner.continueUntil(swapTransaction);

      const otherClaim = kit.migrationLeases.claim(migration.migrationId);
      await waitUntilSettledOrBlockedBy(
        kit,
        swapTransaction.backendPid(),
        otherClaim,
      );

      await expect(owner.resume()).resolves.toBe('completed');
      await expect(otherClaim).resolves.toBeNull();
      await expectMigrationAbsent(kit, migration.revisionId, migration.tableId);
      await expectRowsMigratedOnce(migration);
    });

    it('a claim of an abandoned SWAPPING record counts a retry', async () => {
      const abandoned = await givenAbandonedSwap(1);

      const lease = await kit.migrationLeases.claim(abandoned.id);

      await expectMigrationState(abandoned, {
        status: MigrationStatus.SWAPPING,
        retryCount: 2,
        lockedBy: lease?.token,
      });
    });

    it('a claim of an abandoned SWAPPING record at maxRetries fails it SWAP_STALLED', async () => {
      const abandoned = await givenAbandonedSwap(MAX_RETRIES);

      const lease = await kit.migrationLeases.claim(abandoned.id);

      expect(lease).toBeNull();
      await expectMigrationState(abandoned, {
        status: MigrationStatus.FAILED,
        phase: MigrationPhase.SWAPPING,
        completedAt: expect.any(Date),
        errorMessage: expect.stringMatching(/^SWAP_STALLED: /),
        retryCount: MAX_RETRIES,
        lockedBy: null,
      });
    });
  });

  describe('failures', () => {
    it('a failed read of the record after a committed batch resumes the copy from that checkpoint', async () => {
      const migration = await givenMigration();
      failStateReadAfterFirstBatch();
      const batchLoads = jest.spyOn(kit.migrationBatchService, 'loadBatchRows');

      await expect(
        kit.migrationService.processMigration(migration.migrationId),
      ).resolves.toBe('completed');
      expect(batchLoads.mock.calls.map(([, after]) => after)).toEqual([
        null,
        lastRowOfBatch(migration, 1),
        lastRowOfBatch(migration, 2),
      ]);
      await expectMigrationAbsent(kit, migration.revisionId, migration.tableId);
      await expectRowsMigratedOnce(migration);
    });

    it('a transient batch failure resumes the copy at its checkpoint without starting it again', async () => {
      const migration = await givenMigration();
      failSecondBatchInsert(1);
      const copyStarts = jest.spyOn(kit.migrationTransitions, 'beginCopy');

      await expect(
        kit.migrationService.processMigration(migration.migrationId),
      ).resolves.toBe('completed');
      expect(copyStarts).toHaveBeenCalledTimes(1);
      await expectRowsMigratedOnce(migration);
    });

    it('after maxRetries transient failures the migration is FAILED in its phase and unlocked', async () => {
      const migration = await givenMigration();
      failSecondBatchInsert(MAX_RETRIES + 1);

      await expect(
        kit.migrationService.processMigration(migration.migrationId),
      ).resolves.toBe('failed');
      await expectMigrationState(migration, {
        status: MigrationStatus.FAILED,
        phase: MigrationPhase.COPYING,
        startedAt: expect.any(Date),
        completedAt: expect.any(Date),
        errorMessage: TRANSIENT_FAILURE,
        copiedRows: BATCH_SIZE,
        retryCount: MAX_RETRIES,
        lockedBy: null,
      });
    });
  });

  describe('AM-13 payload', () => {
    it('the start records its patches in a version 2 envelope', async () => {
      const migration = await givenMigration();

      const { patches } = await readMigration(migration);

      expect(patches).toEqual({
        version: 2,
        patches: [
          {
            op: 'add',
            path: `/properties/${FIELD}`,
            value: { type: 'number', default: 0 },
          },
        ],
      });
    });

    it('a payload of an unknown version fails PAYLOAD_UNSUPPORTED without retries', async () => {
      const migration = await givenMigration();
      await replacePayload(kit.prisma, migration.migrationId, {
        version: 3,
        patches: [],
      });

      await expect(
        kit.migrationService.processMigration(migration.migrationId),
      ).resolves.toBe('failed');
      await expectMigrationState(migration, {
        status: MigrationStatus.FAILED,
        phase: MigrationPhase.COPYING,
        startedAt: expect.any(Date),
        completedAt: expect.any(Date),
        errorMessage: expect.stringMatching(/^PAYLOAD_UNSUPPORTED: /),
        retryCount: 0,
        lockedBy: null,
      });
    });
  });

  it('T-init gives the shadow table the identity of the source table', async () => {
    const migration = await givenMigration();
    const source = await readDraftTable(migration);

    await expect(
      kit.migrationService.processMigration(migration.migrationId),
    ).resolves.toBe('completed');

    const migrated = await readDraftTable(migration);
    expect(migrated.versionId).not.toBe(source.versionId);
    expect(migrated).toMatchObject({
      createdId: source.createdId,
      createdAt: source.createdAt,
      system: source.system,
    });
  });

  let kit: MigrationTestKit;

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
    jest.restoreAllMocks();
    await kit.guard.verifyAndForget();
  });

  afterAll(async () => {
    await kit.close();
  });

  async function givenMigration(): Promise<StartedMigration> {
    const migration = await givenStartedFieldAddition(kit, {
      rowCount: ROW_COUNT,
      field: FIELD,
    });
    kit.recoveryScope.include(migration.migrationId);

    return migration;
  }

  async function givenAbandonedSwap(retryCount: number) {
    const branch = await prepareBranch(kit.prisma);

    return createMigrationRecord(
      kit.prisma,
      branch.draftRevisionId,
      MigrationStatus.SWAPPING,
      {
        lockedBy: 'crashed-owner',
        heartbeatAt: expiredHeartbeat(LOCK_TIMEOUT_MS),
        retryCount,
      },
    );
  }

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

  async function expectNoShadowTable(
    migration: StartedMigration,
  ): Promise<void> {
    const draftTable = await readDraftTable(migration);
    const tableVersions = await kit.prisma.table.count({
      where: { createdId: draftTable.createdId },
    });

    expect(tableVersions).toBe(1);
  }

  async function expectShadowRowCount(
    migration: StartedMigration,
    count: number,
  ): Promise<void> {
    const { shadowTableVersionId } = await readMigration(migration);
    const shadowRows = await kit.prisma.row.count({
      where: {
        tables: { some: { versionId: shadowTableVersionId ?? undefined } },
      },
    });

    expect(shadowRows).toBe(count);
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

  function readDraftTable(migration: StartedMigration) {
    return kit.prisma.table.findFirstOrThrow({
      where: {
        id: migration.tableId,
        revisions: { some: { id: migration.revisionId } },
      },
    });
  }

  function recordMigrationWork() {
    return {
      copyStarts: jest.spyOn(kit.migrationTransitions, 'beginCopy'),
      batchLoads: jest.spyOn(kit.migrationBatchService, 'loadBatchRows'),
      swapTransactions: jest.spyOn(kit.transactionService, 'runSerializable'),
    };
  }

  async function readProgress(
    migration: StartedMigration,
  ): Promise<Partial<TableMigration>> {
    const record = await readMigration(migration);

    return {
      status: record.status,
      lockedBy: record.lockedBy,
      copiedRows: record.copiedRows,
      lastCopiedRowId: record.lastCopiedRowId,
      currentBatch: record.currentBatch,
      lastProgressAt: record.lastProgressAt,
    };
  }

  async function writeBatchFrom(
    owner: PausedOwner,
    migration: StartedMigration,
    from: MigrationCheckpoint,
  ): Promise<boolean> {
    const record = await readMigration(migration);
    const rows = await kit.migrationBatchService.loadBatchRows(
      record.sourceTableVersionId,
      from.lastCopiedRowId,
      BATCH_SIZE,
    );
    const migrated = await kit.migrationBatchService.migrateAndProcessBatch(
      rows,
      decodeMigrationPayload(record.patches).patches,
      record.previousSchema as unknown as JsonSchema,
      record.revisionId,
      record.tableId,
    );

    return kit.migrationBatchService.writeBatch(owner.lease, {
      revisionId: record.revisionId,
      tableId: record.tableId,
      shadowTableVersionId: record.shadowTableVersionId ?? '',
      targetSchema: migrated.targetSchema,
      targetSchemaHash: record.targetSchemaHash,
      from,
      to: {
        copiedRows: from.copiedRows + rows.length,
        lastCopiedRowId: rows.at(-1)?.id ?? null,
      },
      rows: migrated.rows,
    });
  }

  function failStateReadAfterFirstBatch(): void {
    const leases = kit.migrationLeases;
    const findOwned = leases.findOwned.bind(leases);

    jest
      .spyOn(leases, 'findOwned')
      .mockImplementationOnce(findOwned)
      .mockImplementationOnce(findOwned)
      .mockRejectedValueOnce(new Error(TRANSIENT_FAILURE));
  }

  function failSecondBatchInsert(times: number): void {
    const batchService = kit.migrationBatchService;
    const insert = batchService.insertBatchIntoShadow.bind(batchService);
    const inserts = jest
      .spyOn(batchService, 'insertBatchIntoShadow')
      .mockImplementationOnce(insert);

    for (let failure = 0; failure < times; failure++) {
      inserts.mockRejectedValueOnce(new Error(TRANSIENT_FAILURE));
    }
  }
});

const TRANSIENT_FAILURE = 'connection lost';

function migrationIdOf(migration: StartedMigration | { id: string }): string {
  return 'migrationId' in migration ? migration.migrationId : migration.id;
}

function lastRowOfBatch(migration: StartedMigration, batch: number): string {
  const rowId = migration.rowIds[batch * BATCH_SIZE - 1];

  if (!rowId) {
    throw new Error(`Batch ${batch} is outside the table`);
  }

  return rowId;
}
