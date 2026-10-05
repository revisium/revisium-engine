import type { BuildDraftChangesCatalogueResult } from 'src/features/draft-changes/queries/impl/build-draft-changes-catalogue.query';
import type { DraftChangesApiService } from 'src/features/draft-changes/draft-changes-api.service';
import type { ReadDraftChangesQueryData } from 'src/features/draft-changes/queries/impl/read-draft-changes.query';
import type { DraftChangesSnapshot } from 'src/features/draft-changes/queries/impl/read-draft-changes-snapshot.query';
import type { DraftChangesCatalogue } from 'src/features/draft-changes/queries/impl/build-draft-changes-catalogue.query';

export async function readCatalogue(
  changes: DraftChangesApiService,
  branch: ReadDraftChangesQueryData,
): Promise<BuildDraftChangesCatalogueResult> {
  const snapshot = await changes.readSnapshot(branch);
  const sharedTables = snapshot.head.tables.filter(
    ({ system, createdId }) =>
      !system &&
      snapshot.draft.tables.some(
        (draftTable) => draftTable.createdId === createdId,
      ),
  );
  const schemaProjections = await Promise.all(
    sharedTables.map(async ({ createdId }) => ({
      tableCreatedId: createdId,
      projection: await changes.projectSchema({
        snapshot,
        tableCreatedId: createdId,
        operation: 'commit',
        effects: [],
      }),
    })),
  );
  return changes.buildCatalogue({ snapshot, schemaProjections });
}

export function readSnapshot(
  changes: DraftChangesApiService,
  branch: ReadDraftChangesQueryData,
): Promise<DraftChangesSnapshot> {
  return changes.readSnapshot(branch);
}

export function requireCatalogue(
  result: BuildDraftChangesCatalogueResult,
): DraftChangesCatalogue {
  if (result.status !== 'catalogued') {
    throw new Error(`Expected a catalogue: ${JSON.stringify(result)}.`);
  }
  return result.catalogue;
}
