import { prepareBranch } from 'src/__tests__/utils/prepareProject';
import { createMigrationTestKit } from 'src/__tests__/kit/create-migration-test-kit';
import { MigrationStatus } from 'src/features/migration/types/migration.types';
import {
  createMigrationRecord,
  MigrationFixtureOptions,
} from './migration-database';

export async function createMigrationLockTestKit() {
  const kit = await createMigrationTestKit();
  return {
    close: () => kit.close(),
    givenBranch: async () => {
      const branch = await prepareBranch(kit.prisma);
      return {
        branch,
        createMigration: (
          status: MigrationStatus,
          options: MigrationFixtureOptions = {},
        ) =>
          createMigrationRecord(
            kit.prisma,
            branch.draftRevisionId,
            status,
            options,
          ),
        checkRevisionLock: () =>
          kit.migrationLockService.checkRevisionLock(branch.draftRevisionId),
        insertMigrationAndCheckInCurrentTransaction: (
          status: MigrationStatus,
        ) =>
          kit.transactionService.run(async () => {
            await createMigrationRecord(
              kit.transactionService.getTransaction(),
              branch.draftRevisionId,
              status,
              { tableId: 'transaction-lock' },
            );
            return kit.migrationLockService.checkRevisionLock(
              branch.draftRevisionId,
            );
          }),
      };
    },
  };
}
