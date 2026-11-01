import type { MigrationTestKit } from 'src/__tests__/kit/create-migration-test-kit';
import { createBarrier, type Barrier } from 'src/__tests__/utils/barrier';
import { BranchWriteFenceService } from 'src/infrastructure/database/branch-write-fence.service';

export interface PausedOperation<T> {
  resume(): Promise<T>;
}

export interface AdmissionSteps {
  ofEachTransaction(): string[][];
}

const heldOperations: { barrier: Barrier; result: Promise<unknown> }[] = [];

export function writeUntilItsLockRead<T>(
  kit: MigrationTestKit,
  write: () => Promise<T>,
): Promise<PausedOperation<T>> {
  const barrier = createBarrier('The writer');
  holdAfterNextLockRead(kit, barrier);

  return pauseAt(barrier, write());
}

export function startUntilItRecords<T>(
  kit: MigrationTestKit,
  start: () => Promise<T>,
): Promise<PausedOperation<T>> {
  const barrier = createBarrier('The start');
  holdEachBeforeRecording(kit, [barrier]);

  return pauseAt(barrier, start());
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

export function observeAdmissionSteps(kit: MigrationTestKit): AdmissionSteps {
  const steps = new Map<object, string[]>();
  const record = (step: string) => {
    const transaction = kit.transactionService.getTransactionUnsafe();

    if (transaction) {
      steps.set(transaction, [...(steps.get(transaction) ?? []), step]);
    }
  };
  const fence = kit.module.get(BranchWriteFenceService);
  const enterShared = fence.enterSharedForRevision.bind(fence);
  const lockService = kit.migrationLockService;
  const checkRevisionLock = lockService.checkRevisionLock.bind(lockService);

  jest
    .spyOn(fence, 'enterSharedForRevision')
    .mockImplementation(async (revisionId) => {
      record('fence');
      await enterShared(revisionId);
    });
  jest
    .spyOn(lockService, 'checkRevisionLock')
    .mockImplementation(async (revisionId) => {
      record('lock');
      await checkRevisionLock(revisionId);
    });

  return { ofEachTransaction: () => [...steps.values()] };
}

export async function releaseHeldOperations(): Promise<void> {
  const held = heldOperations.splice(0);

  for (const { barrier } of held) {
    barrier.release();
  }

  await Promise.allSettled(held.map(({ result }) => result));
}

async function pauseAt<T>(
  barrier: Barrier,
  result: Promise<T>,
): Promise<PausedOperation<T>> {
  heldOperations.push({ barrier, result });
  await barrier.expectReachedBefore(result);

  return {
    resume() {
      barrier.release();

      return result;
    },
  };
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
