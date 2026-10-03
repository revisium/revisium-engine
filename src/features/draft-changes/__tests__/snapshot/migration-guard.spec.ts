import { MigrationLockedException } from 'src/features/migration/exceptions/migration-locked.exception';
import { MigrationStatus } from 'src/features/migration/types/migration.types';
import { createDraftChangesSnapshotTestKit } from './support/snapshot-scenario';

describe('DraftChanges snapshot migration guard', () => {
  let kit: Awaited<ReturnType<typeof createDraftChangesSnapshotTestKit>>;

  beforeAll(async () => {
    kit = await createDraftChangesSnapshotTestKit();
  });

  afterAll(async () => {
    await kit.close();
  });

  it.each([
    MigrationStatus.PENDING,
    MigrationStatus.COPYING,
    MigrationStatus.SWAPPING,
  ])(
    'blocks snapshots during %s migrations without writing state',
    async (status) => {
      const scenario = await kit.givenBranch();
      await scenario.seedState();
      await scenario.createMigration(status);
      const before = await scenario.readPersistedState();

      await expectLocked(scenario.readSnapshot(), 'products', status);

      expect(await scenario.readPersistedState()).toEqual(before);
    },
  );

  it.each([
    MigrationStatus.COMPLETED,
    MigrationStatus.FAILED,
    MigrationStatus.CANCELLED,
  ])('allows snapshots after %s migrations', async (status) => {
    const scenario = await kit.givenBranch();
    await scenario.seedState();
    await scenario.createMigration(status);

    expect((await scenario.readSnapshot()).branch.id).toBe(
      scenario.branch.branchId,
    );
  });

  it('observes an active migration created in the caller transaction', async () => {
    const scenario = await kit.givenBranch();
    await scenario.seedState();
    const before = await scenario.readPersistedState();

    await expectLocked(
      scenario.readSnapshotAfterUncommittedMigration(MigrationStatus.PENDING),
      'snapshot-lock',
      MigrationStatus.PENDING,
    );

    expect(await scenario.readPersistedState()).toEqual(before);
  });

  it('observes a terminal migration changed to active in the caller transaction', async () => {
    const scenario = await kit.givenBranch();
    await scenario.seedState();
    const migration = await scenario.createMigration(MigrationStatus.COMPLETED);
    const before = await scenario.readPersistedState();

    await expectLocked(
      scenario.transitionMigrationAndReadSnapshot(
        migration.id,
        MigrationStatus.PENDING,
      ),
      'products',
      MigrationStatus.PENDING,
    );

    expect(await scenario.readPersistedState()).toEqual(before);
  });
});

async function expectLocked(
  action: Promise<unknown>,
  tableId: string,
  status: MigrationStatus,
): Promise<void> {
  const error = await action.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(MigrationLockedException);
  expect((error as MigrationLockedException).getResponse()).toMatchObject({
    code: 'MIGRATION_LOCKED',
    message: `Revision is locked by an active migration on table "${tableId}" (${status})`,
  });
}
