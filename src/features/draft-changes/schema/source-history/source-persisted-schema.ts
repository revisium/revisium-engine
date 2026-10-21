import type { RevisiumValidator } from '@revisium/schema-toolkit/lib';
import type { JsonSchema } from '@revisium/schema-toolkit/types';
import type { DraftChangesRevisionSnapshot } from 'src/features/draft-changes/queries/impl/read-draft-changes-snapshot.query';
import type { HistoryPatches } from 'src/features/share/queries/impl/transactional/get-table-schema.query';
import { SystemTables } from 'src/features/share/system-tables.consts';

type SchemaRow = DraftChangesRevisionSnapshot['tables'][number]['rows'][number];

export type PersistedSchema =
  | { status: 'valid'; schema: JsonSchema; history: HistoryPatches[] }
  | { status: 'invalid'; historyLength: number; message: string };

export interface PersistedSchemaIndex {
  revisionId: string;
  rowsByTableId: ReadonlyMap<string, SchemaRow[]>;
}

export function indexPersistedSchemas(
  revision: DraftChangesRevisionSnapshot,
): PersistedSchemaIndex {
  const rowsByTableId = new Map<string, SchemaRow[]>();
  const schemaRows = revision.tables
    .filter(({ id }) => id === SystemTables.Schema)
    .flatMap(({ rows }) => rows);
  for (const row of schemaRows) {
    rowsByTableId.set(row.id, [...(rowsByTableId.get(row.id) ?? []), row]);
  }
  return { revisionId: revision.id, rowsByTableId };
}

export function readPersistedSchema(
  index: PersistedSchemaIndex,
  tableId: string,
  validator: RevisiumValidator,
): PersistedSchema {
  const schemaRows = index.rowsByTableId.get(tableId) ?? [];
  const [schemaRow] = schemaRows;
  if (schemaRows.length !== 1 || !schemaRow) {
    return {
      status: 'invalid',
      historyLength: 0,
      message: `Revision '${index.revisionId}' has no single schema row for table '${tableId}'.`,
    };
  }
  if (!validator.validateHistoryPatches(schemaRow.meta)) {
    return {
      status: 'invalid',
      historyLength: Array.isArray(schemaRow.meta) ? schemaRow.meta.length : 0,
      message: `Revision '${index.revisionId}' keeps malformed schema history for table '${tableId}'.`,
    };
  }
  return {
    status: 'valid',
    schema: schemaRow.data as JsonSchema,
    history: schemaRow.meta as HistoryPatches[],
  };
}
