import type { DraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import {
  givenDraftProject,
  type DraftProjectScenario,
} from 'src/__tests__/fixtures/scenarios/given-draft-project';
import { createBarrier } from 'src/__tests__/utils/barrier';
import { DraftRevisionInternalService } from 'src/features/draft-revision/services';
import { createMigrationRecord } from 'src/features/migration/__tests__/support/migration-database';
import { MigrationStatus } from 'src/features/migration/types/migration.types';
import type { TableViewsData } from 'src/features/views/types';
import { ViewsApiService } from 'src/features/views/views-api.service';

export interface ViewsUpdateDuringCommit {
  update: Promise<boolean>;
  committedRevisionId: string;
}

export async function givenDraftWithViews(
  kit: DraftTestKit,
  viewsData: TableViewsData,
): Promise<DraftProjectScenario> {
  const draft = await givenDraftProject(kit.prismaService);
  await updateViews(kit, draft, viewsData);
  return draft;
}

export async function givenActiveMigration(
  kit: DraftTestKit,
  draft: DraftProjectScenario,
): Promise<void> {
  await createMigrationRecord(
    kit.prismaService,
    draft.draftRevisionId,
    MigrationStatus.COPYING,
    { tableId: draft.tableId },
  );
}

export function updateViews(
  kit: DraftTestKit,
  draft: DraftProjectScenario,
  viewsData: TableViewsData,
): Promise<boolean> {
  return kit.module.get(ViewsApiService).updateTableViews({
    revisionId: draft.draftRevisionId,
    tableId: draft.tableId,
    viewsData,
  });
}

export function readViews(
  kit: DraftTestKit,
  revisionId: string,
  tableId: string,
): Promise<TableViewsData> {
  return kit.module.get(ViewsApiService).getTableViews({ revisionId, tableId });
}

export async function updateViewsWhileBranchCommits(
  kit: DraftTestKit,
  draft: DraftProjectScenario,
  viewsData: TableViewsData,
): Promise<ViewsUpdateDuringCommit> {
  const hold = holdViewsUpdateBeforeRowWrite(kit);
  const update = updateViews(kit, draft, viewsData);
  const updateSettled = Promise.allSettled([update]);

  try {
    await hold.expectReachedBefore(update);

    const committed = await kit.draftApiService.apiCreateRevision({
      projectId: draft.projectId,
      branchName: draft.branchName,
    });

    return { update, committedRevisionId: committed.id };
  } finally {
    hold.release();
    await updateSettled;
    hold.restore();
  }
}

function holdViewsUpdateBeforeRowWrite(kit: DraftTestKit) {
  const barrier = createBarrier('The views update');
  const internalService = kit.module.get(DraftRevisionInternalService);
  const getOrCreateDraftRow =
    internalService.getOrCreateDraftRow.bind(internalService);

  const spy = jest
    .spyOn(internalService, 'getOrCreateDraftRow')
    .mockImplementation(async (data) => {
      const draftRow = await getOrCreateDraftRow(data);
      await barrier.arrive();
      return draftRow;
    });

  return {
    expectReachedBefore: barrier.expectReachedBefore,
    release: barrier.release,
    restore: () => spy.mockRestore(),
  };
}
