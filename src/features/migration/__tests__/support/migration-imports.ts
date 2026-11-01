import type { MigrationTestKit } from 'src/__tests__/kit/create-migration-test-kit';
import { sql } from 'src/engine-prisma-types';
import { MigrationDrivers } from 'src/features/migration/services/migration-drivers';
import type { MigrationStepResult } from 'src/features/migration/types/migration.types';
import { branchWriteFenceKey } from 'src/infrastructure/database/branch-write-fence.service';

export interface StartedDriver {
  migrationId: string;
  result: Promise<MigrationStepResult>;
}

export interface ObservedImports {
  kit: MigrationTestKit;
  nextDriverWhile(importing: Promise<unknown>): Promise<StartedDriver>;
  observationsWhile(importing: Promise<unknown>, count: number): Promise<void>;
  driverResults(): Promise<MigrationStepResult[]>;
  mostConcurrentDriversOfOneMigration(): number;
}

export function observeImports(kit: MigrationTestKit): ObservedImports {
  const drivers = observeLocalDrivers(kit);
  const observations = observeDeadlineChecks(kit);

  return {
    kit,
    nextDriverWhile: drivers.nextWhile,
    observationsWhile: (importing, count) =>
      Promise.race([
        observations.reach(observations.started() + count + 1),
        importing.then(ignore, ignore),
      ]),
    driverResults: drivers.results,
    mostConcurrentDriversOfOneMigration: drivers.mostConcurrent,
  };
}

export function observeOpenTransactions(kit: MigrationTestKit): () => number {
  const prisma = kit.prisma as unknown as {
    $transaction(...args: unknown[]): Promise<unknown>;
  };
  const transaction = prisma.$transaction.bind(prisma);
  let open = 0;

  jest.spyOn(prisma, '$transaction').mockImplementation(async (...args) => {
    open += 1;

    try {
      return await transaction(...args);
    } finally {
      open -= 1;
    }
  });

  return () => open;
}

export async function isBranchFenceFree(
  kit: MigrationTestKit,
  branchId: string,
): Promise<boolean> {
  const [attempt] = await kit.prisma.$queryRaw<{ acquired: boolean }[]>(sql`
    SELECT pg_try_advisory_xact_lock(${branchWriteFenceKey(branchId)}) AS "acquired"`);

  return attempt?.acquired ?? false;
}

export function trackSettlement(operation: Promise<unknown>): () => boolean {
  let isSettled = false;
  const markSettled = () => {
    isSettled = true;
  };
  operation.then(markSettled, markSettled);

  return () => isSettled;
}

function observeLocalDrivers(kit: MigrationTestKit) {
  const drivers = kit.module.get(MigrationDrivers);
  const driveUnlessDriven = drivers.driveUnlessDriven.bind(drivers);
  const started: StartedDriver[] = [];
  const awaited: ((driver: StartedDriver) => void)[] = [];
  const running = new Map<string, number>();
  let taken = 0;
  let mostConcurrent = 0;

  const track = (driver: StartedDriver) => {
    const concurrent = (running.get(driver.migrationId) ?? 0) + 1;
    running.set(driver.migrationId, concurrent);
    mostConcurrent = Math.max(mostConcurrent, concurrent);
    const finish = () => {
      running.set(
        driver.migrationId,
        (running.get(driver.migrationId) ?? 1) - 1,
      );
    };
    driver.result.then(finish, finish);
    started.push(driver);
    awaited.shift()?.(driver);
  };

  jest
    .spyOn(drivers, 'driveUnlessDriven')
    .mockImplementation((migrationId, run) =>
      driveUnlessDriven(migrationId, () => {
        const result = run();
        track({ migrationId, result });

        return result;
      }),
    );

  const next = (): Promise<StartedDriver> => {
    const driver = started[taken];
    taken += 1;

    if (driver) {
      return Promise.resolve(driver);
    }

    return new Promise((resolve) => {
      awaited.push(resolve);
    });
  };

  return {
    async nextWhile(importing: Promise<unknown>): Promise<StartedDriver> {
      const settledFirst = importing.then(() => {
        throw new Error('The import settled before a local driver started');
      });

      return Promise.race([next(), settledFirst]);
    },
    results: () => Promise.all(started.map(({ result }) => result)),
    mostConcurrent: () => mostConcurrent,
  };
}

function observeDeadlineChecks(kit: MigrationTestKit) {
  const transitions = kit.migrationTransitions;
  const cancelIfStalled = transitions.cancelIfStalled.bind(transitions);
  const waiters: { checks: number; resolve: () => void }[] = [];
  let checks = 0;

  jest
    .spyOn(transitions, 'cancelIfStalled')
    .mockImplementation((migrationId) => {
      checks += 1;

      for (const waiter of waiters.filter((each) => each.checks <= checks)) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve();
      }

      return cancelIfStalled(migrationId);
    });

  return {
    started: () => checks,
    reach(target: number): Promise<void> {
      return new Promise((resolve) => {
        waiters.push({ checks: target, resolve });
      });
    },
  };
}

function ignore(): void {
  return undefined;
}
