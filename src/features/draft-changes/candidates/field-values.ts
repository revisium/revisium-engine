import type { JsonSchema, JsonValue } from '@revisium/schema-toolkit/types';
import type { ProjectDraftChangesSchemaResult } from 'src/features/draft-changes/queries/impl/project-draft-changes-schema.query';
import type {
  DraftRevisionState,
  DraftRevisionStateRow,
} from 'src/features/draft-revision/commands/impl/draft-revision-write-state.command';
import { defaultRow } from 'src/features/draft-changes/schema/schema-table-projection';
import { SystemTables } from 'src/features/share/system-tables.consts';
import {
  missingValue,
  readJsonPath,
  setJsonPath,
  unescapePointer,
} from 'src/features/draft-changes/schema/json-value-path';
import { refreshRow } from './candidate-state';

export function mapTargetPath(
  projection: Extract<ProjectDraftChangesSchemaResult, { status: 'projected' }>,
  sourcePath: string,
): string | undefined {
  if (sourcePath === '') {
    return '';
  }
  return projection.rowTargetFieldMappings.find(
    ({ fromPath }) => fromPath === sourcePath,
  )?.toPath;
}

export function readField(
  row: Pick<DraftRevisionStateRow, 'data'>,
  path: string,
): JsonValue | typeof missingValue {
  return readJsonPath(row.data as unknown as JsonValue, path);
}

export function writeField(
  row: DraftRevisionStateRow,
  path: string,
  value: JsonValue | typeof missingValue,
  schemaHash?: string,
): void {
  const result = setJsonPath(row.data as unknown as JsonValue, path, value);
  if (result.representable) {
    row.data = result.value as unknown as DraftRevisionStateRow['data'];
    refreshRow(row, schemaHash);
  }
}

export function schemaForTable(
  state: DraftRevisionState,
  tableId: string,
): JsonSchema | undefined {
  const schemaTable = state.tables.find(({ id }) => id === SystemTables.Schema);
  const schemaRow = schemaTable?.rows.find(({ id }) => id === tableId);
  return schemaRow?.data &&
    typeof schemaRow.data === 'object' &&
    !Array.isArray(schemaRow.data)
    ? (schemaRow.data as JsonSchema)
    : undefined;
}

export function defaultAt(
  schema: JsonSchema,
  path: string,
  cache?: WeakMap<object, JsonValue>,
): JsonValue {
  const targetSchema = schemaAtDataPath(schema, path);
  const shape = targetSchema as unknown as { default?: JsonValue } | undefined;
  if (shape && Object.prototype.hasOwnProperty.call(shape, 'default')) {
    return structuredClone(shape.default) as JsonValue;
  }
  let defaults = cache?.get(schema as object);
  if (!defaults) {
    defaults = defaultRow(schema, {});
    cache?.set(schema as object, defaults);
  }
  const value = readJsonPath(defaults, path);
  return value === missingValue ? null : value;
}

function schemaAtDataPath(
  schema: JsonSchema,
  path: string,
): JsonSchema | undefined {
  let current: JsonSchema | undefined = schema;
  const segments =
    path === '' ? [] : path.split('/').slice(1).map(unescapePointer);
  for (const segment of segments) {
    const shape = current as unknown as
      | {
          type?: string;
          items?: JsonSchema;
          properties?: Record<string, JsonSchema>;
        }
      | undefined;
    if (shape?.type === 'array' && /^\d+$/.test(segment)) {
      current = shape.items;
    } else {
      current = shape?.properties?.[segment];
    }
  }
  return current;
}
