import type { MigrationTestKit } from 'src/__tests__/kit/create-migration-test-kit';

const MS_PER_SECOND = 1000;

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
