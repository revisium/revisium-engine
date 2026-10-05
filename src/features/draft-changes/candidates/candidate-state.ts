import objectHash from 'object-hash';
import { deepEqual } from '@revisium/schema-toolkit/lib';
import type { JsonValue } from '@revisium/schema-toolkit/types';
import type {
  DraftRevisionState,
  DraftRevisionStateRow,
  DraftRevisionStateTable,
} from 'src/features/draft-revision/commands/impl/draft-revision-write-state.command';
import { SystemTables } from 'src/features/share/system-tables.consts';
import { metaSchema } from 'src/features/share/schema/meta-schema';

export function detachState(state: DraftRevisionState): DraftRevisionState {
  return structuredClone(state);
}

export function findTable(
  state: DraftRevisionState,
  createdId: string,
): DraftRevisionStateTable | undefined {
  return state.tables.find((table) => table.createdId === createdId);
}

export function findRow(
  table: DraftRevisionStateTable | undefined,
  createdId: string,
): DraftRevisionStateRow | undefined {
  return table?.rows.find((row) => row.createdId === createdId);
}

export function replaceTable(
  state: DraftRevisionState,
  table: DraftRevisionStateTable,
): void {
  const index = state.tables.findIndex(
    ({ createdId }) => createdId === table.createdId,
  );
  if (index < 0) {
    state.tables.push(table);
    return;
  }
  state.tables[index] = table;
}

export function removeTable(
  state: DraftRevisionState,
  createdId: string,
): void {
  const removed = state.tables.find(({ createdId: id }) => id === createdId);
  state.tables = state.tables.filter((table) => table.createdId !== createdId);
  const schemaTable = state.tables.find(({ id }) => id === SystemTables.Schema);
  if (schemaTable) {
    if (removed) {
      schemaTable.rows = schemaTable.rows.filter(({ id }) => id !== removed.id);
    }
  }
}

export function copySchemaRow(
  destination: DraftRevisionState,
  source: DraftRevisionState,
  tableCreatedId: string,
): void {
  const sourceTable = findTable(source, tableCreatedId);
  const sourceSchema = source.tables.find(
    ({ id }) => id === SystemTables.Schema,
  );
  const targetTable = findTable(destination, tableCreatedId);
  const targetSchema = destination.tables.find(
    ({ id }) => id === SystemTables.Schema,
  );
  if (!sourceTable || !sourceSchema || !targetTable || !targetSchema) {
    return;
  }
  const sourceRow = sourceSchema.rows.find(({ id }) => id === sourceTable.id);
  if (!sourceRow) {
    return;
  }
  const copied = structuredClone(sourceRow);
  copied.id = targetTable.id;
  copied.hash = objectHash(copied.data);
  copied.readonly = false;
  const index = targetSchema.rows.findIndex(
    ({ createdId }) => createdId === copied.createdId,
  );
  if (index < 0) {
    targetSchema.rows.push(copied);
  } else {
    targetSchema.rows[index] = copied;
  }
}

export function updateSchemaRow(
  state: DraftRevisionState,
  tableCreatedId: string,
  schema: unknown,
  history: unknown,
): void {
  const table = findTable(state, tableCreatedId);
  const schemaTable = state.tables.find(({ id }) => id === SystemTables.Schema);
  const row = schemaTable?.rows.find(({ id }) => id === table?.id);
  if (!table || !row) {
    return;
  }
  const nextSchema = structuredClone(schema) as DraftRevisionStateRow['data'];
  const nextHistory = structuredClone(history) as DraftRevisionStateRow['meta'];
  if (deepEqual(row.data, nextSchema) && deepEqual(row.meta, nextHistory)) {
    return;
  }
  row.data = nextSchema;
  row.meta = nextHistory;
  row.hash = objectHash(row.data);
  row.schemaHash = objectHash(metaSchema);
  row.readonly = false;
}

export function applyProjectedRows(
  state: DraftRevisionState,
  tableCreatedId: string,
  rows: Array<{ createdId: string; data: JsonValue }>,
  schema: unknown,
  history: unknown,
): void {
  const table = findTable(state, tableCreatedId);
  if (!table) {
    return;
  }
  const schemaTable = state.tables.find(({ id }) => id === SystemTables.Schema);
  const schemaRow = schemaTable?.rows.find(({ id }) => id === table.id);
  const schemaChanged = !schemaRow || !deepEqual(schemaRow.data, schema);
  const schemaHash = schemaChanged ? objectHash(schema as object) : undefined;
  const projectedRows = new Map(rows.map((row) => [row.createdId, row.data]));
  for (const row of table.rows) {
    const data = projectedRows.get(row.createdId);
    if (data !== undefined && !deepEqual(row.data, data)) {
      row.data = structuredClone(data);
      refreshRow(row, schemaHash);
    } else if (schemaChanged) {
      if (schemaHash !== undefined) {
        row.schemaHash = schemaHash;
      }
      row.readonly = false;
    }
  }
  updateSchemaRow(state, tableCreatedId, schema, history);
}

export function refreshRow(
  row: DraftRevisionStateRow,
  schemaHash?: string,
): void {
  row.hash = objectHash(row.data);
  if (schemaHash !== undefined) {
    row.schemaHash = schemaHash;
  }
  row.readonly = false;
}

export function setRow(
  table: DraftRevisionStateTable,
  row: DraftRevisionStateRow,
): void {
  const index = table.rows.findIndex(
    ({ createdId }) => createdId === row.createdId,
  );
  if (index < 0) {
    table.rows.push(row);
    return;
  }
  table.rows[index] = row;
}

export function removeRow(
  table: DraftRevisionStateTable | undefined,
  createdId: string,
): void {
  if (table) {
    table.rows = table.rows.filter((row) => row.createdId !== createdId);
  }
}
