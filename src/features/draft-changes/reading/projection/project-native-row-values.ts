import type { JsonValue } from '@revisium/schema-toolkit/types';
import type { PluginService } from 'src/features/plugin/plugin.service';
import type { RevisionChangesApiService } from 'src/features/revision-changes/revision-changes-api.service';
import type { DraftChangesFieldBoundary } from 'src/features/draft-changes/queries/impl/build-draft-changes-catalogue.query';
import type { DraftChangesCatalogueEntry } from 'src/features/draft-changes/queries/impl/build-draft-changes-catalogue.query';
import type { SchemaProjectionState } from 'src/features/draft-changes/queries/impl/project-draft-changes-schema.query';
import { buildRowFieldEntries } from 'src/features/draft-changes/catalogue/row-fields';
import type { NativeRowPair } from './prepare-native-row-pairs';

export interface ProjectedRowValues {
  tableCreatedId: string;
  rowCreatedId: string;
  beforeData: JsonValue;
  afterData: JsonValue;
}

export interface NativeRowProjection {
  rowValues: ProjectedRowValues[];
  supplementalEntries: DraftChangesCatalogueEntry[];
}

export async function projectNativeRowValues({
  pluginService,
  revisionChangesApi,
  nativeRows,
  headRevisionId,
  draftRevisionId,
  headTableId,
  draftTableId,
  tableCreatedId,
  migratedHead,
  boundaries,
}: {
  pluginService: PluginService;
  revisionChangesApi: RevisionChangesApiService;
  nativeRows: NativeRowPair[];
  headRevisionId: string;
  draftRevisionId: string;
  headTableId: string;
  draftTableId: string;
  tableCreatedId: string;
  migratedHead: SchemaProjectionState;
  boundaries: DraftChangesFieldBoundary[];
}): Promise<NativeRowProjection> {
  const projectedHeadRows = nativeRows.map(({ head }) => head);
  const projectedDraftRows = nativeRows.map(({ draft }) => draft);
  await Promise.all([
    pluginService.computeRowsWithSchema({
      revisionId: headRevisionId,
      tableId: headTableId,
      rows: projectedHeadRows,
      schema: migratedHead.schema,
    }),
    pluginService.computeRowsWithSchema({
      revisionId: draftRevisionId,
      tableId: draftTableId,
      rows: projectedDraftRows,
      schema: migratedHead.schema,
    }),
  ]);

  const comparison = await revisionChangesApi.compareSuppliedRows({
    pairs: nativeRows.map(({ createdId }, index) => ({
      key: createdId,
      fromData: projectedHeadRows[index]?.data as JsonValue,
      toData: projectedDraftRows[index]?.data as JsonValue,
    })),
  });
  const changesByRow = new Map(
    comparison.pairs.map(({ key, fieldChanges }) => [key, fieldChanges]),
  );
  const rowValues: ProjectedRowValues[] = [];
  const supplementalEntries: DraftChangesCatalogueEntry[] = [];

  for (let index = 0; index < nativeRows.length; index += 1) {
    const nativeRow = nativeRows[index];
    const projectedHead = projectedHeadRows[index];
    const projectedDraft = projectedDraftRows[index];
    if (!nativeRow || !projectedHead || !projectedDraft) {
      throw new Error('Native row projection lost positional row identity.');
    }

    const beforeData = projectedHead.data as JsonValue;
    const afterData = projectedDraft.data as JsonValue;
    rowValues.push({
      tableCreatedId,
      rowCreatedId: nativeRow.createdId,
      beforeData,
      afterData,
    });
    const entries = buildRowFieldEntries({
      identity: {
        tableCreatedId,
        rowCreatedId: nativeRow.createdId,
        tableId: draftTableId,
        rowId: nativeRow.draft.id,
      },
      beforeData,
      afterData,
      changes: changesByRow.get(nativeRow.createdId) ?? [],
      boundaries,
    });
    if (!Array.isArray(entries)) {
      throw new Error(
        `Native row projection has ambiguous field path '${entries.ambiguousPath}'.`,
      );
    }
    supplementalEntries.push(
      ...entries.filter(
        ({ classification, selectable }) =>
          classification === 'computed' && !selectable,
      ),
    );
  }

  return { rowValues, supplementalEntries };
}
