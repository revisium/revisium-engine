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
  const awaitedRuns = new Map<string, (run: StartedRun) => void>();

  jest.spyOn(service, 'processMigration').mockImplementation((migrationId) => {
    const result = processMigration(migrationId);
    awaitedRuns.get(migrationId)?.({ result });
    awaitedRuns.delete(migrationId);

    return result;
  });

  return {
    next(migrationId: string): Promise<StartedRun> {
      return new Promise((resolve) => {
        awaitedRuns.set(migrationId, resolve);
      });
    },
  };
}

function observeSweepStarts(kit: MigrationTestKit) {
  const transitions = kit.migrationTransitions;
  const cancelStalled = transitions.cancelStalled.bind(transitions);
  const waiters: { starts: number; resolve: () => void }[] = [];
  let starts = 0;

  jest.spyOn(transitions, 'cancelStalled').mockImplementation(() => {
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
