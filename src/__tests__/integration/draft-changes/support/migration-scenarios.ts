import { StartAsyncMigrationCommand } from 'src/features/migration/commands/impl/start-async-migration.command';
import { MigrationWorkerService } from 'src/features/migration/services/migration-worker.service';
import { MigrationApiService } from 'src/features/migration/migration-api.service';
import { givenTwoFieldChanges } from './row-scenario';
import type { ChangesTestKit } from './test-kit';

export async function givenMigrationLock(kit: ChangesTestKit, status: string) {
  const f = await givenTwoFieldChanges(kit);
  const plan = await f.plan('commit');
  const worker = kit.module.get(MigrationWorkerService);
  const holdWorker = jest
    .spyOn(worker, 'triggerInline')
    .mockResolvedValue(undefined);
  let migrationId: string;
  try {
    const result = await kit.commandBus.execute<
      StartAsyncMigrationCommand,
      { migrationId: string }
    >(
      new StartAsyncMigrationCommand({
        revisionId: f.initial.draftRevisionId,
        tableId: f.tableId,
        patches: [
          {
            op: 'add',
            path: '/properties/extra',
            value: { type: 'number', default: 0 },
          },
        ],
      }),
    );
    migrationId = result.migrationId;
  } finally {
    holdWorker.mockRestore();
  }
  await kit.prismaService.tableMigration.update({
    where: { id: migrationId },
    data: { status },
  });
  return {
    f,
    plan,
    abort: () =>
      kit.module.get(MigrationApiService).abortMigration({
        revisionId: f.initial.draftRevisionId,
        tableId: f.tableId,
      }),
  };
}
