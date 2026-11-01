import type { MigrationTestKit } from 'src/__tests__/kit/create-migration-test-kit';
import type { MigrationStepResult } from 'src/features/migration/types/migration.types';

export interface StartedRun {
  result: Promise<MigrationStepResult>;
}

export interface SweepingProcess {
  kit: MigrationTestKit;
  nextRunOf(migrationId: string): Promise<StartedRun>;
  sweepsCompleted(count: number): Promise<void>;
}

export function observeSweepingProcess(kit: MigrationTestKit): SweepingProcess {
  const runs = observeRuns(kit);
  const sweeps = observeSweepStarts(kit);

  return {
    kit,
    nextRunOf: runs.next,
    sweepsCompleted: (count) => sweeps.reach(sweeps.started() + count + 1),
  };
}

function observeRuns(kit: MigrationTestKit) {
  const service = kit.migrationService;
  const processMigration = service.processMigration.bind(service);
  const takeOverStalledSwap = service.takeOverStalledSwap.bind(service);
  const awaitedRuns = new Map<string, (run: StartedRun) => void>();
  const started = (
    migrationId: string,
    result: Promise<MigrationStepResult>,
  ) => {
    awaitedRuns.get(migrationId)?.({ result });
    awaitedRuns.delete(migrationId);

    return result;
  };

  jest
    .spyOn(service, 'processMigration')
    .mockImplementation((migrationId) =>
      started(migrationId, processMigration(migrationId)),
    );
  jest
    .spyOn(service, 'takeOverStalledSwap')
    .mockImplementation((stalledOwner) =>
      started(stalledOwner.migrationId, takeOverStalledSwap(stalledOwner)),
    );

  return {
    next(migrationId: string): Promise<StartedRun> {
      return new Promise((resolve) => {
        awaitedRuns.set(migrationId, resolve);
      });
    },
  };
}

function observeSweepStarts(kit: MigrationTestKit) {
  const stallRecovery = kit.migrationStallRecovery;
  const cancelStalled = stallRecovery.cancelStalled.bind(stallRecovery);
  const waiters: { starts: number; resolve: () => void }[] = [];
  let starts = 0;

  jest.spyOn(stallRecovery, 'cancelStalled').mockImplementation(() => {
    starts += 1;

    for (const waiter of waiters.filter((each) => each.starts <= starts)) {
      waiters.splice(waiters.indexOf(waiter), 1);
      waiter.resolve();
    }

    return cancelStalled();
  });

  return {
    started: () => starts,
    reach(target: number): Promise<void> {
      return new Promise((resolve) => {
        waiters.push({ starts: target, resolve });
      });
    },
  };
}
