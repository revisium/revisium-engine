import type { DraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import { createBarrier } from 'src/__tests__/utils/barrier';
import { Sql, sql } from 'src/engine-prisma-types';
import { DraftWriteAdmissionService } from 'src/features/draft/draft-write-admission.service';
import {
  BranchWriteFenceService,
  branchWriteFenceKey,
} from 'src/infrastructure/database/branch-write-fence.service';

const FENCE_HOLDER_TIMEOUT_MS = 10_000;

type FenceDatabase = Pick<DraftTestKit, 'prismaService'>;

export interface WriteQueuedBehindFence<T> {
  writing: Promise<T>;
  releaseFence(): Promise<void>;
}

export interface LockTimeoutAroundFenceEntry {
  beforeFenceEntry: string;
  duringWrite: string;
}

export interface BranchFenceHolder {
  release(): Promise<void>;
}

export interface BranchFenceLock {
  mode: string;
  granted: boolean;
}

export async function writeWhileBranchIsFenced<T>(
  kit: DraftTestKit,
  branchId: string,
  write: () => Promise<T>,
): Promise<T> {
  const fence = await holdBranchFenceExclusively(kit, branchId);
  const writing = write();

  try {
    await Promise.allSettled([writing]);
  } finally {
    await fence.release();
  }

  return writing;
}

export async function queueWriteBehindBranchFence<T>(
  kit: FenceDatabase,
  branchId: string,
  write: () => Promise<T>,
): Promise<WriteQueuedBehindFence<T>> {
  const fence = await holdBranchFenceExclusively(kit, branchId);
  const writing = write();

  try {
    await waitUntilQueuedBehindFence(kit, branchId, writing);
  } catch (error) {
    await fence.release();
    throw error;
  }

  return { writing, releaseFence: fence.release };
}

export async function writeWhileAnotherWriterIsInsideFence(
  kit: DraftTestKit,
  insideWrite: () => Promise<unknown>,
  write: () => Promise<unknown>,
): Promise<void> {
  const inside = holdWriterInsideFence(kit);
  const insideWriting = insideWrite();
  const insideSettled = Promise.allSettled([insideWriting]);

  try {
    await inside.expectReachedBefore(insideWriting);
    await write();
  } finally {
    inside.release();
    await insideSettled;
    inside.restore();
  }

  await insideWriting;
}

export async function readLockTimeoutAroundFenceEntry(
  kit: DraftTestKit,
  revisionId: string,
): Promise<LockTimeoutAroundFenceEntry> {
  const fence = fenceOf(kit);
  const enterShared = fence.enterSharedForRevision.bind(fence);
  let beforeFenceEntry = '';

  const spy = jest
    .spyOn(fence, 'enterSharedForRevision')
    .mockImplementationOnce(async (fencedRevisionId) => {
      beforeFenceEntry = await readTransactionLockTimeout(kit);
      await enterShared(fencedRevisionId);
    });

  try {
    const duringWrite = await kit.module
      .get(DraftWriteAdmissionService)
      .runSerializableRevisionWrite(revisionId, () =>
        readTransactionLockTimeout(kit),
      );

    return { beforeFenceEntry, duringWrite };
  } finally {
    spy.mockRestore();
  }
}

export function watchFenceEntries(kit: DraftTestKit) {
  return jest.spyOn(fenceOf(kit), 'enterSharedForRevision');
}

export function enterSharedFenceUnderExclusiveHolderOf(
  kit: DraftTestKit,
  heldBranchId: string,
  revisionId: string,
): Promise<void> {
  const fence = fenceOf(kit);

  return kit.transactionService.runSerializable(() =>
    kit.transactionService.runInExclusiveHeldAdmission(heldBranchId, () =>
      fence.enterSharedForRevision(revisionId),
    ),
  );
}

export function holdBranchFenceAsWriter(
  kit: FenceDatabase,
  branchId: string,
): Promise<BranchFenceHolder> {
  return holdBranchFence(
    kit,
    sql`pg_advisory_xact_lock_shared(${branchWriteFenceKey(branchId)})`,
  );
}

export async function waitUntilQueuedBehindFence(
  kit: FenceDatabase,
  branchId: string,
  writing: Promise<unknown>,
): Promise<void> {
  if (!(await isQueuedBehindFenceBeforeSettling(kit, branchId, writing))) {
    throw new Error(
      'The writer settled without queuing behind the branch write fence',
    );
  }
}

export async function waitUntilWrittenWithoutQueuing(
  kit: FenceDatabase,
  branchId: string,
  writing: Promise<unknown>,
): Promise<void> {
  if (await isQueuedBehindFenceBeforeSettling(kit, branchId, writing)) {
    throw new Error('The writer queued behind the branch write fence');
  }

  await writing;
}

export function readBranchFenceLocks(
  kit: FenceDatabase,
  branchId: string,
): Promise<BranchFenceLock[]> {
  return kit.prismaService.$queryRaw<BranchFenceLock[]>`
    SELECT mode, granted FROM pg_locks
    WHERE locktype = 'advisory'
      AND ((classid::bigint << 32) | objid::bigint) = ${branchWriteFenceKey(branchId)}
    ORDER BY mode, granted`;
}

function holdBranchFenceExclusively(
  kit: FenceDatabase,
  branchId: string,
): Promise<BranchFenceHolder> {
  return holdBranchFence(
    kit,
    sql`pg_advisory_xact_lock(${branchWriteFenceKey(branchId)})`,
  );
}

async function holdBranchFence(
  kit: FenceDatabase,
  fenceLock: Sql,
): Promise<BranchFenceHolder> {
  const barrier = createBarrier('The fence holder');
  const holding = kit.prismaService.$transaction(
    async (transaction) => {
      await transaction.$executeRaw`SELECT ${fenceLock}`;
      await barrier.arrive();
    },
    { timeout: FENCE_HOLDER_TIMEOUT_MS },
  );

  await barrier.expectReachedBefore(holding);

  return {
    async release() {
      barrier.release();
      await holding;
    },
  };
}

async function isQueuedBehindFenceBeforeSettling(
  kit: FenceDatabase,
  branchId: string,
  writing: Promise<unknown>,
): Promise<boolean> {
  let isSettled = false;
  const markSettled = () => {
    isSettled = true;
  };
  writing.then(markSettled, markSettled);

  while (!(await hasWriterQueuedBehindFence(kit, branchId))) {
    if (isSettled) {
      return false;
    }
  }

  return true;
}

async function hasWriterQueuedBehindFence(
  kit: FenceDatabase,
  branchId: string,
): Promise<boolean> {
  const waitingRequests = await kit.prismaService.$queryRaw<unknown[]>`
    SELECT 1 FROM pg_locks
    WHERE locktype = 'advisory'
      AND mode = 'ShareLock'
      AND NOT granted
      AND ((classid::bigint << 32) | objid::bigint) = ${branchWriteFenceKey(branchId)}`;

  return waitingRequests.length > 0;
}

function holdWriterInsideFence(kit: DraftTestKit) {
  const barrier = createBarrier('The writer inside the fence');
  const fence = fenceOf(kit);
  const enterShared = fence.enterSharedForRevision.bind(fence);

  const spy = jest
    .spyOn(fence, 'enterSharedForRevision')
    .mockImplementationOnce(async (revisionId) => {
      await enterShared(revisionId);
      await barrier.arrive();
    });

  return {
    expectReachedBefore: barrier.expectReachedBefore,
    release: barrier.release,
    restore: () => spy.mockRestore(),
  };
}

async function readTransactionLockTimeout(kit: DraftTestKit): Promise<string> {
  const [setting] = await kit.transactionService.getTransaction().$queryRaw<
    { lockTimeout: string }[]
  >`SELECT current_setting('lock_timeout') AS "lockTimeout"`;

  return setting?.lockTimeout ?? '';
}

function fenceOf(kit: DraftTestKit): BranchWriteFenceService {
  return kit.module.get(BranchWriteFenceService);
}
