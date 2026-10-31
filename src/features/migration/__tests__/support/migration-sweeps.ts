import type { MigrationTestKit } from 'src/__tests__/kit/create-migration-test-kit';
import type { MigrationStepResult } from 'src/features/migration/types/migration.types';

export function nextClaimAttempt(
  kit: MigrationTestKit,
): Promise<string | null> {
  const transitions = kit.migrationTransitions;
  const findOldestClaimable = transitions.findOldestClaimable.bind(transitions);

  return new Promise((resolve) => {
    jest
      .spyOn(transitions, 'findOldestClaimable')
      .mockImplementationOnce(async () => {
        const claimable = await findOldestClaimable();
        resolve(claimable);
        return claimable;
      });
  });
}

export function nextRunOf(
  kit: MigrationTestKit,
  migrationId: string,
): Promise<MigrationStepResult> {
  const service = kit.migrationService;
  const processMigration = service.processMigration.bind(service);

  return new Promise((resolve) => {
    jest
      .spyOn(service, 'processMigration')
      .mockImplementation((startedMigrationId) => {
        const run = processMigration(startedMigrationId);

        if (startedMigrationId === migrationId) {
          resolve(run);
        }

        return run;
      });
  });
}
