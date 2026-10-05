import type { DraftChangesCatalogueEntry } from 'src/features/draft-changes/queries/impl/build-draft-changes-catalogue.query';
import type {
  ProjectDraftChangesSchemaResult,
  SchemaProjectionRow,
} from 'src/features/draft-changes/queries/impl/project-draft-changes-schema.query';
import type { DraftRevisionState } from 'src/features/draft-revision/commands/impl/draft-revision-write-state.command';
import type { JsonValue } from '@revisium/schema-toolkit/types';
import type { ResolvedDraftChangesSelection } from 'src/features/draft-changes/queries/impl/calculate-data-candidates.query';
import { applyProjectedRows, detachState } from './candidate-state';
import {
  readField,
  schemaForTable,
  writeField,
  defaultAt,
} from './field-values';
import { removeRows, renameRows } from './row-state';
import { copyTables, removeTables, renameTables } from './table-state';
import { missingValue } from 'src/features/draft-changes/schema/json-value-path';
import objectHash from 'object-hash';
import { refreshRow } from './candidate-state';

type TableEntry = DraftChangesCatalogueEntry & {
  kind: 'table';
  target: Extract<DraftChangesCatalogueEntry['target'], { kind: 'table' }>;
};
type RowEntry = DraftChangesCatalogueEntry & {
  kind: 'row';
  target: Extract<DraftChangesCatalogueEntry['target'], { kind: 'row' }>;
};

export function buildDiscardCandidate(
  sourceHead: DraftRevisionState,
  sourceDraft: DraftRevisionState,
  selected: DraftChangesCatalogueEntry[],
  projections: Map<
    string,
    Extract<ProjectDraftChangesSchemaResult, { status: 'projected' }>
  >,
  deniedTargets: ResolvedDraftChangesSelection['deniedTargets'],
): { head: DraftRevisionState; draft: DraftRevisionState } {
  const head = detachState(sourceHead);
  const draft = detachState(sourceDraft);
  applyDiscardSchema(draft, projections);
  discardTableChanges(head, draft, selected);
  restoreAllowedDeletedTableRows(head, draft, selected, deniedTargets);
  discardRowChanges(head, draft, selected, projections);
  restoreSelectedFieldValues(draft, projections, selected);
  return { head, draft };
}

function discardTableChanges(
  head: DraftRevisionState,
  draft: DraftRevisionState,
  selected: DraftChangesCatalogueEntry[],
): void {
  const tables = tableEntries(selected);
  removeTables(
    draft,
    tables.filter(({ classification }) => classification === 'created'),
  );
  copyTables(
    head,
    draft,
    tables.filter(({ classification }) => classification === 'deleted'),
  );
  renameTables(draft, renamedTables(tables, 'before'));
}

function discardRowChanges(
  head: DraftRevisionState,
  draft: DraftRevisionState,
  selected: DraftChangesCatalogueEntry[],
  projections: Map<
    string,
    Extract<ProjectDraftChangesSchemaResult, { status: 'projected' }>
  >,
): void {
  const rows = rowEntries(selected);
  removeRows(
    draft,
    rows.filter(({ classification }) => classification === 'created'),
  );
  restoreDeletedRows(head, draft, rows, projections);
  renameRows(draft, renamedRows(rows, 'before'));
}

function restoreDeletedRows(
  head: DraftRevisionState,
  draft: DraftRevisionState,
  rows: ReturnType<typeof rowEntries>,
  projections: Map<
    string,
    Extract<ProjectDraftChangesSchemaResult, { status: 'projected' }>
  >,
): void {
  const headTables = new Map(
    head.tables.map((table) => [table.createdId, table]),
  );
  const draftTables = new Map(
    draft.tables.map((table) => [table.createdId, table]),
  );
  const draftRowsByTable = new Map(
    [...draftTables].map(([tableId, table]) => [
      tableId,
      new Map(table.rows.map((row) => [row.createdId, row])),
    ]),
  );
  const sourceRows = new Map(
    [...headTables].map(([tableId, table]) => [
      tableId,
      new Map(table.rows.map((row) => [row.createdId, row])),
    ]),
  );
  const retainedRows = new Map(
    [...projections].map(([tableId, projection]) => [
      tableId,
      new Map(projection.retainedHead.rows.map((row) => [row.createdId, row])),
    ]),
  );
  const schemaHashes = new Map(
    [...projections].map(([tableId, projection]) => [
      tableId,
      objectHash(projection.draft.schema),
    ]),
  );
  for (const entry of rows) {
    if (entry.classification !== 'deleted' || entry.target.kind !== 'row') {
      continue;
    }
    const tableId = entry.target.tableCreatedId;
    const targetRows = draftRowsByTable.get(tableId);
    const original = sourceRows.get(tableId)?.get(entry.target.rowCreatedId);
    const retained = retainedRows.get(tableId)?.get(entry.target.rowCreatedId);
    const schemaHash = schemaHashes.get(tableId);
    if (!targetRows || !original || !schemaHash) {
      continue;
    }
    const restored = structuredClone(original);
    if (retained) {
      restored.data = structuredClone(retained.data);
    }
    refreshRow(restored, schemaHash);
    targetRows.set(restored.createdId, restored);
  }
  for (const [tableId, rows] of draftRowsByTable) {
    const table = draftTables.get(tableId);
    if (table) {
      table.rows = [...rows.values()];
    }
  }
}

function tableEntries(entries: DraftChangesCatalogueEntry[]): TableEntry[] {
  return entries.filter(
    (entry): entry is TableEntry =>
      entry.kind === 'table' && entry.target.kind === 'table',
  );
}

function rowEntries(entries: DraftChangesCatalogueEntry[]): RowEntry[] {
  return entries.filter(
    (entry): entry is RowEntry =>
      entry.kind === 'row' && entry.target.kind === 'row',
  );
}

function renamedTables(
  entries: ReturnType<typeof tableEntries>,
  value: 'before' | 'after',
) {
  return entries.flatMap((entry) => {
    const id = entry[value];
    return entry.classification === 'renamed' && typeof id === 'string'
      ? [{ tableCreatedId: entry.target.tableCreatedId, id }]
      : [];
  });
}

function renamedRows(
  entries: ReturnType<typeof rowEntries>,
  value: 'before' | 'after',
) {
  return entries.flatMap((entry) => {
    const id = entry[value];
    return entry.classification === 'renamed' && typeof id === 'string'
      ? [
          {
            tableCreatedId: entry.target.tableCreatedId,
            rowCreatedId: entry.target.rowCreatedId,
            id,
          },
        ]
      : [];
  });
}

function restoreAllowedDeletedTableRows(
  head: DraftRevisionState,
  draft: DraftRevisionState,
  selected: DraftChangesCatalogueEntry[],
  deniedTargets: ResolvedDraftChangesSelection['deniedTargets'],
): void {
  for (const entry of selected) {
    if (
      entry.kind !== 'table' ||
      entry.target.kind !== 'table' ||
      entry.classification !== 'deleted'
    ) {
      continue;
    }
    const source = head.tables.find(
      ({ createdId }) => createdId === entry.target.tableCreatedId,
    );
    const target = draft.tables.find(
      ({ createdId }) => createdId === entry.target.tableCreatedId,
    );
    if (!source || !target) {
      continue;
    }
    const selectedRowIds = new Set(
      selected.flatMap((selectedEntry) =>
        selectedEntry.kind === 'row' &&
        selectedEntry.target.kind === 'row' &&
        selectedEntry.target.tableCreatedId === entry.target.tableCreatedId &&
        selectedEntry.classification === 'deleted'
          ? [selectedEntry.target.rowCreatedId]
          : [],
      ),
    );
    const explicitlyDeniedAllRows = deniedTargets.some(
      (denied) =>
        denied.kind === 'table' &&
        denied.tableCreatedId === entry.target.tableCreatedId &&
        denied.facets.includes('rows'),
    );
    target.rows = explicitlyDeniedAllRows
      ? []
      : structuredClone(
          source.rows.filter(({ createdId }) => selectedRowIds.has(createdId)),
        );
    const targetSchema = schemaForTable(draft, target.id);
    if (targetSchema) {
      for (const row of target.rows) {
        refreshRow(row, objectHash(targetSchema));
      }
    }
  }
}

function restoreSelectedFieldValues(
  draft: DraftRevisionState,
  projections: Map<
    string,
    Extract<ProjectDraftChangesSchemaResult, { status: 'projected' }>
  >,
  selected: DraftChangesCatalogueEntry[],
): void {
  const rows = indexDraftRows(draft);
  const defaults = new WeakMap<object, JsonValue>();
  const fieldMappings = indexFieldMappings(projections);
  const retainedRows = indexRetainedRows(projections);
  for (const entry of selected) {
    restoreSelectedFieldValue(
      entry,
      rows,
      projections,
      defaults,
      fieldMappings,
      retainedRows,
    );
  }
}

function restoreSelectedFieldValue(
  entry: DraftChangesCatalogueEntry,
  rows: Map<string, DraftRevisionState['tables'][number]['rows'][number]>,
  projections: Map<
    string,
    Extract<ProjectDraftChangesSchemaResult, { status: 'projected' }>
  >,
  defaults: WeakMap<object, JsonValue>,
  fieldMappings: Map<string, Map<string, string>>,
  retainedRows: Map<string, Map<string, SchemaProjectionRow>>,
): void {
  if (entry.kind !== 'rowField' || entry.target.kind !== 'rowField') {
    return;
  }
  const { tableCreatedId, rowCreatedId } = entry.target;
  const projection = projections.get(tableCreatedId);
  const targetPath =
    entry.path === ''
      ? ''
      : fieldMappings.get(tableCreatedId)?.get(entry.path ?? '');
  const target = rows.get(rowKey(tableCreatedId, rowCreatedId));
  const source = retainedRows.get(tableCreatedId)?.get(rowCreatedId);
  if (!projection || targetPath === undefined || !target || !source) {
    return;
  }
  const value = entry.beforeExists
    ? readField(source, targetPath)
    : missingValue;
  const restored =
    value === null
      ? defaultAt(projection.draft.schema, targetPath, defaults)
      : value;
  writeField(target, targetPath, restored);
}

function indexFieldMappings(
  projections: Map<
    string,
    Extract<ProjectDraftChangesSchemaResult, { status: 'projected' }>
  >,
): Map<string, Map<string, string>> {
  return new Map(
    [...projections].map(([tableId, projection]) => [
      tableId,
      new Map(
        projection.rowTargetFieldMappings.map(({ fromPath, toPath }) => [
          fromPath,
          toPath,
        ]),
      ),
    ]),
  );
}

function indexRetainedRows(
  projections: Map<
    string,
    Extract<ProjectDraftChangesSchemaResult, { status: 'projected' }>
  >,
): Map<string, Map<string, SchemaProjectionRow>> {
  return new Map(
    [...projections].map(([tableId, projection]) => [
      tableId,
      new Map(projection.retainedHead.rows.map((row) => [row.createdId, row])),
    ]),
  );
}

function indexDraftRows(
  draft: DraftRevisionState,
): Map<string, DraftRevisionState['tables'][number]['rows'][number]> {
  const rows = new Map<
    string,
    DraftRevisionState['tables'][number]['rows'][number]
  >();
  for (const table of draft.tables) {
    for (const row of table.rows) {
      rows.set(rowKey(table.createdId, row.createdId), row);
    }
  }
  return rows;
}

function rowKey(tableCreatedId: string, rowCreatedId: string): string {
  return `${tableCreatedId}\u0000${rowCreatedId}`;
}

function applyDiscardSchema(
  draft: DraftRevisionState,
  projections: Map<
    string,
    Extract<ProjectDraftChangesSchemaResult, { status: 'projected' }>
  >,
): void {
  for (const [tableCreatedId, projection] of projections) {
    applyProjectedRows(
      draft,
      tableCreatedId,
      projection.draft.rows,
      projection.draft.schema,
      projection.draft.history,
    );
  }
}
