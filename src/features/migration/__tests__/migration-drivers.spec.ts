import { MigrationDrivers } from 'src/features/migration/services/migration-drivers';
import type { MigrationStepResult } from 'src/features/migration/types/migration.types';

const MIGRATION_ID = 'mig-imported';
const OTHER_MIGRATION_ID = 'mig-other';

describe('MigrationDrivers', () => {
  it('refuses a second driver of a migration while its first one runs, and admits one after it ended', async () => {
    const drivers = new MigrationDrivers();
    const first = givenDriver();
    const second = givenDriver();
    const third = givenDriver();

    expect(drivers.driveUnlessDriven(MIGRATION_ID, first.run)).toBe(true);
    expect(drivers.driveUnlessDriven(MIGRATION_ID, second.run)).toBe(false);
    await first.end();

    expect(drivers.driveUnlessDriven(MIGRATION_ID, third.run)).toBe(true);
    expect(second.run).not.toHaveBeenCalled();
    expect(third.run).toHaveBeenCalledTimes(1);
  });

  it('drives different migrations side by side', () => {
    const drivers = new MigrationDrivers();

    expect(drivers.driveUnlessDriven(MIGRATION_ID, givenDriver().run)).toBe(
      true,
    );
    expect(
      drivers.driveUnlessDriven(OTHER_MIGRATION_ID, givenDriver().run),
    ).toBe(true);
  });

  it('runs the takeover of a stalled swap beside the running driver of its migration, and refuses ordinary drivers while the takeover runs', async () => {
    const drivers = new MigrationDrivers();
    const stalled = givenDriver();
    const takeover = givenDriver();
    drivers.driveUnlessDriven(MIGRATION_ID, stalled.run);

    drivers.driveTakeover(MIGRATION_ID, takeover.run);
    await stalled.end();

    expect(takeover.run).toHaveBeenCalledTimes(1);
    expect(drivers.driveUnlessDriven(MIGRATION_ID, givenDriver().run)).toBe(
      false,
    );
  });

  it('admits no driver once stopped and waits for the running ones', async () => {
    const drivers = new MigrationDrivers();
    const running = givenDriver();
    drivers.driveUnlessDriven(MIGRATION_ID, running.run);

    const stopping = drivers.stop();

    expect(
      drivers.driveUnlessDriven(OTHER_MIGRATION_ID, givenDriver().run),
    ).toBe(false);
    await running.end();
    await expect(stopping).resolves.toBeUndefined();
  });
});

function givenDriver() {
  let finish!: (result: MigrationStepResult) => void;
  const result = new Promise<MigrationStepResult>((resolve) => {
    finish = resolve;
  });
  const run = jest.fn(() => result);

  return {
    run,
    async end() {
      finish('completed');
      await settledReactions();
    },
  };
}

function settledReactions(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}
