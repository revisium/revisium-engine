import objectHash from 'object-hash';
import type { DraftRevisionState } from 'src/features/draft-revision/commands/impl/draft-revision-write-state.command';
import {
  findTable,
  refreshRow,
  setRow,
} from 'src/features/draft-changes/candidates/candidate-state';
import { SystemTables } from 'src/features/share/system-tables.consts';
import type { StoredViewsSource } from 'src/features/draft-changes/schema/schema-view-baselines';
import type { TableViewsData } from 'src/features/views/types';

export type ReadViewsResult =
  | { status: 'missingTable' }
  | { status: 'missing' }
  | { status: 'present'; value: unknown };

export function readViewsForTable(
  state: DraftRevisionState,
  tableCreatedId: string,
): ReadViewsResult {
  const owner = findTable(state, tableCreatedId);
  if (!owner) {
    return { status: 'missingTable' };
  }
  const viewsTable = state.tables.find(({ id }) => id === SystemTables.Views);
  const rows = viewsTable?.rows.filter(({ id }) => id === owner.id) ?? [];
  if (rows.length === 0) {
    return { status: 'missing' };
  }
  if (rows.length !== 1) {
    return { status: 'present', value: undefined };
  }
  return { status: 'present', value: rows[0]?.data };
}

export function writeViewsForTable(
  destination: DraftRevisionState,
  source: DraftRevisionState,
  tableCreatedId: string,
  document: StoredViewsSource,
): boolean {
  if (!document.present) {
    removeViewsRow(destination, source, tableCreatedId);
    return true;
  }
  return writeViewsRow(destination, source, tableCreatedId, document.value);
}

function removeViewsRow(
  destination: DraftRevisionState,
  source: DraftRevisionState,
  tableCreatedId: string,
): void {
  const owner = findTable(destination, tableCreatedId);
  const viewsTable = destination.tables.find(
    ({ id }) => id === SystemTables.Views,
  );
  if (!viewsTable) {
    return;
  }
  const sourceRow = findStoredViewsRow(source, tableCreatedId);
  const existingRow = findDestinationViewsRow(
    viewsTable,
    owner?.id,
    sourceRow?.createdId,
  );
  if (existingRow) {
    viewsTable.rows = viewsTable.rows.filter(
      ({ createdId }) => createdId !== existingRow.createdId,
    );
  }
}

function writeViewsRow(
  destination: DraftRevisionState,
  source: DraftRevisionState,
  tableCreatedId: string,
  value: TableViewsData,
): boolean {
  const owner = findTable(destination, tableCreatedId);
  let viewsTable = destination.tables.find(
    ({ id }) => id === SystemTables.Views,
  );
  if (!owner) {
    return false;
  }
  const sourceViewsTable = findViewsTable(source);
  const sourceRow = findStoredViewsRow(source, tableCreatedId);
  if (!viewsTable) {
    if (!prepareViewsStorage(destination, source, sourceViewsTable)) {
      return false;
    }
    viewsTable = destination.tables.find(({ id }) => id === SystemTables.Views);
  }
  if (!viewsTable) {
    return false;
  }

  const existingRow = findDestinationViewsRow(
    viewsTable,
    owner.id,
    sourceRow?.createdId,
  );

  const template = existingRow ?? sourceRow;
  if (!template) {
    return false;
  }

  const next = structuredClone(template);
  next.id = owner.id;
  next.data = structuredClone(value) as unknown as typeof next.data;
  next.hash = objectHash(next.data);
  refreshRow(next);
  setRow(viewsTable, next);
  return true;
}

function findStoredViewsRow(state: DraftRevisionState, tableCreatedId: string) {
  const owner = findTable(state, tableCreatedId);
  const viewsTable = findViewsTable(state);
  return viewsTable?.rows.find(({ id }) => id === owner?.id);
}

function findViewsTable(state: DraftRevisionState) {
  return state.tables.find(({ id }) => id === SystemTables.Views);
}

function findDestinationViewsRow(
  viewsTable: DraftRevisionState['tables'][number],
  ownerId: string | undefined,
  sourceCreatedId: string | undefined,
) {
  if (sourceCreatedId !== undefined) {
    return viewsTable.rows.find(
      ({ createdId }) => createdId === sourceCreatedId,
    );
  }
  if (ownerId !== undefined) {
    return viewsTable.rows.find(({ id }) => id === ownerId);
  }
  return undefined;
}

function prepareViewsStorage(
  destination: DraftRevisionState,
  source: DraftRevisionState,
  sourceViewsTable: DraftRevisionState['tables'][number] | undefined,
): boolean {
  if (!sourceViewsTable) {
    return false;
  }
  const sourceSchema = source.tables.find(
    ({ id }) => id === SystemTables.Schema,
  );
  const destinationSchema = destination.tables.find(
    ({ id }) => id === SystemTables.Schema,
  );
  if (!destinationSchema) {
    return false;
  }
  const sourceViewsSchemaRow = sourceSchema?.rows.find(
    ({ id }) => id === SystemTables.Views,
  );
  const viewsTable = structuredClone(sourceViewsTable);
  viewsTable.rows = [];
  destination.tables.push(viewsTable);
  if (sourceViewsSchemaRow) {
    setRow(destinationSchema, structuredClone(sourceViewsSchemaRow));
  }
  return true;
}

export function isTableViewsData(value: unknown): value is TableViewsData {
  if (!isRecord(value) || !Array.isArray(value.views)) {
    return false;
  }
  return value.views.every(
    (view) => isRecord(view) && typeof view.id === 'string',
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
