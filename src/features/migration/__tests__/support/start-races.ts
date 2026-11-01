import type { MigrationTestKit } from 'src/__tests__/kit/create-migration-test-kit';
import { createBarrier, type Barrier } from 'src/__tests__/utils/barrier';

export interface PausedCommit {
  resume(): Promise<unknown>;
}

const heldOperations: { barrier: Barrier; result: Promise<unknown> }[] = [];

export async function commitUntilItsLockRead(
  kit: MigrationTestKit,
  branch: { projectId: string; branchName: string },
): Promise<PausedCommit> {
  const barrier = createBarrier('The commit');
  holdAfterNextLockRead(kit, barrier);
  const result = kit.draftApi.apiCreateRevision({
    projectId: branch.projectId,
    branchName: branch.branchName,
  });
  heldOperations.push({ barrier, result });
  await barrier.expectReachedBefore(result);

  return {
    resume() {
      barrier.release();

      return result;
    },
  };
}

export async function startConcurrentlyPastTheirLockReads<T>(
  kit: MigrationTestKit,
  starts: (() => Promise<T>)[],
): Promise<PromiseSettledResult<T>[]> {
  const barriers = starts.map((_, index) =>
    createBarrier(`Start ${index + 1}`),
  );
  holdEachBeforeRecording(kit, barriers);
  const results = starts.map((start) => start());
  const allStarted = Promise.all(results);

  for (const barrier of barriers) {
    heldOperations.push({ barrier, result: allStarted });
    await barrier.expectReachedBefore(allStarted);
  }

  for (const barrier of barriers) {
    barrier.release();
  }

  return Promise.allSettled(results);
}

export async function releaseHeldOperations(): Promise<void> {
  const held = heldOperations.splice(0);

  for (const { barrier } of held) {
    barrier.release();
  }

  await Promise.allSettled(held.map(({ result }) => result));
}

function holdAfterNextLockRead(kit: MigrationTestKit, barrier: Barrier): void {
  const lockService = kit.migrationLockService;
  const checkRevisionLock = lockService.checkRevisionLock.bind(lockService);

  jest
    .spyOn(lockService, 'checkRevisionLock')
    .mockImplementationOnce(async (revisionId) => {
      await checkRevisionLock(revisionId);
      await barrier.arrive();
    });
}

function holdEachBeforeRecording(
  kit: MigrationTestKit,
  barriers: Barrier[],
): void {
  const service = kit.migrationService;
  const createMigrationRecord = service.createMigrationRecord.bind(service);
  let arrivals = 0;

  jest
    .spyOn(service, 'createMigrationRecord')
    .mockImplementation(async (data) => {
      const barrier = barriers[arrivals];
      arrivals += 1;
      await barrier?.arrive();

      return createMigrationRecord(data);
    });
}
