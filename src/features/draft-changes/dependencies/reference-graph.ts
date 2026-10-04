import type { JsonSchema, JsonValue } from '@revisium/schema-toolkit/types';
import {
  getForeignKeyReferences,
  getForeignKeySchemaReferences,
} from 'src/features/share/foreign-key-references';
import type { DraftRevisionState } from 'src/features/draft-revision/commands/impl/draft-revision-write-state.command';
import { SystemTables } from 'src/features/share/system-tables.consts';
import type { JsonSchemaStoreService } from 'src/features/share/json-schema-store.service';

export interface CandidateForeignKeyReference {
  kind: 'row' | 'schema';
  role: 'head' | 'draft';
  tableCreatedId: string;
  tableId: string;
  rowCreatedId?: string;
  rowId?: string;
  targetTableId: string;
  targetRowId?: string;
  path: string;
  schemaPath: string;
}

export function readCandidateReferences(
  state: DraftRevisionState,
  role: 'head' | 'draft',
  schemaStores: JsonSchemaStoreService,
): CandidateForeignKeyReference[] {
  const references: CandidateForeignKeyReference[] = [];
  for (const table of state.tables) {
    if (table.system || table.id === SystemTables.Schema) {
      continue;
    }
    const schema = schemaForTable(state, table.id);
    if (!schema) {
      continue;
    }
    const store = schemaStores.create(schema);
    references.push(...readSchemaReferences(table, role, store));
    references.push(...readRowReferences(table, role, store));
  }
  return references;
}

export function findMissingReferenceTarget(
  state: DraftRevisionState,
  reference: CandidateForeignKeyReference,
): boolean {
  const targetTable = state.tables.find(
    ({ id }) => id === reference.targetTableId,
  );
  if (!targetTable) {
    return true;
  }
  return (
    reference.kind === 'row' &&
    !targetTable.rows.some(({ id }) => id === reference.targetRowId)
  );
}

function readSchemaReferences(
  table: DraftRevisionState['tables'][number],
  role: 'head' | 'draft',
  store: ReturnType<JsonSchemaStoreService['create']>,
): CandidateForeignKeyReference[] {
  return getForeignKeySchemaReferences(store).map(
    ({ tableId, schemaPath }) => ({
      kind: 'schema' as const,
      role,
      tableCreatedId: table.createdId,
      tableId: table.id,
      targetTableId: tableId,
      path: schemaPath,
      schemaPath,
    }),
  );
}

function readRowReferences(
  table: DraftRevisionState['tables'][number],
  role: 'head' | 'draft',
  store: ReturnType<JsonSchemaStoreService['create']>,
): CandidateForeignKeyReference[] {
  return table.rows.flatMap((row) =>
    getForeignKeyReferences(store, row.data as JsonValue).map((reference) => ({
      kind: 'row' as const,
      role,
      tableCreatedId: table.createdId,
      tableId: table.id,
      rowCreatedId: row.createdId,
      rowId: row.id,
      targetTableId: reference.tableId,
      targetRowId: reference.rowId,
      path: reference.jsonPointer,
      schemaPath: reference.schemaPath,
    })),
  );
}

function schemaForTable(
  state: DraftRevisionState,
  tableId: string,
): JsonSchema | undefined {
  const schemaTable = state.tables.find(({ id }) => id === SystemTables.Schema);
  const schemaRow = schemaTable?.rows.find(({ id }) => id === tableId);
  return isJsonSchema(schemaRow?.data) ? schemaRow.data : undefined;
}

function isJsonSchema(value: unknown): value is JsonSchema {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
