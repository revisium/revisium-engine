import {
  createDraftTestKit,
  type DraftTestKit,
} from 'src/__tests__/kit/create-draft-test-kit';
import { MigrationLockedException } from 'src/features/migration/exceptions/migration-locked.exception';
import type { TableViewsData } from 'src/features/views/types';
import {
  givenActiveMigration,
  givenDraftWithViews,
  readViews,
  updateViews,
  updateViewsWhileBranchCommits,
} from './support/views-update-scenario';

const savedViews: TableViewsData = {
  version: 1,
  defaultViewId: 'saved',
  views: [{ id: 'saved', name: 'Saved' }],
};

const nextViews: TableViewsData = {
  version: 1,
  defaultViewId: 'next',
  views: [{ id: 'next', name: 'Next' }],
};

describe('ViewsApiService.updateTableViews', () => {
  it('refuses while an async migration is active and keeps the saved views', async () => {
    const draft = await givenDraftWithViews(kit, savedViews);
    await givenActiveMigration(kit, draft);

    await expect(updateViews(kit, draft, nextViews)).rejects.toThrow(
      MigrationLockedException,
    );

    await expectViews(draft.draftRevisionId, draft.tableId, savedViews);
  });

  it('keeps the views published by a commit that lands during the update', async () => {
    const draft = await givenDraftWithViews(kit, savedViews);

    const race = await updateViewsWhileBranchCommits(kit, draft, nextViews);

    await expectViews(race.committedRevisionId, draft.tableId, savedViews);
    await expect(race.update).rejects.toThrow('The revision is not a draft');
  });

  async function expectViews(
    revisionId: string,
    tableId: string,
    expected: TableViewsData,
  ): Promise<void> {
    await expect(readViews(kit, revisionId, tableId)).resolves.toEqual(
      expected,
    );
  }

  let kit: DraftTestKit;

  beforeAll(async () => {
    kit = await createDraftTestKit({
      migrationOptions: { workerMode: 'disabled' },
    });
  });

  afterAll(async () => {
    await kit.close();
  });
});
