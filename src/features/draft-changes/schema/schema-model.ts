import type { SchemaTable } from '@revisium/schema-toolkit/lib';
import type { JsonSchema } from '@revisium/schema-toolkit/types';

export function exportSchemaModel(table: SchemaTable): JsonSchema {
  return structuredClone(table.getSchema());
}
