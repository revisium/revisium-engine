import type { JsonPatch, JsonSchema } from '@revisium/schema-toolkit/types';
import type { InputJsonValue } from 'src/engine-prisma-types';
import { DraftChangesApiService } from 'src/features/draft-changes/draft-changes-api.service';
import { givenDraftProjectWithSchema } from 'src/__tests__/fixtures/scenarios/given-draft-project';
import type { DraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import { DraftRevisionApiService } from 'src/features/draft-revision/draft-revision-api.service';
import { ViewsApiService } from 'src/features/views/views-api.service';
import type { TableViewsData } from 'src/features/views/types';
import {
  getNumberSchema,
  getObjectSchema,
  getStringSchema,
} from '@revisium/schema-toolkit/mocks';

const tableId = 'products';
const baselineSchema = getObjectSchema({
  price: getNumberSchema(),
  title: getStringSchema(),
});
const baselineData = { price: 10, title: 'Head' };

type ProjectFixture = Awaited<ReturnType<typeof givenDraftProjectWithSchema>>;

export interface NativeViewFixture {
  readSnapshot(): ReturnType<DraftChangesApiService['readSnapshot']>;
  updateDraftViews(views: TableViewsData): Promise<void>;
  updateDraftViewsForTable(
    tableId: string,
    views: TableViewsData,
  ): Promise<void>;
  createDraftTable(
    tableId: string,
    schema: JsonSchema,
    rows?: Array<{ rowId: string; data: Record<string, unknown> }>,
  ): Promise<void>;
  createDraftRow(
    tableId: string,
    rowId: string,
    data: Record<string, unknown>,
  ): Promise<void>;
  updateDraftRow(
    tableId: string,
    rowId: string,
    data: Record<string, unknown>,
  ): Promise<void>;
  removeDraftRow(tableId: string, rowId: string): Promise<void>;
  renameDraftTable(tableId: string, nextTableId: string): Promise<void>;
  seedHeadViews(views: TableViewsData): Promise<void>;
  updateDraftSchema(patches: JsonPatch[]): Promise<void>;
  renameDraftPriceField(): Promise<void>;
  removeDraftTitleField(): Promise<void>;
  commitDraft(): Promise<void>;
  close(): Promise<void>;
}

export async function givenNativeViewFixture(
  kit: DraftTestKit,
  changes: DraftChangesApiService,
): Promise<NativeViewFixture> {
  const fixture = await givenDraftProjectWithSchema({
    prismaService: kit.prismaService,
    schema: baselineSchema,
    tableId,
    row: { rowId: 'product', data: baselineData },
  });
  return createNativeViewFixture({ kit, changes, fixture });
}

function createNativeViewFixture({
  kit,
  changes,
  fixture,
}: {
  kit: DraftTestKit;
  changes: DraftChangesApiService;
  fixture: ProjectFixture;
}): NativeViewFixture {
  const draftRevisionApi = kit.module.get(DraftRevisionApiService);
  const viewsApi = kit.module.get(ViewsApiService);

  async function readSnapshot() {
    return changes.readSnapshot({
      projectId: fixture.projectId,
      branchName: fixture.branchName,
    });
  }

  async function updateDraftViews(views: TableViewsData): Promise<void> {
    return updateDraftViewsForTable(tableId, views);
  }

  async function updateDraftViewsForTable(
    ownerTableId: string,
    views: TableViewsData,
  ): Promise<void> {
    const snapshot = await readSnapshot();
    await viewsApi.updateTableViews({
      revisionId: snapshot.draft.id,
      tableId: ownerTableId,
      viewsData: views,
    });
  }

  async function createDraftTable(
    newTableId: string,
    schema: JsonSchema,
    rows: Array<{ rowId: string; data: Record<string, unknown> }> = [],
  ): Promise<void> {
    const snapshot = await readSnapshot();
    await kit.draftApiService.apiCreateTable({
      revisionId: snapshot.draft.id,
      tableId: newTableId,
      schema: schema as unknown as InputJsonValue,
    });
    for (const row of rows) {
      await kit.draftApiService.apiCreateRow({
        revisionId: snapshot.draft.id,
        tableId: newTableId,
        rowId: row.rowId,
        data: row.data as InputJsonValue,
      });
    }
  }

  async function createDraftRow(
    ownerTableId: string,
    rowId: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const snapshot = await readSnapshot();
    await kit.draftApiService.apiCreateRow({
      revisionId: snapshot.draft.id,
      tableId: ownerTableId,
      rowId,
      data: data as InputJsonValue,
    });
  }

  async function updateDraftRow(
    ownerTableId: string,
    rowId: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const snapshot = await readSnapshot();
    await kit.draftApiService.apiUpdateRow({
      revisionId: snapshot.draft.id,
      tableId: ownerTableId,
      rowId,
      data: data as InputJsonValue,
    });
  }

  async function removeDraftRow(
    ownerTableId: string,
    rowId: string,
  ): Promise<void> {
    const snapshot = await readSnapshot();
    await kit.draftApiService.apiRemoveRow({
      revisionId: snapshot.draft.id,
      tableId: ownerTableId,
      rowId,
    });
  }

  async function renameDraftTable(
    ownerTableId: string,
    nextTableId: string,
  ): Promise<void> {
    const snapshot = await readSnapshot();
    await kit.draftApiService.apiRenameTable({
      revisionId: snapshot.draft.id,
      tableId: ownerTableId,
      nextTableId,
    });
  }

  async function seedHeadViews(views: TableViewsData): Promise<void> {
    await updateDraftViews(views);
    await commitDraft();
  }

  async function updateDraftSchema(patches: JsonPatch[]): Promise<void> {
    const snapshot = await readSnapshot();
    await kit.draftApiService.apiUpdateTable({
      revisionId: snapshot.draft.id,
      tableId,
      patches,
    });
  }

  async function renameDraftPriceField(): Promise<void> {
    await updateDraftSchema([
      { op: 'move', from: '/properties/price', path: '/properties/cost' },
    ]);
  }

  async function removeDraftTitleField(): Promise<void> {
    await updateDraftSchema([{ op: 'remove', path: '/properties/title' }]);
  }

  async function commitDraft(): Promise<void> {
    const snapshot = await readSnapshot();
    await kit.transactionService.runSerializable(async () => {
      await draftRevisionApi.writeState({
        revisionId: snapshot.draft.id,
        candidate: { tables: snapshot.draft.tables },
        sources: {
          head: { tables: snapshot.head.tables },
          others: [{ tables: snapshot.draft.tables }],
        },
      });
      await draftRevisionApi.commit({
        branchId: fixture.branchId,
        comment: 'Stage 9 native view fixture',
      });
    });
  }

  return {
    readSnapshot,
    updateDraftViews,
    updateDraftViewsForTable,
    createDraftTable,
    createDraftRow,
    updateDraftRow,
    removeDraftRow,
    renameDraftTable,
    seedHeadViews,
    updateDraftSchema,
    renameDraftPriceField,
    removeDraftTitleField,
    commitDraft,
    close: () => kit.close(),
  };
}
