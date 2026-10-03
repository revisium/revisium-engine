import { prepareBranch } from 'src/__tests__/utils/prepareProject';
import { createMigrationTestKit } from 'src/__tests__/kit/create-migration-test-kit';
import { MigrationStatus } from 'src/features/migration/types/migration.types';
import {
  createMigrationRecord,
  MigrationFixtureOptions,
  renameMigrationBranch,
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
          kit.migrationApi.checkRevisionLock({
            revisionId: branch.draftRevisionId,
          }),
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
            return kit.migrationApi.checkRevisionLock({
              revisionId: branch.draftRevisionId,
            });
          }),
        renameBranchAndCheckUncommittedLock: () =>
          kit.transactionService.run(async () => {
            const renamedBranch = `transaction-${branch.branchName}`;
            const transaction = kit.transactionService.getTransaction();
            await renameMigrationBranch(
              transaction,
              branch.branchId,
              renamedBranch,
            );
            await createMigrationRecord(
              transaction,
              branch.draftRevisionId,
              MigrationStatus.PENDING,
              { tableId: 'branch-lock' },
            );
            return kit.migrationLockService.checkBranchLock(
              branch.projectId,
              renamedBranch,
            );
          }),
      };
    },
  };
}
