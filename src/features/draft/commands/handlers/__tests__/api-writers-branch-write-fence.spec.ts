import { HttpStatus } from '@nestjs/common';
import {
  createDraftTestKit,
  type DraftTestKit,
} from 'src/__tests__/kit/create-draft-test-kit';
import { BranchWriteFencedException } from 'src/infrastructure/database/branch-write-fenced.exception';
import {
  queueWriteBehindBranchFence,
  readLockTimeoutAroundFenceEntry,
  watchFenceEntries,
  writeWhileAnotherWriterIsInsideFence,
  writeWhileBranchIsFenced,
} from './support/branch-write-fence';
import {
  countDraftMigrations,
  createRow,
  draftWriters,
  givenDraftWithFileRow,
  readDraftContent,
  readDraftRowIds,
  updateTable,
} from './support/draft-writers';

const SHORT_TRANSACTION_TIMEOUT_MS = 1000;
const ASYNC_UPDATE_TRANSACTION_TIMEOUT_MS = 3000;
const ASYNC_MIGRATION_THRESHOLD = 1;

describe('Draft API writers behind the branch write fence', () => {
  describe('within their wait limit', () => {
    it('a writer waits while its branch is fenced and writes exactly once after the fence is released', async () => {
      const draft = await givenDraftWithFileRow(kit);
      const contentBefore = await readDraftContent(kit, draft.draftRevisionId);

      const queued = await queueWriteBehindBranchFence(
        kit,
        draft.branchId,
        () => createRow(kit, draft, 'created-row'),
      );
      await expect(
        readDraftContent(kit, draft.draftRevisionId),
      ).resolves.toEqual(contentBefore);
      await queued.releaseFence();

      await expect(queued.writing).resolves.toBeDefined();
      const rowIds = await readDraftRowIds(kit, draft);
      expect(rowIds).toHaveLength(2);
      expect(rowIds).toContain('created-row');
    });

    it('a writer does not wait for the fence of another branch', async () => {
      const fencedDraft = await givenDraftWithFileRow(kit);
      const draft = await givenDraftWithFileRow(kit);

      await writeWhileBranchIsFenced(kit, fencedDraft.branchId, () =>
        createRow(kit, draft, 'created-row'),
      );

      await expect(readDraftRowIds(kit, draft)).resolves.toContain(
        'created-row',
      );
    });

    it('writers of one branch hold the fence together', async () => {
      const draft = await givenDraftWithFileRow(kit);

      await writeWhileAnotherWriterIsInsideFence(
        kit,
        () => createRow(kit, draft, 'first-row'),
        () => createRow(kit, draft, 'second-row'),
      );

      await expect(readDraftRowIds(kit, draft)).resolves.toEqual(
        expect.arrayContaining(['first-row', 'second-row']),
      );
    });

    it("a writer's later lock waits are not limited by the fence wait limit", async () => {
      const draft = await givenDraftWithFileRow(kit);

      const lockTimeout = await readLockTimeoutAroundFenceEntry(
        kit,
        draft.draftRevisionId,
      );

      expect(lockTimeout.duringWrite).toBe(lockTimeout.beforeFenceEntry);
    });

    let kit: DraftTestKit;

    beforeAll(async () => {
      kit = await createDraftTestKit({
        migrationOptions: { workerMode: 'disabled' },
      });
    });

    afterAll(async () => {
      await kit.close();
    });
  });

  describe('beyond their wait limit', () => {
    it.each(draftWriters)(
      '$name fails with BranchWriteFencedException without a retry and writes nothing',
      async ({ write }) => {
        const draft = await givenDraftWithFileRow(kit);
        const contentBefore = await readDraftContent(
          kit,
          draft.draftRevisionId,
        );
        const fenceEntries = watchFenceEntries(kit);

        await expect(
          writeWhileBranchIsFenced(kit, draft.branchId, () =>
            write(kit, draft),
          ),
        ).rejects.toThrow(BranchWriteFencedException);

        expect(fenceEntries).toHaveBeenCalledTimes(1);
        await expect(
          readDraftContent(kit, draft.draftRevisionId),
        ).resolves.toEqual(contentBefore);
      },
    );

    it('refuses with the same 423 envelope as the migration lock', async () => {
      const draft = await givenDraftWithFileRow(kit);

      const refusal = await writeWhileBranchIsFenced(kit, draft.branchId, () =>
        createRow(kit, draft, 'created-row'),
      ).catch((error: unknown) => error);

      expect(refusal).toBeInstanceOf(BranchWriteFencedException);
      const fenced = refusal as BranchWriteFencedException;
      expect(fenced.getStatus()).toBe(HttpStatus.LOCKED);
      expect(fenced.getResponse()).toEqual({
        code: 'BRANCH_WRITE_FENCED',
        statusCode: HttpStatus.LOCKED,
        message:
          'Branch is closed for writes by an operation in progress; the write waited 500 ms. Retry it later.',
      });
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

  describe('an update of a table at the async migration threshold', () => {
    it('waits while its branch is fenced and starts exactly one migration after the fence is released', async () => {
      const draft = await givenDraftWithFileRow(kit);

      const queued = await queueWriteBehindBranchFence(
        kit,
        draft.branchId,
        () => updateTable(kit, draft),
      );
      await expect(countDraftMigrations(kit, draft)).resolves.toBe(0);
      await queued.releaseFence();

      await expect(queued.writing).resolves.toMatchObject({
        migrationStatus: 'migrating',
      });
      await expect(countDraftMigrations(kit, draft)).resolves.toBe(1);
    });

    it('fails with BRANCH_WRITE_FENCED past its wait limit and starts no migration', async () => {
      const draft = await givenDraftWithFileRow(kit);

      await expect(
        writeWhileBranchIsFenced(kit, draft.branchId, () =>
          updateTable(kit, draft),
        ),
      ).rejects.toThrow(BranchWriteFencedException);

      await expect(countDraftMigrations(kit, draft)).resolves.toBe(0);
    });

    let kit: DraftTestKit;

    beforeAll(async () => {
      kit = await createDraftTestKit({
        migrationOptions: {
          workerMode: 'disabled',
          threshold: ASYNC_MIGRATION_THRESHOLD,
        },
        transactionTimeoutMs: ASYNC_UPDATE_TRANSACTION_TIMEOUT_MS,
      });
    });

    afterAll(async () => {
      await kit.close();
    });
  });
});
