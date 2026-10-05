import { SystemSchemaIds } from '@revisium/schema-toolkit/consts';
import { JsonSchemaTypeName } from '@revisium/schema-toolkit/types';
import type { JsonSchema } from '@revisium/schema-toolkit/types';
import type { JsonValue } from 'src/engine-prisma-types';
import type {
  DraftRevisionState,
  DraftRevisionStateRow,
} from 'src/features/draft-revision/commands/impl/draft-revision-write-state.command';
import { SystemTables } from 'src/features/share/system-tables.consts';
import { escapePointer } from 'src/features/draft-changes/schema/json-value-path';

export interface RawFileOccurrence {
  path: string;
  value: JsonValue | undefined;
}

export interface CandidateFileReference extends RawFileOccurrence {
  tableCreatedId: string;
  rowCreatedId: string;
}

export interface CandidateFileRow {
  tableCreatedId: string;
  row: DraftRevisionStateRow;
  schema: JsonSchema | undefined;
  references: CandidateFileReference[];
}

export function collectCandidateFileRows(
  state: DraftRevisionState,
): CandidateFileRow[] {
  const schemas = new Map(
    state.tables
      .find(({ id }) => id === SystemTables.Schema)
      ?.rows.map((row) => [row.id, row.data]) ?? [],
  );
  return state.tables.flatMap((table) => {
    const schemaData = schemas.get(table.id);
    const schema = isRecord(schemaData)
      ? (schemaData as JsonSchema)
      : undefined;
    return table.rows.map((row) => ({
      tableCreatedId: table.createdId,
      row,
      schema,
      references:
        table.system || !schema
          ? []
          : collectRawFileOccurrences(schema, row.data).map((occurrence) => ({
              ...occurrence,
              tableCreatedId: table.createdId,
              rowCreatedId: row.createdId,
            })),
    }));
  });
}

export function collectRawFileOccurrences(
  schema: JsonSchema,
  value: JsonValue,
): RawFileOccurrence[] {
  const result: RawFileOccurrence[] = [];
  collectFileOccurrences(schema, value, '', true, result);
  return result;
}

function collectFileOccurrences(
  schema: JsonSchema,
  value: JsonValue | undefined,
  path: string,
  required: boolean,
  result: RawFileOccurrence[],
): void {
  if ('$ref' in schema) {
    if (
      schema.$ref === SystemSchemaIds.File &&
      (required || value !== undefined)
    ) {
      result.push({ path, value });
    }
    return;
  }
  if (schema.type === JsonSchemaTypeName.Object) {
    if (value === undefined && !required) {
      return;
    }
    for (const [key, child] of Object.entries(schema.properties)) {
      collectFileOccurrences(
        child,
        isRecord(value) ? value[key] : undefined,
        `${path}/${escapePointer(key)}`,
        schema.required?.includes(key) ?? false,
        result,
      );
    }
    return;
  }
  if (schema.type === JsonSchemaTypeName.Array && Array.isArray(value)) {
    value.forEach((item, index) => {
      collectFileOccurrences(
        schema.items,
        item,
        `${path}/${index}`,
        true,
        result,
      );
    });
  }
}

export function fileRowKey(
  tableCreatedId: string,
  rowCreatedId: string,
): string {
  return `${tableCreatedId}:${rowCreatedId}`;
}

export function isRecord(value: unknown): value is Record<string, JsonValue> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
