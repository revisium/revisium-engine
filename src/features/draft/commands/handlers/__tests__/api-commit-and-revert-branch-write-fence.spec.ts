import objectHash from 'object-hash';
import type { InitMigration } from '@revisium/schema-toolkit/types';
import type { DraftProjectScenario } from 'src/__tests__/fixtures/scenarios/given-draft-project';
import {
  createDraftTestKit,
  type DraftTestKit,
} from 'src/__tests__/kit/create-draft-test-kit';
import { defaultDraftProjectSchema } from 'src/__tests__/utils/prepareProject';
import { MigrationLockedException } from 'src/features/migration/exceptions/migration-locked.exception';
import { BranchWriteFencedException } from 'src/infrastructure/database/branch-write-fenced.exception';
import {
  enterSharedFenceUnderExclusiveHolderOf,
  holdBranchFenceAsWriter,
  readBranchFenceLocks,
  writeWhileBranchIsFenced,
} from './support/branch-write-fence';
import {
  givenDraftWithRows,
  isDraftRevision,
  readBranchDraftRevisionId,
  readRowIds,
  removeRowFromBranchDraft,
  startHeldCommit,
  startHeldMigrationImport,
  startHeldRevert,
  startMigration,
} from './support/held-branch-operation';

const SHORT_TRANSACTION_TIMEOUT_MS = 3000;

const importedTable: InitMigration = {
  changeType: 'init',
  id: '2099-01-01T00:00:00.000Z',
  tableId: 'imported-table',
  schema: defaultDraftProjectSchema,
  hash: objectHash(defaultDraftProjectSchema),
};

describe('Native commit and revert behind the exclusive branch write fence', () => {
  describe('under continuous writers', () => {
    it('a commit that loses two attempts to writers takes the fence exclusively: the next writer waits until it applies, and writers then write to the next Draft', async () => {
      const draft = await givenDraftWithRows(kit, ['row-1', 'row-2', 'row-3']);
      const commit = startHeldCommit(kit, draft);

      await commit.losesAttemptToRemovalOf('row-1');
      await commit.losesAttemptToRemovalOf('row-2');
      const queued = await commit.queuesRemovalOf('row-3');

      await expect(commit.outcome()).resolves.toMatchObject({
        id: draft.draftRevisionId,
        isHead: true,
      });
      await expect(
        readRowIds(kit, draft, draft.draftRevisionId),
      ).resolves.toEqual([draft.rowId, 'row-3'].sort());
      await expect(queued.writing).rejects.toThrow(
        'The revision is not a draft',
      );
      await expectBranchFenceFree(kit, draft);
      await expect(
        removeRowFromBranchDraft(kit, draft, 'row-3'),
      ).resolves.toBeDefined();
    });

    it('a revert that loses two attempts to writers takes the fence exclusively, and the write that waited applies to the reverted Draft', async () => {
      const draft = await givenDraftWithRows(kit, ['row-1', 'row-2', 'row-3']);
      const revert = startHeldRevert(kit, draft);

      await revert.losesAttemptToRemovalOf('row-1');
      await revert.losesAttemptToRemovalOf('row-2');
      const queued = await revert.queuesRemovalOf('row-3');

      await expect(revert.outcome()).resolves.toMatchObject({
        id: draft.branchId,
      });
      await expect(queued.writing).resolves.toBeDefined();
      await expect(
        readRowIds(kit, draft, draft.draftRevisionId),
      ).resolves.toEqual([draft.rowId, 'row-1', 'row-2'].sort());
      await expectBranchFenceFree(kit, draft);
    });

    it('a native revert that arrives while an escalated commit holds the fence waits for the commit, then finds no changes left to revert', async () => {
      const draft = await givenDraftWithRows(kit, ['row-1', 'row-2']);
      const commit = startHeldCommit(kit, draft);

      await commit.losesAttemptToRemovalOf('row-1');
      await commit.losesAttemptToRemovalOf('row-2');
      const queuedRevert = await commit.queuesRevert();

      await expect(commit.outcome()).resolves.toMatchObject({
        id: draft.draftRevisionId,
        isHead: true,
      });
      await expect(queuedRevert.writing).rejects.toThrow(
        'There are no changes',
      );
      const nextDraftRevisionId = await readBranchDraftRevisionId(kit, draft);
      await expect(
        readRowIds(kit, draft, draft.draftRevisionId),
      ).resolves.toEqual([draft.rowId]);
      await expect(
        readRowIds(kit, draft, nextDraftRevisionId),
      ).resolves.toEqual([draft.rowId]);
      await expectBranchFenceFree(kit, draft);
    });

    it('applyMigrations retries the attempts it loses to writers without taking the fence exclusively', async () => {
      const draft = await givenDraftWithRows(kit, ['row-1', 'row-2', 'row-3']);
      const migrationImport = startHeldMigrationImport(
        kit,
        draft,
        importedTable,
      );

      await migrationImport.losesAttemptToRemovalOf('row-1');
      await migrationImport.losesAttemptToRemovalOf('row-2');
      await migrationImport.losesAttemptToRemovalOf('row-3');

      await expect(migrationImport.outcome()).resolves.toEqual([
        { id: importedTable.id, status: 'applied' },
      ]);
    });

    let kit: DraftTestKit;

    beforeAll(async () => {
      kit = await createDraftTestKit({
        migrationOptions: { workerMode: 'disabled' },
      });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    afterAll(async () => {
      await kit.close();
    });
  });

  describe('an escalated attempt', () => {
    it('skips the shared fence of its own branch, still refuses while a migration is active, and releases the fence', async () => {
      const draft = await givenDraftWithRows(kit, ['row-1', 'row-2']);
      const commit = startHeldCommit(kit, draft);

      await commit.losesAttemptToRemovalOf('row-1');
      await commit.losesAttemptToRemovalOf('row-2', () =>
        startMigration(kit, draft),
      );

      await expect(commit.outcome()).rejects.toThrow(MigrationLockedException);
      await expect(isDraftRevision(kit, draft.draftRevisionId)).resolves.toBe(
        true,
      );
      await expectBranchFenceFree(kit, draft);
    });

    it('fails with its transaction timeout and releases the fence when its transaction times out', async () => {
      const draft = await givenDraftWithRows(kit, ['row-1', 'row-2', 'row-3']);
      const commit = startHeldCommit(kit, draft);

      await commit.losesAttemptToRemovalOf('row-1');
      await commit.losesAttemptToRemovalOf('row-2');
      const queued = await commit.queuesRemovalOf('row-3');
      await commit.outlivesItsTransaction();

      await expect(commit.outcome()).rejects.toMatchObject({ code: 'P2028' });
      await expect(queued.writing).rejects.toThrow(BranchWriteFencedException);
      await expectBranchFenceFree(kit, draft);
      await expect(
        removeRowFromBranchDraft(kit, draft, 'row-3'),
      ).resolves.toBeDefined();
    });

    it('fails with BRANCH_WRITE_FENCED and holds nothing when a writer stays inside the fence past the wait limit', async () => {
      const draft = await givenDraftWithRows(kit, ['row-1', 'row-2']);
      const writerInside = await holdBranchFenceAsWriter(kit, draft.branchId);
      const commit = startHeldCommit(kit, draft);

      await commit.losesAttemptToRemovalOf('row-1');
      await commit.losesAttemptToRemovalOf('row-2');

      await expect(commit.outcome()).rejects.toThrow(
        BranchWriteFencedException,
      );
      await expect(readBranchFenceLocks(kit, draft.branchId)).resolves.toEqual([
        { mode: 'ShareLock', granted: true },
      ]);
      await expect(isDraftRevision(kit, draft.draftRevisionId)).resolves.toBe(
        true,
      );
      await writerInside.release();
    });

    let kit: DraftTestKit;

    beforeAll(async () => {
      kit = await createDraftTestKit({
        migrationOptions: { workerMode: 'disabled' },
        transactionTimeoutMs: SHORT_TRANSACTION_TIMEOUT_MS,
      });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    afterAll(async () => {
      await kit.close();
    });
  });

  describe('the exclusiveHeld admission mode', () => {
    it('enters the shared fence of its own branch without waiting for the holder', async () => {
      const draft = await givenDraftWithRows(kit, []);

      await expect(
        writeWhileBranchIsFenced(kit, draft.branchId, () =>
          enterSharedFenceUnderExclusiveHolderOf(
            kit,
            draft.branchId,
            draft.draftRevisionId,
          ),
        ),
      ).resolves.toBeUndefined();
    });

    it('still waits for the fence of another branch', async () => {
      const heldDraft = await givenDraftWithRows(kit, []);
      const otherDraft = await givenDraftWithRows(kit, []);

      await expect(
        writeWhileBranchIsFenced(kit, otherDraft.branchId, () =>
          enterSharedFenceUnderExclusiveHolderOf(
            kit,
            heldDraft.branchId,
            otherDraft.draftRevisionId,
          ),
        ),
      ).rejects.toThrow(BranchWriteFencedException);
    });

    let kit: DraftTestKit;

    beforeAll(async () => {
      kit = await createDraftTestKit({
        migrationOptions: { workerMode: 'disabled' },
        transactionTimeoutMs: SHORT_TRANSACTION_TIMEOUT_MS,
      });
    });

    afterAll(async () => {
      await kit.close();
    });
  });
});

async function expectBranchFenceFree(
  kit: DraftTestKit,
  draft: DraftProjectScenario,
): Promise<void> {
  await expect(readBranchFenceLocks(kit, draft.branchId)).resolves.toEqual([]);
}
