import type { DraftChangesCatalogueEntry } from 'src/features/draft-changes/queries/impl/build-draft-changes-catalogue.query';
import type { ProjectDraftChangesSchemaResult } from 'src/features/draft-changes/queries/impl/project-draft-changes-schema.query';
import type { JsonValue } from '@revisium/schema-toolkit/types';
import type { DraftRevisionState } from 'src/features/draft-revision/commands/impl/draft-revision-write-state.command';
import { applyProjectedRows, detachState } from './candidate-state';
import {
  defaultAt,
  readField,
  schemaForTable,
  writeField,
} from './field-values';
import { copyRows, removeRows, renameRows } from './row-state';
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

export function buildCommitCandidate(
  sourceHead: DraftRevisionState,
  sourceDraft: DraftRevisionState,
  selected: DraftChangesCatalogueEntry[],
  projections: Map<
    string,
    Extract<ProjectDraftChangesSchemaResult, { status: 'projected' }>
  >,
): { head: DraftRevisionState; draft: DraftRevisionState } {
  const head = detachState(sourceHead);
  const draft = detachState(sourceDraft);
  applyCommitSchema(head, draft, projections);
  commitTableChanges(head, draft, selected);
  commitRowChanges(head, draft, selected);
  applySelectedFieldValues(head, draft, selected, projections);
  refreshCreatedRowSchemaHashes(head, draft, selected, projections);
  return { head, draft };
}

function commitTableChanges(
  head: DraftRevisionState,
  draft: DraftRevisionState,
  selected: DraftChangesCatalogueEntry[],
): void {
  const tables = tableEntries(selected);
  removeTables(
    head,
    tables.filter(({ classification }) => classification === 'deleted'),
  );
  copyTables(
    draft,
    head,
    tables.filter(({ classification }) => classification === 'created'),
  );
  renameTables(head, renamedTables(tables, 'after'));
}

function commitRowChanges(
  head: DraftRevisionState,
  draft: DraftRevisionState,
  selected: DraftChangesCatalogueEntry[],
): void {
  const rows = rowEntries(selected);
  removeRows(
    head,
    rows.filter(({ classification }) => classification === 'deleted'),
  );
  copyRows(
    draft,
    head,
    rows.filter(({ classification }) => classification === 'created'),
  );
  renameRows(head, renamedRows(rows, 'after'));
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

function refreshCreatedRowSchemaHashes(
  head: DraftRevisionState,
  draft: DraftRevisionState,
  selected: DraftChangesCatalogueEntry[],
  projections: Map<
    string,
    Extract<ProjectDraftChangesSchemaResult, { status: 'projected' }>
  >,
): void {
  const destinationTables = new Map(
    head.tables.map((table) => [table.createdId, table]),
  );
  const sourceTables = new Map(
    draft.tables.map((table) => [table.createdId, table]),
  );
  const sourceRows = new Map(
    [...sourceTables].map(([tableId, table]) => [
      tableId,
      new Map(table.rows.map((row) => [row.createdId, row])),
    ]),
  );
  const destinationRows = new Map(
    [...destinationTables].map(([tableId, table]) => [
      tableId,
      new Map(table.rows.map((row) => [row.createdId, row])),
    ]),
  );
  const schemaHashes = new Map<string, string>();
  for (const entry of rowEntries(selected)) {
    if (entry.classification !== 'created') {
      continue;
    }
    const tableId = entry.target.tableCreatedId;
    if (!schemaHashes.has(tableId)) {
      const destinationTable = destinationTables.get(tableId);
      const schema =
        projections.get(tableId)?.head.schema ??
        (destinationTable
          ? schemaForTable(head, destinationTable.id)
          : undefined);
      if (schema) {
        schemaHashes.set(tableId, objectHash(schema));
      }
    }
    const sourceRow = sourceRows.get(tableId)?.get(entry.target.rowCreatedId);
    const copied = destinationRows.get(tableId)?.get(entry.target.rowCreatedId);
    const schemaHash = schemaHashes.get(tableId);
    if (sourceRow && copied && schemaHash) {
      refreshRow(copied, schemaHash);
    }
  }
}

function applySelectedFieldValues(
  head: DraftRevisionState,
  draft: DraftRevisionState,
  selected: DraftChangesCatalogueEntry[],
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
  const headRows = indexRows(headTables);
  const draftRows = indexRows(draftTables);
  const defaults = new WeakMap<object, JsonValue>();
  const fieldMappings = indexFieldMappings(projections);
  for (const entry of selected) {
    applyCommitField(entry, {
      headRows,
      draftRows,
      fieldMappings,
      projections,
      defaults,
    });
  }
}

interface CommitFieldContext {
  headRows: Map<string, DraftRevisionState['tables'][number]['rows'][number]>;
  draftRows: Map<string, DraftRevisionState['tables'][number]['rows'][number]>;
  fieldMappings: Map<string, Map<string, string>>;
  projections: Map<
    string,
    Extract<ProjectDraftChangesSchemaResult, { status: 'projected' }>
  >;
  defaults: WeakMap<object, JsonValue>;
}

function applyCommitField(
  entry: DraftChangesCatalogueEntry,
  context: CommitFieldContext,
): void {
  if (entry.kind !== 'rowField' || entry.target.kind !== 'rowField') {
    return;
  }
  const tableId = entry.target.tableCreatedId;
  const rowId = entry.target.rowCreatedId;
  const identity = rowKey(tableId, rowId);
  const projection = context.projections.get(tableId);
  const targetPath =
    entry.path === ''
      ? ''
      : context.fieldMappings.get(tableId)?.get(entry.path ?? '');
  const target = context.headRows.get(identity);
  const source = context.draftRows.get(identity);
  const schema = projection?.head.schema;
  if (!projection || targetPath === undefined || !target || !source) {
    return;
  }
  const value = entry.afterExists
    ? readField(source, entry.path ?? '')
    : missingValue;
  const transferred =
    value === null && schema
      ? defaultAt(schema, targetPath, context.defaults)
      : value;
  writeField(target, targetPath, transferred);
  if (value === null && schema) {
    writeField(
      source,
      entry.path ?? '',
      defaultAt(projection.draft.schema, entry.path ?? '', context.defaults),
    );
  }
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

function indexRows(
  tables: Map<string, DraftRevisionState['tables'][number]>,
): Map<string, DraftRevisionState['tables'][number]['rows'][number]> {
  const rows = new Map<
    string,
    DraftRevisionState['tables'][number]['rows'][number]
  >();
  for (const [tableId, table] of tables) {
    for (const row of table.rows) {
      rows.set(rowKey(tableId, row.createdId), row);
    }
  }
  return rows;
}

function rowKey(tableCreatedId: string, rowCreatedId: string): string {
  return `${tableCreatedId}\u0000${rowCreatedId}`;
}

function applyCommitSchema(
  head: DraftRevisionState,
  draft: DraftRevisionState,
  projections: Map<
    string,
    Extract<ProjectDraftChangesSchemaResult, { status: 'projected' }>
  >,
): void {
  for (const [tableCreatedId, projection] of projections) {
    applyProjectedRows(
      head,
      tableCreatedId,
      projection.head.rows,
      projection.head.schema,
      projection.head.history,
    );
    applyProjectedRows(
      draft,
      tableCreatedId,
      projection.draft.rows,
      projection.draft.schema,
      projection.draft.history,
    );
  }
}
