import { MigrationLockedException } from 'src/features/migration/exceptions/migration-locked.exception';
import { givenReadingScenario } from './support/reading-scenario';
import { useReadingTestKit } from './support/reading-test-kit';

describe('Draft Changes reader: summary', () => {
  const kit = useReadingTestKit();

  it('reports an empty semantic diff when stored row values agree', async () => {
    const scenario = await givenReadingScenario(kit(), {
      head: { title: 'Same' },
    });

    await expect(kit().changes.draftChanges(scenario.branch)).resolves.toEqual({
      isEmpty: true,
      counts: { tables: 0, rows: 0, fields: 0 },
    });
  });

  it('counts independent changed fields separately', async () => {
    const scenario = await givenReadingScenario(kit(), {
      head: { title: 'Head', price: 10 },
      draft: { title: 'Draft', price: 20 },
    });

    const result = await kit().changes.draftChanges(scenario.branch);

    expect(result.isEmpty).toBe(false);
    expect(result.counts).toEqual({ tables: 1, rows: 1, fields: 2 });
  });

  it('propagates an active migration block instead of reporting an empty diff', async () => {
    const scenario = await givenReadingScenario(kit(), {
      head: { title: 'Head' },
    });
    await scenario.startMigration();

    await expect(
      kit().changes.draftChanges(scenario.branch),
    ).rejects.toBeInstanceOf(MigrationLockedException);
  });
});
