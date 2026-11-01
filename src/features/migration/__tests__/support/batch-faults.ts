import type { MigrationTestKit } from 'src/__tests__/kit/create-migration-test-kit';
import { FileUsageIntegrationService } from 'src/features/file-usage/services/file-usage-integration.service';

const MS_PER_SECOND = 1000;
const FAILED_AFTER_REGISTRATION = 'Connection lost after the file registration';
const BATCH_WRITE_LOST = 'Connection lost before the batch write';

export function failRightAfterFileRegistration(
  kit: MigrationTestKit,
  registrationNumber: number,
): void {
  const fileUsage = kit.module.get(FileUsageIntegrationService);
  const register = fileUsage.registerReferencesForRows.bind(fileUsage);
  let registrations = 0;

  jest
    .spyOn(fileUsage, 'registerReferencesForRows')
    .mockImplementation(async (data) => {
      await register(data);
      registrations += 1;

      if (registrations === registrationNumber) {
        throw new Error(FAILED_AFTER_REGISTRATION);
      }
    });
}

export function loseConnectionAtBatchWrite(
  kit: MigrationTestKit,
  writeNumber: number,
): void {
  const batchService = kit.migrationBatchService;
  const writeBatch = batchService.writeBatch.bind(batchService);
  let writes = 0;

  jest.spyOn(batchService, 'writeBatch').mockImplementation((...args) => {
    writes += 1;

    if (writes === writeNumber) {
      return Promise.reject(new Error(BATCH_WRITE_LOST));
    }

    return writeBatch(...args);
  });
}

export function slowDownFirstBatchTransaction(
  kit: MigrationTestKit,
  durationMs: number,
): void {
  const transitions = kit.migrationTransitions;
  const advanceCheckpoint = transitions.advanceCheckpoint.bind(transitions);

  jest
    .spyOn(transitions, 'advanceCheckpoint')
    .mockImplementationOnce(async (lease, from, to, transaction) => {
      const advanced = await advanceCheckpoint(lease, from, to, transaction);
      await transaction.$executeRaw`SELECT pg_sleep(${durationMs / MS_PER_SECOND})`;

      return advanced;
    });
}

export function recordBatchWriteFailures(kit: MigrationTestKit): string[] {
  const failures: string[] = [];
  const batchService = kit.migrationBatchService;
  const writeBatch = batchService.writeBatch.bind(batchService);

  jest.spyOn(batchService, 'writeBatch').mockImplementation(async (...args) => {
    try {
      return await writeBatch(...args);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
      throw error;
    }
  });

  return failures;
}
