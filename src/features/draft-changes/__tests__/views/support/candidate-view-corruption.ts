import type { JsonPatch } from '@revisium/schema-toolkit/types';
import type { JsonValue } from '@revisium/schema-toolkit/types';
import { getStringSchema } from '@revisium/schema-toolkit/mocks';
import type { BuildDraftChangesCatalogueResult } from 'src/features/draft-changes/queries/impl/build-draft-changes-catalogue.query';
import { SystemTables } from 'src/features/share/system-tables.consts';
import type { DraftChangesSnapshot } from 'src/features/draft-changes/queries/impl/read-draft-changes-snapshot.query';
import type { ResolveCandidateViewsResult } from 'src/features/draft-changes/queries/impl/resolve-candidate-views.query';
import type { PrismaService } from 'src/infrastructure/database/prisma.service';

const tableId = 'products';

export interface CandidateViewCorruption {
  tamperDraftSchemaHistory(): Promise<void>;
  resolveRestoreHeadWithViews(
    viewsData: unknown,
  ): Promise<ResolveCandidateViewsResult>;
  catalogueWithDraftViews(
    viewsData: unknown,
  ): Promise<BuildDraftChangesCatalogueResult>;
  catalogueWithDuplicateDraftViewsRow(): Promise<BuildDraftChangesCatalogueResult>;
}

export function createCandidateViewCorruption({
  readSnapshot,
  updateDraftSchema,
  prismaService,
  restoreHeadFromSnapshot,
  catalogueFromSnapshot,
}: {
  readSnapshot: () => Promise<DraftChangesSnapshot>;
  updateDraftSchema: (patches: JsonPatch[]) => Promise<void>;
  prismaService: PrismaService;
  restoreHeadFromSnapshot: (
    snapshot: DraftChangesSnapshot,
  ) => Promise<ResolveCandidateViewsResult>;
  catalogueFromSnapshot: (
    snapshot: DraftChangesSnapshot,
  ) => Promise<BuildDraftChangesCatalogueResult>;
}): CandidateViewCorruption {
  async function tamperDraftSchemaHistory(): Promise<void> {
    await updateDraftSchema([
      {
        op: 'add',
        path: '/properties/stage9RestoreProbe',
        value: getStringSchema(),
      },
    ]);
    const snapshot = await readSnapshot();
    const schemaTable = snapshot.draft.tables.find(
      ({ id }) => id === SystemTables.Schema,
    );
    const headSchemaTable = snapshot.head.tables.find(
      ({ id }) => id === SystemTables.Schema,
    );
    const schemaRow = schemaTable?.rows.find(({ id }) => id === tableId);
    const headSchemaRow = headSchemaTable?.rows.find(
      ({ id }) => id === tableId,
    );
    if (!schemaRow || !headSchemaRow) {
      throw new Error('Expected persisted Head and Draft schema rows.');
    }
    if (schemaRow.versionId === headSchemaRow.versionId) {
      throw new Error(
        'Expected Draft schema history to have copy-on-write identity.',
      );
    }
    const originalHeadSchema = structuredClone({
      versionId: headSchemaRow.versionId,
      data: headSchemaRow.data,
      meta: headSchemaRow.meta,
    });
    await prismaService.row.update({
      where: { versionId: schemaRow.versionId },
      data: { meta: 'invalid-history' },
    });
    const afterTamper = await readSnapshot();
    const afterHeadSchemaTable = afterTamper.head.tables.find(
      ({ id }) => id === SystemTables.Schema,
    );
    const afterHeadSchemaRow = afterHeadSchemaTable?.rows.find(
      ({ id }) => id === tableId,
    );
    if (
      !afterHeadSchemaRow ||
      afterHeadSchemaRow.versionId !== originalHeadSchema.versionId ||
      JSON.stringify(afterHeadSchemaRow.data) !==
        JSON.stringify(originalHeadSchema.data) ||
      JSON.stringify(afterHeadSchemaRow.meta) !==
        JSON.stringify(originalHeadSchema.meta)
    ) {
      throw new Error(
        'Draft history corruption changed the original Head schema.',
      );
    }
  }

  async function resolveRestoreHeadWithViews(
    viewsData: unknown,
  ): Promise<ResolveCandidateViewsResult> {
    const source = await readSnapshot();
    const snapshot = structuredClone(source);
    const owner = snapshot.head.tables.find(({ id }) => id === tableId);
    const viewsTable = snapshot.head.tables.find(
      ({ id }) => id === SystemTables.Views,
    );
    const viewsRow = viewsTable?.rows.find(({ id }) => id === owner?.id);
    if (!viewsRow) {
      throw new Error(
        'Expected a native Head views row to mutate in detached input.',
      );
    }
    viewsRow.data = viewsData as JsonValue;
    return restoreHeadFromSnapshot(snapshot);
  }

  async function catalogueWithDraftViews(
    viewsData: unknown,
  ): Promise<BuildDraftChangesCatalogueResult> {
    const snapshot = structuredClone(await readSnapshot());
    const viewsRow = findDraftViewsRow(snapshot);
    viewsRow.data = viewsData as JsonValue;
    return catalogueFromSnapshot(snapshot);
  }

  async function catalogueWithDuplicateDraftViewsRow(): Promise<BuildDraftChangesCatalogueResult> {
    const snapshot = structuredClone(await readSnapshot());
    const viewsTable = snapshot.draft.tables.find(
      ({ id }) => id === SystemTables.Views,
    );
    const viewsRow = findDraftViewsRow(snapshot);
    if (!viewsTable) {
      throw new Error('Expected the native Draft views table.');
    }
    viewsTable.rows.push(structuredClone(viewsRow));
    return catalogueFromSnapshot(snapshot);
  }

  function findDraftViewsRow(snapshot: DraftChangesSnapshot) {
    const owner = snapshot.draft.tables.find(({ id }) => id === tableId);
    const viewsTable = snapshot.draft.tables.find(
      ({ id }) => id === SystemTables.Views,
    );
    const viewsRow = viewsTable?.rows.find(({ id }) => id === owner?.id);
    if (!viewsRow) {
      throw new Error(
        'Expected the native Draft views row for the products table.',
      );
    }
    return viewsRow;
  }

  return {
    tamperDraftSchemaHistory,
    resolveRestoreHeadWithViews,
    catalogueWithDraftViews,
    catalogueWithDuplicateDraftViewsRow,
  };
}
