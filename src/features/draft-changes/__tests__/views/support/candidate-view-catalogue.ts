import type {
  BuildDraftChangesCatalogueResult,
  DraftChangesCatalogue,
  DraftChangesCatalogueEntry,
} from 'src/features/draft-changes/queries/impl/build-draft-changes-catalogue.query';
import type { DraftChangesSelection } from 'src/features/draft-changes/queries/impl/resolve-draft-changes-selection.query';
import type { ResolveDraftChangesSelectionResult } from 'src/features/draft-changes/queries/impl/resolve-draft-changes-selection.query';
import type { DraftChangesSnapshot } from 'src/features/draft-changes/queries/impl/read-draft-changes-snapshot.query';
import { DraftChangesApiService } from 'src/features/draft-changes/draft-changes-api.service';

export interface CandidateViewCatalogue {
  catalogue(): Promise<DraftChangesCatalogue>;
  catalogueFromSnapshot(
    snapshot: DraftChangesSnapshot,
  ): Promise<BuildDraftChangesCatalogueResult>;
  findViewEntry(
    catalogue: DraftChangesCatalogue,
    viewId: string,
    component: string,
    tableCreatedId?: string,
  ): DraftChangesCatalogueEntry | undefined;
  findViewConfigurationEntry(
    catalogue: DraftChangesCatalogue,
    component: string,
    tableCreatedId?: string,
  ): DraftChangesCatalogueEntry | undefined;
  findSchemaEntry(
    catalogue: DraftChangesCatalogue,
    path: string,
    tableCreatedId?: string,
  ): DraftChangesCatalogueEntry | undefined;
  viewEntry(
    viewId: string,
    component: string,
    tableCreatedId?: string,
  ): Promise<DraftChangesCatalogueEntry | undefined>;
  viewConfigurationEntry(
    component: string,
    tableCreatedId?: string,
  ): Promise<DraftChangesCatalogueEntry | undefined>;
  schemaEntry(
    path: string,
    tableCreatedId?: string,
  ): Promise<DraftChangesCatalogueEntry | undefined>;
  tableEntry(
    tableCreatedId: string,
  ): Promise<DraftChangesCatalogueEntry | undefined>;
  rowEntry(
    tableCreatedId: string,
    rowCreatedId: string,
  ): Promise<DraftChangesCatalogueEntry | undefined>;
  resolveNativeSelection(
    selection: DraftChangesSelection,
  ): Promise<ResolveDraftChangesSelectionResult>;
}

export function createCandidateViewCatalogue({
  changes,
  readSnapshot,
}: {
  changes: DraftChangesApiService;
  readSnapshot: () => Promise<DraftChangesSnapshot>;
}): CandidateViewCatalogue {
  async function catalogue(): Promise<DraftChangesCatalogue> {
    const snapshot = await readSnapshot();
    const result = await catalogueFromSnapshot(snapshot);
    if (result.status !== 'catalogued') {
      throw new Error(`Expected a native catalogue: ${JSON.stringify(result)}`);
    }
    return result.catalogue;
  }

  async function catalogueFromSnapshot(
    snapshot: DraftChangesSnapshot,
  ): Promise<BuildDraftChangesCatalogueResult> {
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
    return changes.buildCatalogue({
      snapshot,
      schemaProjections,
    });
  }

  function findViewEntry(
    currentCatalogue: DraftChangesCatalogue,
    viewId: string,
    component: string,
    tableCreatedId?: string,
  ): DraftChangesCatalogueEntry | undefined {
    return currentCatalogue.entries.find(
      ({ target }) =>
        target.kind === 'view' &&
        target.viewId === viewId &&
        target.component === component &&
        (!tableCreatedId || target.tableCreatedId === tableCreatedId),
    );
  }

  function findViewConfigurationEntry(
    currentCatalogue: DraftChangesCatalogue,
    component: string,
    tableCreatedId?: string,
  ): DraftChangesCatalogueEntry | undefined {
    return currentCatalogue.entries.find(
      ({ target }) =>
        target.kind === 'viewConfiguration' &&
        target.component === component &&
        (!tableCreatedId || target.tableCreatedId === tableCreatedId),
    );
  }

  function findSchemaEntry(
    currentCatalogue: DraftChangesCatalogue,
    path: string,
    tableCreatedId?: string,
  ): DraftChangesCatalogueEntry | undefined {
    return currentCatalogue.entries.find(
      ({ target }) =>
        target.kind === 'schemaField' &&
        target.path === path &&
        (!tableCreatedId || target.tableCreatedId === tableCreatedId),
    );
  }

  async function viewEntry(
    viewId: string,
    component: string,
    tableCreatedId?: string,
  ): Promise<DraftChangesCatalogueEntry | undefined> {
    const currentCatalogue = await catalogue();
    return findViewEntry(currentCatalogue, viewId, component, tableCreatedId);
  }

  async function viewConfigurationEntry(
    component: string,
    tableCreatedId?: string,
  ): Promise<DraftChangesCatalogueEntry | undefined> {
    const currentCatalogue = await catalogue();
    return findViewConfigurationEntry(
      currentCatalogue,
      component,
      tableCreatedId,
    );
  }

  async function schemaEntry(
    path: string,
    tableCreatedId?: string,
  ): Promise<DraftChangesCatalogueEntry | undefined> {
    const currentCatalogue = await catalogue();
    return findSchemaEntry(currentCatalogue, path, tableCreatedId);
  }

  async function tableEntry(
    tableCreatedId: string,
  ): Promise<DraftChangesCatalogueEntry | undefined> {
    const currentCatalogue = await catalogue();
    return currentCatalogue.entries.find(
      ({ target }) =>
        target.kind === 'table' && target.tableCreatedId === tableCreatedId,
    );
  }

  async function rowEntry(
    tableCreatedId: string,
    rowCreatedId: string,
  ): Promise<DraftChangesCatalogueEntry | undefined> {
    const currentCatalogue = await catalogue();
    return currentCatalogue.entries.find(
      ({ target }) =>
        target.kind === 'row' &&
        target.tableCreatedId === tableCreatedId &&
        target.rowCreatedId === rowCreatedId,
    );
  }

  async function resolveNativeSelection(
    selection: DraftChangesSelection,
  ): Promise<ResolveDraftChangesSelectionResult> {
    return changes.resolveSelection({
      catalogue: await catalogue(),
      selection,
    });
  }

  return {
    catalogue,
    catalogueFromSnapshot,
    findViewEntry,
    findViewConfigurationEntry,
    findSchemaEntry,
    viewEntry,
    viewConfigurationEntry,
    schemaEntry,
    tableEntry,
    rowEntry,
    resolveNativeSelection,
  };
}
