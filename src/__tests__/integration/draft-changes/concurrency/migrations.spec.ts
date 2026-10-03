import { apiErrorCode } from '../support/api-errors';
import { givenMigrationLock } from '../support/migration-scenarios';
import { useChangesTestKit } from '../support/test-kit';

describe.skip('Draft Changes: migration exclusion', () => {
  const kit = useChangesTestKit();

  it.each(['PENDING', 'COPYING', 'SWAPPING'])(
    'blocks Draft reads during %s',
    async (phase) => {
      const { f } = await givenMigrationLock(kit(), phase);
      expect(
        await apiErrorCode(() => kit().changes.draftChanges(f.branch)),
      ).toBe('MIGRATION_LOCKED');
    },
  );

  it.each(['PENDING', 'COPYING', 'SWAPPING'])(
    'does not execute a reviewed plan during %s',
    async (phase) => {
      const { f, plan } = await givenMigrationLock(kit(), phase);
      const before = await f.snapshot();
      await apiErrorCode(() => f.execute(plan));
      expect(await f.snapshot()).toEqual(before);
    },
  );

  it('allows a fresh plan after a pending migration is aborted', async () => {
    const { f, abort } = await givenMigrationLock(kit(), 'PENDING');
    await abort();
    expect((await f.plan('commit')).status).toBe('ready');
  });
});
