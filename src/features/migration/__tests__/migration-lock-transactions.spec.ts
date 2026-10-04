import { MigrationLockedException } from 'src/features/migration/exceptions/migration-locked.exception';
import { MigrationStatus } from 'src/features/migration/types/migration.types';
import { createMigrationLockTestKit } from './support/migration-lock-scenario';

describe('Migration lock transactions', () => {
  let kit: Awaited<ReturnType<typeof createMigrationLockTestKit>>;

  beforeAll(async () => {
    kit = await createMigrationLockTestKit();
  });

  afterAll(async () => {
    await kit.close();
  });

  it.each([
    MigrationStatus.PENDING,
    MigrationStatus.COPYING,
    MigrationStatus.SWAPPING,
  ])('rejects revision lock checks during %s migrations', async (status) => {
    const scenario = await kit.givenBranch();
    await scenario.createMigration(status, { tableId: 'test-table' });

    await expectMigrationLock(
      scenario.checkRevisionLock(),
      'test-table',
      status,
    );
  });

  it.each([
    MigrationStatus.COMPLETED,
    MigrationStatus.FAILED,
    MigrationStatus.CANCELLED,
  ])('allows revision lock checks after %s migrations', async (status) => {
    const scenario = await kit.givenBranch();
    await scenario.createMigration(status);

    await expect(scenario.checkRevisionLock()).resolves.toBeUndefined();
  });

  it('returns the machine-readable migration lock code', async () => {
    const scenario = await kit.givenBranch();
    await scenario.createMigration(MigrationStatus.PENDING, {
      tableId: 'test-table',
    });

    await expectMigrationLock(
      scenario.checkRevisionLock(),
      'test-table',
      MigrationStatus.PENDING,
    );
  });

  it('checks migrations created in the caller transaction', async () => {
    const scenario = await kit.givenBranch();

    await expectMigrationLock(
      scenario.insertMigrationAndCheckInCurrentTransaction(
        MigrationStatus.PENDING,
      ),
      'transaction-lock',
      MigrationStatus.PENDING,
    );
  });

  it('checks an uncommitted branch rename and migration through the caller transaction', async () => {
    const scenario = await kit.givenBranch();

    await expectMigrationLock(
      scenario.renameBranchAndCheckUncommittedLock(),
      'branch-lock',
      MigrationStatus.PENDING,
    );
  });
});

async function expectMigrationLock(
  action: Promise<unknown>,
  tableId: string,
  status: MigrationStatus,
): Promise<void> {
  const error = await action.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(MigrationLockedException);
  const response = (error as MigrationLockedException).getResponse();
  expect(response).toMatchObject({
    code: 'MIGRATION_LOCKED',
    message: `Revision is locked by an active migration on table "${tableId}" (${status})`,
  });
}
