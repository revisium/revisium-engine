import {
  createJsonSchemaStore,
  SchemaTable,
} from '@revisium/schema-toolkit/lib';
import objectHash from 'object-hash';
import type { JsonSchema, JsonValue } from '@revisium/schema-toolkit/types';
import type { HistoryGroup } from 'src/features/draft-changes/schema/schema-history';
import type { HistoryPatches } from 'src/features/share/queries/impl/transactional/get-table-schema.query';
import { exportSchemaModel } from 'src/features/draft-changes/schema/schema-model';

interface TableProjection {
  schema: JsonSchema;
  history: HistoryPatches[];
  rows: Array<{ createdId: string; data: JsonValue }>;
}

export function projectTable(
  schema: JsonSchema,
  rows: Array<{ createdId: string; data: JsonValue }>,
  groups: HistoryGroup[],
  refs: Record<string, JsonSchema>,
): TableProjection {
  if (groups.length === 0) {
    return {
      schema: structuredClone(schema),
      history: [],
      rows: structuredClone(rows),
    };
  }
  let table = new SchemaTable(structuredClone(schema), refs);
  let exportedSchema = structuredClone(schema);
  for (const row of rows) {
    table.addRow(row.createdId, structuredClone(row.data));
  }
  const history: HistoryPatches[] = [];
  let hasUnnormalizedMove = false;
  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index];
    if (!group) {
      continue;
    }
    if (needsBoundaryNormalization(hasUnnormalizedMove, group)) {
      const normalizedRows = table.getRows();
      exportedSchema = exportSchemaModel(table);
      table = new SchemaTable(exportedSchema, refs);
      for (const row of normalizedRows) {
        table.addRow(row.id, structuredClone(row.data));
      }
      hasUnnormalizedMove = false;
    }
    table.applyPatches(structuredClone(group.patches));
    exportedSchema = exportSchemaModel(table);
    hasUnnormalizedMove ||= group.patches.some((patch) => patch.op === 'move');
    history.push({
      ...structuredClone(group.source),
      patches: structuredClone(group.patches),
      hash: objectHash(exportedSchema),
    });
  }
  return {
    schema: exportedSchema,
    history,
    rows: table.getRows().map(({ id, data }) => ({
      createdId: id,
      data: structuredClone(data),
    })),
  };
}

function needsBoundaryNormalization(
  hasUnnormalizedMove: boolean,
  current: HistoryGroup,
): boolean {
  return Boolean(
    hasUnnormalizedMove &&
    current.patches.some(
      (patch) => patch.op === 'replace' || patch.op === 'remove',
    ),
  );
}

export function defaultRow(
  schema: JsonSchema,
  refs: Record<string, JsonSchema>,
): JsonValue {
  const store = createJsonSchemaStore(structuredClone(schema), refs);
  return structuredClone(store.default);
}
