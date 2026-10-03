import { MigrationLockedException } from 'src/features/migration/exceptions/migration-locked.exception';
import { MigrationStatus } from 'src/features/migration/types/migration.types';
import { createDraftChangesSnapshotTestKit } from './support/snapshot-test-kit';

describe('MigrationApiService.checkRevisionLock', () => {
  let kit: Awaited<ReturnType<typeof createDraftChangesSnapshotTestKit>>;

  beforeAll(async () => {
    kit = await createDraftChangesSnapshotTestKit();
  });

  afterAll(async () => kit.close());

  it.each([
    MigrationStatus.PENDING,
    MigrationStatus.COPYING,
    MigrationStatus.SWAPPING,
  ])('dispatches a lock query and rejects %s migrations', async (status) => {
    const scenario = await kit.givenBranch();
    await scenario.createMigration(status);

    await expect(
      kit.migrationApi.checkRevisionLock({
        revisionId: scenario.branch.draftRevisionId,
      }),
    ).rejects.toBeInstanceOf(MigrationLockedException);
  });

  it.each([
    MigrationStatus.COMPLETED,
    MigrationStatus.FAILED,
    MigrationStatus.CANCELLED,
  ])('permits %s migration status', async (status) => {
    const scenario = await kit.givenBranch();
    await scenario.createMigration(status);

    await expect(
      kit.migrationApi.checkRevisionLock({
        revisionId: scenario.branch.draftRevisionId,
      }),
    ).resolves.toBeUndefined();
  });

  it('returns a machine-readable migration lock code', async () => {
    const scenario = await kit.givenBranch();
    await scenario.createMigration(MigrationStatus.PENDING);
    const error = await kit.migrationApi
      .checkRevisionLock({ revisionId: scenario.branch.draftRevisionId })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(MigrationLockedException);
    expect((error as MigrationLockedException).getResponse()).toMatchObject({
      code: 'MIGRATION_LOCKED',
    });
  });

  it('checks revision locks against migrations in the caller transaction', async () => {
    const scenario = await kit.givenBranch();

    await expect(
      kit.insertMigrationInCurrentTransaction(
        scenario.branch.draftRevisionId,
        MigrationStatus.PENDING,
      ),
    ).rejects.toThrow();
  });

  it('checks an uncommitted branch rename and migration through the current transaction', async () => {
    const scenario = await kit.givenBranch();

    await expect(
      scenario.renameBranchAndCheckUncommittedLock(),
    ).rejects.toThrow();
  });
});
