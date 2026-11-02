import type { BranchScenarioTestKit } from 'src/__tests__/kit/create-branch-scenario-test-kit';
import { createMigrationRecord } from 'src/features/migration/__tests__/support/migration-database';
import { MigrationStatus } from 'src/features/migration/types/migration.types';
import type { BranchScenario } from './branch-scenario';

export async function givenActiveMigration(
  kit: BranchScenarioTestKit,
  draft: BranchScenario,
  tableId: string,
): Promise<void> {
  await createMigrationRecord(
    kit.prisma,
    await draft.revisionId('draft'),
    MigrationStatus.PENDING,
    { tableId },
  );
}
