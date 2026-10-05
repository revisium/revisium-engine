import { Injectable } from '@nestjs/common';
import { RevisionChangesApiService } from 'src/features/revision-changes/revision-changes-api.service';
import { PluginService } from 'src/features/plugin/plugin.service';
import { pairSnapshotTables } from 'src/features/draft-changes/catalogue/snapshot-pairs';
import type {
  BuildDraftChangesCatalogueQueryData,
  DraftChangesCatalogue,
  DraftChangesCatalogueEntry,
} from 'src/features/draft-changes/queries/impl/build-draft-changes-catalogue.query';
import { mergeProjectedCatalogue } from './merge-projected-catalogue';
import { prepareNativeRowPairs } from './prepare-native-row-pairs';
import {
  projectNativeRowValues,
  type ProjectedRowValues,
} from './project-native-row-values';

@Injectable()
export class DraftChangesReadProjection {
  constructor(
    private readonly pluginService: PluginService,
    private readonly revisionChangesApi: RevisionChangesApiService,
  ) {}

  public async project(
    input: BuildDraftChangesCatalogueQueryData & {
      catalogue: DraftChangesCatalogue;
    },
  ): Promise<DraftChangesCatalogue> {
    const pairedTables = pairSnapshotTables(input.snapshot);
    if ('blocker' in pairedTables) {
      throw new Error(pairedTables.blocker);
    }
    const projectionsByTable = new Map(
      input.schemaProjections.map(({ tableCreatedId, projection }) => [
        tableCreatedId,
        projection,
      ]),
    );
    const rowValues: ProjectedRowValues[] = [];
    const supplementalEntries: DraftChangesCatalogueEntry[] = [];

    for (const table of pairedTables.pairs) {
      if (!table.head || !table.draft) {
        continue;
      }
      const projection = projectionsByTable.get(table.createdId);
      if (!projection || projection.status !== 'projected') {
        throw new Error(
          `Successful catalogue is missing full schema projection for table '${table.createdId}'.`,
        );
      }
      const nativeRows = prepareNativeRowPairs({
        tableCreatedId: table.createdId,
        headRows: table.head.rows,
        draftRows: table.draft.rows,
        migratedHeadRows: projection.migratedHead.rows,
      });
      if (nativeRows.length === 0) {
        continue;
      }
      const projected = await projectNativeRowValues({
        pluginService: this.pluginService,
        revisionChangesApi: this.revisionChangesApi,
        nativeRows,
        headRevisionId: input.snapshot.head.id,
        draftRevisionId: input.snapshot.draft.id,
        headTableId: table.head.id,
        draftTableId: table.draft.id,
        tableCreatedId: table.createdId,
        migratedHead: projection.migratedHead,
        boundaries: input.catalogue.fieldBoundaries.filter(
          (boundary) => boundary.tableCreatedId === table.createdId,
        ),
      });
      rowValues.push(...projected.rowValues);
      supplementalEntries.push(...projected.supplementalEntries);
    }

    return mergeProjectedCatalogue({
      catalogue: input.catalogue,
      rowValues,
      supplementalEntries,
    });
  }
}
